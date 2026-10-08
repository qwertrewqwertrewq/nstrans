import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync } from 'node:fs'

// Uses a local built Worker and isolated mocked API data. Never writes production
// games, translations, votes, update policy, accounts or keys.
const origin = process.env.NSTRANS_COMMUNITY_URL || 'http://127.0.0.1:8787'
const executablePath = process.env.CHROME_PATH || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].find(existsSync)
assert.ok(executablePath, 'Set CHROME_PATH to Chrome/Chromium')
const output = '.build/community-qa'
mkdirSync(output, { recursive: true })
const browser = await chromium.launch({ executablePath, headless: true })
const errors = [], writes = []
let user = { id: 1, login: '测试管理员', role: 'admin', github_bound: true }
let sessionError = false, voted = 0
const games = [
  { id: 'general', chinese_name: '通用游戏库', japanese_name: '', poster_url: '', status: 'approved' },
  { id: 'zelda-totk', chinese_name: '塞尔达传说 王国之泪', japanese_name: 'ゼルダの伝説 ティアーズ オブ ザ キングダム', poster_url: '', status: 'approved' },
]
const terms = [
  { id: 1, source: 'ゼルダ', kind: 'term', translations: [{ id: 11, target: '塞尔达', score: 8 }, { id: 12, target: '赛尔达', score: 2 }] },
  { id: 2, source: 'ゾナウエネルギー', kind: 'term', translations: [{ id: 21, target: '左纳乌能源', score: 4 }] },
  { id: 3, source: '設定', kind: 'phrase', translations: [{ id: 31, target: '设置', score: 3 }] },
]
async function fixture(route) {
  const request = route.request(), url = new URL(request.url()), method = request.method(), path = url.pathname
  const body = request.postDataJSON()
  const send = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
  if (method !== 'GET') writes.push({ method, path, body })
  if (path === '/api/me') return sessionError ? send({ error: '测试服务暂不可用' }, 503) : user ? send({ user }) : send({ user: null }, 401)
  if (path === '/api/stats') return send({ games: 2, terms: 321, translations: 498, contributors: 28 })
  if (path === '/api/keys') return method === 'POST' ? send({ key: 'nst_live_FAKE_TEST_KEY_NOT_A_SECRET' }, 201) : send({ keys: [{ id: 1, key_prefix: 'nst_live_FAKE', origin: 'official-client', device_name: '测试设备', created_at: '2026-10-01 10:00:00', last_used_at: null }] })
  if (path.startsWith('/api/keys/')) return send({ ok: true })
  if (path === '/api/games') {
    if (method === 'POST') { games.push({ id: 'test-game', chinese_name: body.chineseName, japanese_name: body.japaneseName || '', poster_url: '', status: 'approved' }); return send({ id: 'test-game', status: 'approved' }, 201) }
    return send({ games })
  }
  if (/^\/api\/games\/[^/]+\/terms$/u.test(path)) {
    if (method === 'POST') return send({ ok: true, translationId: 100, score: 3 }, 201)
    const game = path.split('/')[3], q = url.searchParams.get('q') || ''
    if (q === 'slow') await new Promise(resolve => setTimeout(resolve, 600))
    return send({ terms: game === 'general' ? [] : terms.filter(t => `${t.source}${t.translations.map(x => x.target).join('')}`.includes(q)), searchExclusions: game === 'general' ? [{ source_text: 'アイテム', source_name: '公开词典', source_url: 'https://example.com/' }] : [], searchExclusionCount: game === 'general' ? 1500 : 0 })
  }
  if (path.endsWith('/vote')) { voted++; return send({ score: 9 }) }
  if (path.startsWith('/api/translations/')) return send({ ok: true, score: 11 })
  if (path === '/api/account/profile') { user.login = body.username; return send({ ok: true, username: body.username }) }
  if (path === '/api/account/password') return send({ ok: true })
  if (path === '/api/admin/update-policy') return send({ policy: { target_version: '1.0.1', popup_enabled: 1, force_update: 0, content: '新版修复画面采集与字幕清理。', download_url: 'https://nstrans.221129.xyz/download' } })
  if (path.startsWith('/api/admin/games/')) return send({ ok: true })
  if (path === '/api/admin/relay/config') return method === 'PATCH' ? send({ ok:true }) : send({ enabled:false,routes:{translation:'gemini-2.5-flash-lite',search:'gemini-2.5-flash',vision:'gemini-2.5-flash'},keyConfigured:true,maxConcurrency:2,models:[
    {id:'gemini-2.5-flash',capability:'multimodal-search',enabled:true,translationCost:1,searchCost:2,visionCost:2},
    {id:'gemini-2.5-flash-lite',capability:'multimodal-search',enabled:true,translationCost:1,searchCost:2,visionCost:2},
  ] })
  if (path === '/api/admin/relay/credentials') return send({credentials:[{id:'legacy-google',name:'Google测试密钥',platform:'google',workspace:''}]})
  if (path === '/api/admin/relay/discover') return send({models:[{id:'gemini-2.5-flash',name:'Flash',vision:true,search:true},{id:'gemini-2.5-flash-lite',name:'Flash Lite',vision:true,search:true}]})
  if (path === '/api/admin/relay/users') return send({ users:[{id:1,login:'测试管理员',balance:100,granted:120,spent:20,pending:0}],total:1 })
  if (path === '/api/admin/relay/grants') return send({ ok:true,users:body.userIds.length })
  if (path === '/api/admin/relay/usage') return send({ usage:[{id:'fixture',login:'测试管理员',model:'gemini-2.5-flash',purpose:'search',cost:2,status:'success',input_tokens:120,output_tokens:20,duration_ms:1000,created_at:'2026-10-05 00:00:00'}],total:1,summary:{ requests:1,inputTokens:120,outputTokens:20,points:2 } })
  throw new Error(`Unmocked request: ${method} ${path}`)
}
async function pageFor(viewport) {
  const context = await browser.newContext({ viewport })
  await context.route('**/api/**', fixture)
  const page = await context.newPage()
  page.setDefaultTimeout(15000)
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', message => { if (message.type() === 'warning' && /Failed to resolve|Invalid prop|Unhandled error/u.test(message.text())) errors.push(message.text()) })
  page.on('console', message => { if (message.type() === 'error' && /Content Security Policy|violates|Refused to/u.test(message.text())) errors.push(message.text()) })
  return page
}
async function goto(page, path, title) {
  await page.goto(origin + path)
  await page.getByRole('heading', { name: title, exact: true }).waitFor()
  await page.waitForTimeout(120)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
  assert.ok(overflow <= 1, `${path} overflows by ${overflow}px at ${(await page.viewportSize()).width}px`)
}
try {
  // Exercise real Worker asset routing, without any mock or database dependency.
  for (const path of ['/', '/login', '/download', '/dashboard/keys', '/dashboard/dictionary?game=general']) {
    const response = await fetch(origin + path)
    assert.equal(response.status, 200, path)
    assert.ok((await response.text()).includes('id="app"'), path)
    assert.equal(response.headers.get('cache-control'), 'no-cache')
  }
  const missing = await fetch(origin + '/api/nonexistent')
  assert.equal(missing.status, 404)
  assert.ok((await missing.json()).error)
  const desktop = await pageFor({ width: 1440, height: 1000 })
  const routes = [
    ['/', '让每一次翻译， 成为下一次的答案。'],
    ['/how-it-works', '模型解决第一次，词库解决之后每一次。'],
    ['/client', '下载无需登录，登录即可参与共建。'],
    ['/download', '选择平台，开始实时翻译'],
    ['/donate', '支持 NSTrans'],
    ['/dashboard', '你好，测试管理员'],
    ['/dashboard/keys', '客户端密钥'],
    ['/dashboard/games', '游戏管理'],
    ['/dashboard/dictionary', '词库与评分'],
    ['/dashboard/account', '账号与绑定'],
    ['/dashboard/updates', '版本通知'],
  ]
  for (const [path, title] of routes) await goto(desktop, path, title)
  await desktop.screenshot({ path: `${output}/updates-desktop.png`, fullPage: true })
  await desktop.getByRole('switch', { name: '强制更新', exact: true }).locator('..').click()
  assert.equal(await desktop.getByRole('switch', { name: '显示更新弹窗' }).isDisabled(), true)
  assert.equal(await desktop.getByRole('switch', { name: '显示更新弹窗' }).getAttribute('aria-checked'), 'true')
  await goto(desktop, '/dashboard/relay', '社区中转模型与额度')
  const queue=desktop.getByRole('list',{name:'翻译优先级',exact:true})
  await desktop.locator('.relay-route-queue').first().locator('.el-select').click()
  await desktop.getByRole('option',{name:'Gemini · gemini-2.5-flash',exact:true}).click()
  await desktop.getByRole('heading',{name:'按用途配置模型优先级与故障转移',exact:true}).click()
  await queue.locator('li').first().dragTo(queue.locator('li').nth(1))
  assert.ok((await queue.locator('li').first().innerText()).includes('gemini-2.5-flash'))
  assert.ok(!(await queue.locator('li').first().innerText()).includes('flash-lite'))
  await desktop.getByRole('button',{name:'保存配置',exact:true}).click()
  await desktop.getByText('中转模型配置已保存',{exact:true}).last().waitFor()
  assert.ok(writes.some(w=>w.path==='/api/admin/relay/config' && JSON.stringify(w.body.routes.translation)===JSON.stringify(['gemini-2.5-flash','gemini-2.5-flash-lite'])))
  await desktop.getByRole('button',{name:'添加模型',exact:true}).click()
  await desktop.getByRole('dialog').locator('.el-select').nth(1).click()
  await desktop.getByRole('option',{name:'Google测试密钥',exact:true}).click()
  await desktop.getByRole('dialog').locator('.el-select').nth(2).click()
  await desktop.getByRole('dialog').getByRole('combobox').nth(2).fill('flash')
  await desktop.getByRole('option',{name:'gemini-2.5-flash · 视觉 · 搜索',exact:true}).click()
  await desktop.getByRole('option',{name:'gemini-2.5-flash-lite · 视觉 · 搜索',exact:true}).click()
  assert.equal(await desktop.getByRole('dialog').getByRole('combobox').nth(2).inputValue(),'flash')
  await desktop.getByRole('button',{name:'完成选择（2）',exact:true}).click()
  await desktop.getByRole('button',{name:'添加所选模型（2）',exact:true}).click()
  await desktop.getByText('中转模型配置已保存',{exact:true}).last().waitFor()
  assert.ok(writes.some(w=>w.path === '/api/admin/relay/config' && w.body.models.filter(m=>m.platform==='google' && m.keyId==='legacy-google').length===2))
  await desktop.getByRole('button', { name:'保存配置',exact:true }).click()
  await desktop.getByText('中转模型配置已保存',{exact:true}).last().waitFor()
  await desktop.getByRole('tab',{name:'用户额度',exact:true}).click()
  await desktop.getByRole('button',{name:'分配',exact:true}).click()
  await desktop.getByRole('button',{name:'确定',exact:true}).click()
  await desktop.getByText('额度已调整',{exact:true}).waitFor()
  assert.ok(writes.some(w=>w.path === '/api/admin/relay/grants' && w.body.userIds[0]===1 && w.body.amount===10))
  await desktop.getByRole('button',{name:'清空额度',exact:true}).click()
  await desktop.getByRole('button',{name:'确定',exact:true}).click()
  await desktop.getByText('额度已清空',{exact:true}).waitFor()
  assert.ok(writes.some(w=>w.path === '/api/admin/relay/grants' && w.body.action==='clear'))
  await desktop.getByRole('button',{name:'用量',exact:true}).click()
  await desktop.getByText('gemini-2.5-flash',{exact:true}).waitFor()
  await desktop.getByText('成功',{exact:true}).waitFor()
  await desktop.waitForTimeout(300)
  await desktop.screenshot({path:`${output}/model-relay-desktop.png`,fullPage:true})
  await goto(desktop, '/dashboard?view=keys', '客户端密钥')
  assert.equal(new URL(desktop.url()).pathname, '/dashboard/keys')
  await desktop.getByRole('button', { name: '生成新密钥', exact: true }).click()
  await desktop.getByRole('dialog', { name: '请保存新密钥' }).waitFor()
  assert.ok(await desktop.getByRole('textbox', { name: '新客户端密钥' }).inputValue())
  await desktop.getByRole('button', { name: '已保存，关闭' }).click()
  await desktop.getByRole('button', { name: '撤销', exact: true }).click()
  await desktop.getByRole('button', { name: '取消', exact: true }).click()
  assert.ok(!writes.some(w => w.method === 'DELETE'))
  await desktop.locator('.api-reference .el-collapse-item__header').first().click()
  assert.ok(await desktop.locator('pre').first().isVisible())
  await goto(desktop, '/dashboard/games', '游戏管理')
  await desktop.getByRole('button', { name: '新增游戏', exact: true }).click()
  await desktop.getByRole('dialog').getByRole('textbox').first().fill('测试游戏')
  await desktop.getByRole('button', { name: '创建游戏', exact: true }).click()
  await desktop.getByText('游戏创建成功，可立即使用').waitFor()
  assert.ok(await desktop.getByText('测试游戏', { exact: true }).isVisible())
  await goto(desktop, '/dashboard?view=dictionary&game=zelda-totk', '词库与评分')
  await desktop.getByRole('heading', { name: 'ゼルダ', exact: true }).waitFor()
  await desktop.screenshot({ path: `${output}/dictionary-desktop.png`, fullPage: true })
  await desktop.getByRole('button', { name: '赞 塞尔达', exact: true }).click()
  await desktop.getByText('评分已更新').waitFor(); assert.equal(voted, 1)
  await desktop.getByRole('button', { name: '编辑 · +3', exact: true }).first().click()
  await desktop.getByRole('dialog').getByRole('textbox').nth(1).fill('塞尔达公主')
  await desktop.getByRole('button', { name: '保存词条', exact: true }).click()
  await desktop.getByText('词条已保存，可信度 +3').waitFor()
  assert.ok(writes.some(w => w.method === 'PATCH' && w.path === '/api/translations/11' && w.body.target === '塞尔达公主'))
  await desktop.getByRole('textbox', { name: '搜索词条' }).fill('设置')
  await desktop.getByRole('heading', { name: '設定', exact: true }).waitFor()
  await desktop.waitForTimeout(450)
  assert.equal(await desktop.locator('.term-card').count(), 1)
  await desktop.getByRole('textbox', { name: '搜索词条' }).fill('slow')
  await desktop.waitForTimeout(350)
  await desktop.locator('.dictionary-filters .el-select').first().click()
  await desktop.getByRole('option', { name: '通用游戏库' }).click()
  await desktop.getByRole('heading', { name: '通用片假名排除库' }).waitFor()
  await desktop.waitForTimeout(700)
  assert.equal(await desktop.locator('.term-card').count(), 0)
  await goto(desktop, '/dashboard/account', '账号与绑定')
  assert.equal(await desktop.getByRole('button', { name: '绑定 GitHub ↗' }).count(), 0)
  await desktop.getByRole('textbox').first().fill('新测试用户名')
  await desktop.getByRole('button', { name: '保存用户名' }).click()
  await desktop.getByText('用户名已保存').waitFor()
  assert.ok(await desktop.locator('.account-summary').getByText('新测试用户名', { exact: true }).isVisible())
  const modelLinks = await desktop.evaluate(() => JSON.stringify(localStorage))
  assert.ok(!modelLinks.includes('nst_live_FAKE_TEST'))
  await goto(desktop, '/download', '选择平台，开始实时翻译')
  assert.equal(await desktop.locator('a[href^="/download/file/"]').count(), 9)
  assert.equal(await desktop.locator('a[href^="/download/model/"]').count(), 5)
  // Prevent a real binary download, still exercise support popup and links.
  await desktop.route('**/download/file/**', route => route.fulfill({ status: 200, body: 'test' }))
  const popup = desktop.waitForEvent('popup')
  await desktop.locator('a[href="/download/file/macos-with-llama"]').click()
  await (await popup).close()
  await desktop.getByRole('dialog', { name: '感谢支持 NSTrans' }).waitFor()
  await desktop.getByRole('dialog').getByRole('button', { name: '支持项目 →' }).click()
  await desktop.getByRole('heading', { name: '支持 NSTrans' }).waitFor()
  await desktop.locator('.donate-grid').waitFor()
  await desktop.waitForTimeout(200)
  assert.equal(await desktop.locator('.donate-card:visible').count(), 3)
  await desktop.screenshot({ path: `${output}/donate-desktop.png`, fullPage: true })
  for (const width of [360, 390, 768, 1024]) {
    const page = await pageFor({ width, height: 900 })
    for (const [path, title] of routes.filter(([path]) => path !== '/dashboard')) await goto(page, path, title)
    await goto(page,'/dashboard/relay','社区中转模型与额度')
    await page.getByRole('tab',{name:'用户额度',exact:true}).click()
    await page.getByRole('button',{name:'分配',exact:true}).waitFor()
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth+1),'Quota UI overflow')
    await page.getByRole('tab',{name:'用量记录',exact:true}).click()
    await page.getByText('gemini-2.5-flash',{exact:true}).waitFor()
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth+1),'Usage UI overflow')
    if (width === 390) {
      await goto(page, '/dashboard/dictionary', '词库与评分')
      await page.screenshot({ path: `${output}/dictionary-mobile.png`, fullPage: true })
      await page.getByRole('button', { name: '打开控制台导航' }).click()
      await page.getByRole('dialog').getByRole('menuitem', { name: '游戏管理' }).click()
      await page.getByRole('heading', { name: '游戏管理' }).waitFor()
      await goto(page, '/donate', '支持 NSTrans')
      assert.equal(await page.locator('.donate-card:visible').count(), 1)
      await page.getByRole('tab', { name: '支付宝' }).click()
      assert.ok(await page.getByAltText('支付宝收款二维码').isVisible())
    }
    await page.context().close()
  }
  user.role = 'user'
  const member = await pageFor({ width: 1280, height: 900 })
  await member.goto(origin + '/dashboard/updates')
  await member.getByRole('heading', { name: '你好，新测试用户名' }).waitFor()
  assert.equal(new URL(member.url()).pathname, '/dashboard')
  assert.equal(await member.getByRole('menuitem', { name: '版本通知' }).count(), 0)
  user = null
  const anonymous = await pageFor({ width: 390, height: 844 })
  await anonymous.goto(origin + '/dashboard/keys')
  await anonymous.getByRole('heading', { name: '登录 NSTrans 社区' }).waitFor()
  assert.equal(new URL(anonymous.url()).pathname, '/login')
  await anonymous.screenshot({ path: `${output}/login-mobile.png`, fullPage: true })
  user = { id: 1, login: 'OAuth 返回测试', role: 'user', github_bound: true }
  await anonymous.goto(origin + '/dashboard')
  await anonymous.getByRole('heading', { name: '客户端密钥', exact: true }).waitFor()
  assert.equal(new URL(anonymous.url()).pathname, '/dashboard/keys')
  sessionError = true
  const failure = await pageFor({ width: 1280, height: 900 })
  await failure.goto(origin + '/dashboard/keys')
  await failure.getByText('测试服务暂不可用').waitFor()
  assert.equal(new URL(failure.url()).pathname, '/dashboard/keys')
  sessionError = false; user = { id: 1, login: '恢复账号', role: 'user', github_bound: true }
  await failure.getByRole('button', { name: '重新加载' }).click()
  await failure.getByRole('heading', { name: '客户端密钥' }).waitFor()
  assert.deepEqual(errors, [], 'Runtime errors / unresolved components')
  console.log(`Community QA passed: 11 pages × 5 widths; routing, OAuth return, session/roles, games, keys, scores, editing, search race, download prompt, donation tabs. ${writes.length} isolated fixture mutations. Screenshots: ${output}`)
} finally { await browser.close() }
