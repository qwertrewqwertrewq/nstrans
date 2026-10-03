import { proxyWikiMirror } from './wiki-mirror.js'

const jsonHeaders = { 'content-type': 'application/json; charset=utf-8' }
const encoder = new TextEncoder()
const githubRepository = 'qwertrewqwertrewq/nstrans'
const githubReleasesUrl = `https://api.github.com/repos/${githubRepository}/releases?per_page=30`
const githubReleasePage = `https://github.com/${githubRepository}/releases`
const downloadManifestKey = 'release-manifest.json'
const downloadObjectPrefix = 'release/'
const modelOrigin = 'https://r2.268735.xyz/models'
const githubHeaders = Object.freeze({ accept: 'application/vnd.github+json', 'user-agent': 'NSTrans Community', 'x-github-api-version': '2022-11-28' })
const downloadAssets = Object.freeze({
  'macos-with-llama': { prefix: 'NSTrans-', suffix: '-macOS-arm64-WithLlama.dmg' },
  'macos-remote-only': { prefix: 'NSTrans-', suffix: '-macOS-arm64-RemoteOnly.dmg' },
  'windows-with-llama': { prefix: 'NSTrans-', suffix: '-Windows-x64-WithLlama-setup.exe' },
  'windows-remote-only': { prefix: 'NSTrans-', suffix: '-Windows-x64-RemoteOnly-setup.exe' },
  'ipados-with-llama': { prefix: 'NSTrans-', suffix: '-iPadOS-arm64-unsigned-WithLlama.ipa' },
  'ipados-remote-only': { prefix: 'NSTrans-', suffix: '-iPadOS-arm64-unsigned-RemoteOnly.ipa' },
  'android-with-llama': { prefix: 'NSTrans-', suffix: '-Android-arm64-debug-WithLlama.apk' },
  'android-remote-only': { prefix: 'NSTrans-', suffix: '-Android-arm64-debug-RemoteOnly.apk' },
  tv: { prefix: 'NSTrans-TV-', suffix: '-Android-debug.apk' },
})
const modelAssets = Object.freeze({
  macos: {
    filename: 'translategemma-4b-ollama-q4_k_m.gguf',
    size: 3298866368,
    sha256: 'bdbf939b402e2f88fbe3e918beb777813009335756b4c17be7fe008dfe4815d4',
    source: 'https://registry.ollama.ai/v2/library/translategemma/blobs/sha256:bdbf939b402e2f88fbe3e918beb777813009335756b4c17be7fe008dfe4815d4',
  },
  windows: {
    filename: 'translategemma-4b-ollama-q4_k_m.gguf',
    size: 3298866368,
    sha256: 'bdbf939b402e2f88fbe3e918beb777813009335756b4c17be7fe008dfe4815d4',
    source: 'https://registry.ollama.ai/v2/library/translategemma/blobs/sha256:bdbf939b402e2f88fbe3e918beb777813009335756b4c17be7fe008dfe4815d4',
  },
  ipados: {
    filename: 'translategemma-4b-it.IQ4_XS.gguf',
    size: 2279641600,
    sha256: '2bc7f1b1f1ed573c0c56d9fe3073103a7c2bddfe5e228df081bb71149283b60a',
    source: 'https://huggingface.co/mradermacher/translategemma-4b-it-GGUF/resolve/main/translategemma-4b-it.IQ4_XS.gguf',
  },
  android: {
    filename: 'translategemma-4b-it-q4_k_m.gguf',
    size: 2489909312,
    sha256: '526747309109c016db547c6fc1c7b0c9c286b5e7a7556827b5419fd9543a09cd',
    source: 'https://huggingface.co/Qwe1325/translategemma-4b-it-GGUF/resolve/main/translategemma-4b-it-q4_k_m.gguf',
  },
  nllb: {
    filename: 'nstrans-nllb-200-distilled-600M-q8-v1.zip',
    size: 916828255,
    sha256: 'bd9a15c30464b41406fd69c5ea1df67dd02bac9631178ba12527533832e4b1f6',
    source: 'https://huggingface.co/Xenova/nllb-200-distilled-600M/tree/261c31d1a5732c67cdd16d80e8d6088507c7ccea',
  },
})

export default {
  async fetch(request, env) {
    try { return await route(request, env) }
    catch (error) { console.error(error); return json({ error: '服务器内部错误' }, 500) }
  },
  async scheduled(_controller, env, context) {
    context.waitUntil(syncLatestRelease(env))
  },
}

async function route(request, env) {
  const url = new URL(request.url), path = url.pathname
  if (request.method === 'OPTIONS' && path.startsWith('/api/v1/')) return cors(new Response(null, { status: 204 }))
  if (path === '/auth/github') return startGithubAuth(request, env)
  if (path === '/auth/github/callback') return githubCallback(request, env)
  if (path === '/auth/client/github' && request.method === 'GET') return beginClientGithubAuth(request, env)
  if (path === '/auth/logout') return logout(request, env)
  if (path === '/api/v1/auth/client/start' && request.method === 'POST') return cors(await startClientAuth(request, env))
  if (path === '/api/v1/auth/client/poll' && request.method === 'POST') return cors(await pollClientAuth(request, env))
  if (path === '/api/v1/auth/client/login' && request.method === 'POST') return cors(await nativeClientLogin(request, env))
  if (path === '/api/v1/auth/client/register' && request.method === 'POST') return cors(await nativeClientRegister(request, env))
  if (path === '/api/v1/client-update' && request.method === 'GET') return cors(await clientUpdatePolicy(request, env))
  if (path === '/api/v1/wiki-mirror' && request.method === 'POST') {
    const auth = await apiKeyUser(request, env)
    if (auth.response) return cors(auth.response)
    if (Number(request.headers.get('content-length') || 0) > 8192) return cors(json({ error: '请求内容过大' }, 413))
    const text = await request.text()
    if (text.length > 8192) return cors(json({ error: '请求内容过大' }, 413))
    let body
    try { body = JSON.parse(text) } catch { return cors(json({ error: '请求必须为 JSON' }, 400)) }
    return cors(await proxyWikiMirror(body))
  }
  if (path === '/api/account/profile' && request.method === 'PATCH') return updateAccountProfile(request, env)
  if (path === '/api/account/password' && request.method === 'POST') return updateAccountPassword(request, env)
  if (path === '/api/stats' && request.method === 'GET') return publicStats(env)
  if (path === '/api/me' && request.method === 'GET') return me(request, env)
  if (path === '/api/keys' && request.method === 'GET') return listKeys(request, env)
  if (path === '/api/keys' && request.method === 'POST') return createKey(request, env)
  if (/^\/api\/keys\/\d+$/u.test(path) && request.method === 'DELETE') return revokeKey(request, env, Number(path.split('/').pop()))
  if (path === '/api/games' && request.method === 'GET') return listGames(request, env)
  if (path === '/api/games' && request.method === 'POST') return submitGame(request, env)
  if (/^\/api\/admin\/games\/[^/]+$/u.test(path) && request.method === 'PATCH') return updateGame(request, env, decodeURIComponent(path.split('/')[4]))
  if (/^\/api\/admin\/games\/[^/]+$/u.test(path) && request.method === 'DELETE') return deleteGame(request, env, decodeURIComponent(path.split('/')[4]))
  if (path === '/api/admin/update-policy' && request.method === 'GET') return getUpdatePolicy(request, env)
  if (path === '/api/admin/update-policy' && request.method === 'PATCH') return saveUpdatePolicy(request, env)
  if (/^\/api\/games\/[^/]+\/terms$/u.test(path) && request.method === 'GET') return listTerms(request, env, decodeURIComponent(path.split('/')[3]))
  if (/^\/api\/games\/[^/]+\/terms$/u.test(path) && request.method === 'POST') return createTranslationFromWeb(request, env, decodeURIComponent(path.split('/')[3]))
  if (/^\/api\/translations\/\d+\/vote$/u.test(path) && request.method === 'POST') return vote(request, env, Number(path.split('/')[3]))
  if (/^\/api\/translations\/\d+$/u.test(path) && request.method === 'PATCH') return editTranslationFromWeb(request, env, Number(path.split('/')[3]))
  if (path === '/api/v1/games' && request.method === 'GET') return apiGames(request, env)
  if (path === '/api/v1/games' && request.method === 'POST') return apiCreateGame(request, env)
  if (path === '/api/v1/dictionaries/batch' && request.method === 'POST') return apiDictionaries(request, env)
  if (path === '/api/v1/translations' && request.method === 'POST') return apiCreateTranslation(request, env)
  if (path === '/api/v1/translations/batch' && request.method === 'POST') return apiCreateTranslations(request, env)
  if (path === '/api/v1/translations/batch' && request.method === 'PATCH') return apiEditTranslations(request, env)
  if (/^\/api\/v1\/translations\/\d+$/u.test(path) && request.method === 'PATCH') return apiEditTranslation(request, env, Number(path.split('/')[4]))
  if (/^\/api\/v1\/dictionaries\/[^/]+$/u.test(path) && request.method === 'GET') return dictionary(env, decodeURIComponent(path.split('/')[4]))
  if (path === '/api/v1/contributions' && request.method === 'POST') return uploadContributions(request, env)
  if (path === '/api/admin/releases/sync' && request.method === 'POST') return syncReleaseNow(request, env)
  if (/^\/api\/admin\/models\/sync\/[^/]+$/u.test(path) && request.method === 'POST') return syncModelNow(request, env, decodeURIComponent(path.split('/').pop()))
  if (path.startsWith('/download/file/')) return downloadFile(request, env, path.slice('/download/file/'.length))
  if (path.startsWith('/download/model/')) return downloadModel(request, path.slice('/download/model/'.length))
  if (path === '/download/model-notice') return modelNotice()
  if (path === '/client-login' || path === '/client-login.html' || path === '/client-login.js') return new Response('Not Found', { status: 404 })
  if (path === '/' || path === '/dashboard' || path === '/how-it-works' || path === '/client' || path === '/download' || path === '/donate' || path === '/client-auth-complete') return servePage(request, env)
  return secureAsset(await env.ASSETS.fetch(request))
}

async function downloadModel(request, platform) {
  if (!['GET', 'HEAD'].includes(request.method)) return json({ error: '下载入口仅支持 GET 或 HEAD' }, 405)
  const entry = modelAssets[platform]
  if (!entry) return json({ error: '未知模型类型' }, 404)
  return new Response(null, {
    status: 307,
    headers: {
      location: `${modelOrigin}/${encodeURIComponent(entry.filename)}`,
      'cache-control': 'public, max-age=300',
      'x-checksum-sha256': entry.sha256,
      link: '</download/model-notice>; rel="license"',
    },
  })
}

function modelNotice() {
  return new Response('TranslateGemma is provided under and subject to the Gemma Terms of Use found at https://ai.google.dev/gemma/terms\nNLLB-200 Distilled 600M and its compatible ONNX conversion are provided under CC BY-NC 4.0.\n', {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'content-disposition': 'attachment; filename="NOTICE.txt"',
      'cache-control': 'public, max-age=86400',
    },
  })
}

async function syncModelNow(request, env, platform) {
  const header = request.headers.get('authorization') || '', provided = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!env.RELEASE_SYNC_TOKEN || !provided || !safeEqual(provided, env.RELEASE_SYNC_TOKEN)) return json({ error: '同步凭据无效' }, 401)
  const entry = modelAssets[platform]
  if (!entry) return json({ error: '未知模型类型' }, 404)
  return json({ ok: true, platform, size: entry.size, external: true, url: `${modelOrigin}/${encodeURIComponent(entry.filename)}` })
}

async function downloadFile(request, env, key) {
  if (!['GET', 'HEAD'].includes(request.method)) return json({ error: '下载入口仅支持 GET 或 HEAD' }, 405)
  if (!downloadAssets[key]) return json({ error: '未知下载类型' }, 404)
  const manifestObject = await env.DOWNLOADS.get(downloadManifestKey)
  if (!manifestObject) return json({ error: '下载镜像正在初始化，请稍后重试', releasePage: githubReleasePage }, 503)
  const manifest = await manifestObject.json(), entry = manifest?.assets?.[key]
  if (!entry?.objectKey || !entry?.filename) return json({ error: '最新发布中没有该平台文件', releasePage: githubReleasePage }, 404)
  const object = request.method === 'HEAD'
    ? await env.DOWNLOADS.head(entry.objectKey)
    : await env.DOWNLOADS.get(entry.objectKey, { onlyIf: request.headers, range: request.headers })
  if (!object) return json({ error: 'R2 下载对象暂不可用，请稍后重试', releasePage: githubReleasePage }, 503)
  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('etag', object.httpEtag)
  headers.set('accept-ranges', 'bytes')
  headers.set('cache-control', 'public, max-age=300')
  headers.set('content-disposition', `attachment; filename="${entry.filename}"`)
  if (request.method === 'HEAD') {
    headers.set('content-length', String(object.size))
    return new Response(null, { status: 200, headers })
  }
  if (!('body' in object)) return new Response(null, { status: 412, headers })
  let status = 200
  if (object.range && Number.isFinite(object.range.offset) && Number.isFinite(object.range.length)) {
    status = 206
    headers.set('content-range', `bytes ${object.range.offset}-${object.range.offset + object.range.length - 1}/${object.size}`)
    headers.set('content-length', String(object.range.length))
  } else {
    headers.set('content-length', String(object.size))
  }
  return new Response(object.body, { status, headers })
}

async function syncReleaseNow(request, env) {
  const header = request.headers.get('authorization') || '', provided = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!env.RELEASE_SYNC_TOKEN || !provided || !safeEqual(provided, env.RELEASE_SYNC_TOKEN)) return json({ error: '同步凭据无效' }, 401)
  return json(await syncLatestRelease(env))
}

async function syncLatestRelease(env) {
  const response = await fetch(githubReleasesUrl, { headers: githubHeaders })
  if (!response.ok) throw new Error(`GitHub Releases API ${response.status}`)
  const release = (await response.json()).find((item) => !item?.draft && Array.isArray(item?.assets))
  if (!release) throw new Error('GitHub 没有可同步的 Release')
  const selected = {}, missing = []
  for (const [key, rule] of Object.entries(downloadAssets)) {
    const asset = release.assets
      .filter((item) => item?.state === 'uploaded' && item.name?.startsWith(rule.prefix) && item.name.endsWith(rule.suffix))
      .sort((left, right) => String(right.updated_at || '').localeCompare(String(left.updated_at || '')))[0]
    if (!asset) missing.push(key)
    else selected[key] = asset
  }
  if (missing.length) throw new Error(`最新 Release 缺少下载页资产：${missing.join(', ')}`)

  const manifest = { tag: release.tag_name, releaseId: release.id, syncedAt: new Date().toISOString(), assets: {} }
  const desiredKeys = new Set(Object.values(selected).map((asset) => `${downloadObjectPrefix}${asset.name}`))

  // Model objects consume most of the free R2 allowance. Keeping both the old
  // and new release installers during a sync can exceed the bucket limit, so
  // remove release objects that are not part of the incoming release before
  // uploading anything. The manifest is switched only after every new object
  // has been stored successfully.
  let cleanupCursor
  let deletedObjects = 0
  do {
    const page = await env.DOWNLOADS.list({ prefix: downloadObjectPrefix, cursor: cleanupCursor })
    const stale = page.objects.map((item) => item.key).filter((key) => !desiredKeys.has(key))
    if (stale.length) {
      await env.DOWNLOADS.delete(stale)
      deletedObjects += stale.length
    }
    cleanupCursor = page.truncated ? page.cursor : undefined
  } while (cleanupCursor)
  if (deletedObjects) console.log(`R2 release pre-cleanup removed ${deletedObjects} stale objects`)

  for (const [key, asset] of Object.entries(selected)) {
    const objectKey = `${downloadObjectPrefix}${asset.name}`
    const existing = await env.DOWNLOADS.head(objectKey)
    if (!existing || existing.customMetadata?.githubAssetId !== String(asset.id) || existing.size !== asset.size) {
      const assetUrl = new URL(asset.browser_download_url)
      if (assetUrl.protocol !== 'https:' || assetUrl.hostname !== 'github.com' || !assetUrl.pathname.startsWith(`/${githubRepository}/releases/download/`)) throw new Error(`GitHub 返回了无效下载地址：${asset.name}`)
      const binary = await fetch(assetUrl, { headers: { 'user-agent': githubHeaders['user-agent'] }, redirect: 'follow' })
      if (!binary.ok || !binary.body) throw new Error(`下载 ${asset.name} 失败：${binary.status}`)
      await env.DOWNLOADS.put(objectKey, binary.body, {
        httpMetadata: { contentType: binary.headers.get('content-type') || 'application/octet-stream', contentDisposition: `attachment; filename="${asset.name}"`, cacheControl: 'public, max-age=300' },
        customMetadata: { githubAssetId: String(asset.id), releaseId: String(release.id), tag: String(release.tag_name || '') },
      })
    }
    manifest.assets[key] = { objectKey, filename: asset.name, size: asset.size, githubAssetId: asset.id }
  }

  await env.DOWNLOADS.put(downloadManifestKey, JSON.stringify(manifest), { httpMetadata: { contentType: 'application/json; charset=utf-8', cacheControl: 'no-store' } })
  console.log(`R2 release mirror synced: ${manifest.tag}, ${Object.keys(manifest.assets).length} assets`)
  return { ok: true, tag: manifest.tag, assets: Object.keys(manifest.assets).length }
}

async function startGithubAuth(request, env) {
  if (!env.GITHUB_CLIENT_ID) return json({ error: 'GitHub OAuth 尚未配置' }, 503)
  const requestedIntent = new URL(request.url).searchParams.get('intent')
  const intent = requestedIntent === 'bind' || requestedIntent === 'client' ? requestedIntent : 'login'
  const state = randomToken(24), callback = `${env.SITE_ORIGIN}/auth/github/callback`
  const target = new URL('https://github.com/login/oauth/authorize')
  target.search = new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID, redirect_uri: callback, scope: 'read:user', state }).toString()
  const headers = new Headers({ location: target.toString() })
  headers.append('set-cookie', cookie('oauth_state', state, 600))
  headers.append('set-cookie', cookie('oauth_intent', intent, 600))
  return new Response(null, { status: 302, headers })
}

async function githubCallback(request, env) {
  const url = new URL(request.url), state = url.searchParams.get('state'), expected = cookies(request).oauth_state, code = url.searchParams.get('code')
  if (!code || !state || !expected || !safeEqual(state, expected)) return json({ error: 'GitHub 登录状态校验失败' }, 400)
  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': 'NSTrans Community' }, body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code, redirect_uri: `${env.SITE_ORIGIN}/auth/github/callback` }) })
  const token = await tokenResponse.json()
  if (!tokenResponse.ok || !token.access_token) return json({ error: token.error_description || 'GitHub 授权交换失败' }, 401)
  const profileResponse = await fetch('https://api.github.com/user', { headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token.access_token}`, 'user-agent': 'NSTrans Community', 'x-github-api-version': '2022-11-28' } })
  const profile = await profileResponse.json()
  if (!profileResponse.ok || !profile.id || !profile.login) return json({ error: '无法读取 GitHub 用户资料' }, 401)
  const admins = (env.ADMIN_GITHUB_LOGINS || '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean)
  const role = admins.includes(String(profile.login).toLowerCase()) ? 'admin' : 'user'
  const intent = cookies(request).oauth_intent
  if (intent === 'bind') {
    const active = await currentUser(request, env)
    if (!active) return json({ error: '绑定前请先登录当前账号' }, 401)
    const occupied = await env.DB.prepare('SELECT id FROM users WHERE github_id=? AND id<>?').bind(profile.id, active.id).first()
    if (occupied) return json({ error: '该 GitHub 账号已绑定其他 NSTrans 账号' }, 409)
    await env.DB.prepare(`UPDATE users SET github_id=?,github_login=?,login=?,avatar_url=?,role=CASE WHEN ?='admin' THEN 'admin' ELSE role END,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(profile.id, profile.login, profile.login, profile.avatar_url || '', role, active.id).run()
    const headers = new Headers({ location: `${env.SITE_ORIGIN}/dashboard?view=account` })
    headers.append('set-cookie', cookie('oauth_state', '', 0)); headers.append('set-cookie', cookie('oauth_intent', '', 0))
    return new Response(null, { status: 302, headers })
  }
  const usernameTaken = await env.DB.prepare('SELECT id FROM users WHERE username=? COLLATE NOCASE').bind(profile.login).first()
  const initialUsername = usernameTaken ? `${profile.login}-${profile.id}`.slice(0, 32) : profile.login
  await env.DB.prepare(`INSERT INTO users(github_id, login, username, github_login, avatar_url, role) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(github_id) DO UPDATE SET login=excluded.login, avatar_url=excluded.avatar_url,
    github_login=excluded.github_login,role=CASE WHEN excluded.role='admin' THEN 'admin' ELSE users.role END, updated_at=CURRENT_TIMESTAMP`).bind(profile.id, profile.login, initialUsername, profile.login, profile.avatar_url || '', role).run()
  const user = await env.DB.prepare('SELECT id FROM users WHERE github_id=?').bind(profile.id).first()
  if (intent === 'client') {
    const result = await completeClientAuthFlow(request, env, user.id)
    if (result) return result
    return json({ error: '客户端授权会话无效或已过期' }, 401)
  }
  const raw = randomToken(32), hash = await sha256(raw)
  await env.DB.batch([env.DB.prepare('DELETE FROM sessions WHERE expires_at <= CURRENT_TIMESTAMP'), env.DB.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,datetime('now','+30 days'))").bind(hash, user.id)])
  const headers = new Headers({ location: `${env.SITE_ORIGIN}/dashboard` }); headers.append('set-cookie', cookie('session', raw, 30 * 86400)); headers.append('set-cookie', cookie('oauth_state', '', 0)); headers.append('set-cookie', cookie('oauth_intent', '', 0))
  return new Response(null, { status: 302, headers })
}

async function startClientAuth(request, env) {
  const body = await readJson(request)
  let build
  try { build = await verifyClientBuild(body.attestation, env) }
  catch (error) { return json({ error: error.message || '客户端构建凭证无效' }, 401) }
  const deviceId = clean(body.deviceId, 80), deviceName = clean(body.deviceName, 120) || `${build.platform || 'NSTrans'} 客户端`
  if (!deviceId) return json({ error: '缺少客户端设备标识' }, 400)
  const browserToken = randomToken(32), pollToken = randomToken(32)
  await env.DB.batch([
    env.DB.prepare('DELETE FROM client_auth_flows WHERE expires_at<=CURRENT_TIMESTAMP OR claimed_at IS NOT NULL'),
    env.DB.prepare("INSERT INTO client_auth_flows(browser_token_hash,poll_token_hash,build_version,platform,variant,device_id,device_name,expires_at) VALUES(?,?,?,?,?,?,?,datetime('now','+10 minutes'))").bind(await sha256(browserToken), await sha256(pollToken), build.version, build.platform || '', build.variant || '', deviceId, deviceName),
  ])
  return json({ browserUrl: `${env.SITE_ORIGIN}/auth/client/github?code=${encodeURIComponent(browserToken)}`, pollToken, expiresIn: 600, build })
}

async function beginClientGithubAuth(request, env) {
  const raw = new URL(request.url).searchParams.get('code') || ''
  const hash = await sha256(raw)
  const flow = raw && await env.DB.prepare('SELECT browser_token_hash FROM client_auth_flows WHERE browser_token_hash=? AND browser_started_at IS NULL AND completed_at IS NULL AND expires_at>CURRENT_TIMESTAMP').bind(hash).first()
  if (!flow) return json({ error: '客户端 GitHub 授权链接无效或已过期' }, 401)
  await env.DB.prepare('UPDATE client_auth_flows SET browser_started_at=CURRENT_TIMESTAMP WHERE browser_token_hash=?').bind(hash).run()
  const headers = new Headers({ location: `${env.SITE_ORIGIN}/auth/github?intent=client` })
  headers.append('set-cookie', cookie('client_flow', raw, 600))
  return new Response(null, { status: 302, headers })
}

async function completeClientAuthFlow(request, env, userId) {
  const raw = cookies(request).client_flow || ''
  if (!raw) return null
  const hash = await sha256(raw)
  const flow = await env.DB.prepare('SELECT device_id,device_name FROM client_auth_flows WHERE browser_token_hash=? AND completed_at IS NULL AND expires_at>CURRENT_TIMESTAMP').bind(hash).first()
  if (!flow) return null
  const apiKey = await issueClientApiKey(env, userId, flow.device_id, flow.device_name)
  const encrypted = await encryptTemporarySecret(apiKey, env.CLIENT_ACCESS_SECRET)
  await env.DB.prepare('UPDATE client_auth_flows SET user_id=?,encrypted_api_key=?,encryption_iv=?,completed_at=CURRENT_TIMESTAMP WHERE browser_token_hash=?').bind(userId, encrypted.value, encrypted.iv, hash).run()
  const headers = new Headers({ location: `${env.SITE_ORIGIN}/client-auth-complete` })
  headers.append('set-cookie', cookie('client_flow', '', 0)); headers.append('set-cookie', cookie('oauth_state', '', 0)); headers.append('set-cookie', cookie('oauth_intent', '', 0))
  return new Response(null, { status: 302, headers })
}

async function pollClientAuth(request, env) {
  const pollToken = clean((await readJson(request)).pollToken, 100)
  if (!pollToken) return json({ error: '缺少客户端轮询凭证' }, 400)
  const hash = await sha256(pollToken)
  const flow = await env.DB.prepare('SELECT encrypted_api_key,encryption_iv,completed_at,claimed_at,expires_at FROM client_auth_flows WHERE poll_token_hash=?').bind(hash).first()
  if (!flow || Date.parse(`${flow.expires_at}Z`) <= Date.now()) return json({ status: 'expired', error: '授权会话已过期' }, 410)
  if (flow.claimed_at) return json({ status: 'claimed', error: '授权结果已经领取' }, 410)
  if (!flow.completed_at || !flow.encrypted_api_key) return json({ status: 'pending' }, 202)
  const apiKey = await decryptTemporarySecret(flow.encrypted_api_key, flow.encryption_iv, env.CLIENT_ACCESS_SECRET)
  await env.DB.prepare('UPDATE client_auth_flows SET claimed_at=CURRENT_TIMESTAMP,encrypted_api_key=NULL,encryption_iv=NULL WHERE poll_token_hash=? AND claimed_at IS NULL').bind(hash).run()
  return json({ status: 'complete', apiKey })
}

async function nativeClientLogin(request, env) {
  const body = await readJson(request)
  try { await verifyClientBuild(body.attestation, env) }
  catch (error) { return json({ error: error.message || '客户端构建凭证无效' }, 401) }
  const username = clean(body.username, 32), password = typeof body.password === 'string' ? body.password : ''
  const user = await env.DB.prepare('SELECT id,password_hash,password_salt,password_iterations FROM users WHERE username=? COLLATE NOCASE').bind(username).first()
  if (!user?.password_hash || !(await verifyPassword(password, user))) return json({ error: '用户名或密码错误' }, 401)
  const apiKey = await issueClientApiKey(env, user.id, clean(body.deviceId, 80), clean(body.deviceName, 120))
  return json({ apiKey, username })
}

async function nativeClientRegister(request, env) {
  const body = await readJson(request)
  try { await verifyClientBuild(body.attestation, env) }
  catch (error) { return json({ error: error.message || '客户端构建凭证无效' }, 401) }
  const username = clean(body.username, 32), password = typeof body.password === 'string' ? body.password : ''
  const invalid = validateCredentials(username, password); if (invalid) return json({ error: invalid }, 400)
  if (await env.DB.prepare('SELECT id FROM users WHERE username=? COLLATE NOCASE').bind(username).first()) return json({ error: '用户名已被使用' }, 409)
  const passwordData = await hashPassword(password)
  let githubId
  do { githubId = -Math.floor(1 + Math.random() * Number.MAX_SAFE_INTEGER) } while (await env.DB.prepare('SELECT id FROM users WHERE github_id=?').bind(githubId).first())
  const result = await env.DB.prepare('INSERT INTO users(github_id,login,username,avatar_url,role,password_hash,password_salt,password_iterations) VALUES(?,?,?,?,?,?,?,?)').bind(githubId, username, username, '', 'user', passwordData.hash, passwordData.salt, passwordData.iterations).run()
  const apiKey = await issueClientApiKey(env, result.meta.last_row_id, clean(body.deviceId, 80), clean(body.deviceName, 120))
  return json({ apiKey, username }, 201)
}

async function clientUpdatePolicy(request, env) {
  const currentVersion = clean(new URL(request.url).searchParams.get('version'), 40)
  const policy = await env.DB.prepare('SELECT target_version,popup_enabled,force_update,content,download_url,updated_at FROM client_update_policy WHERE id=1').first()
  if (!policy) return json({ shouldShow: false })
  const forceUpdate = Boolean(policy.force_update)
  const popupEnabled = forceUpdate || Boolean(policy.popup_enabled)
  const versionBehind = /^\d+\.\d+\.\d+(?:[-+].*)?$/u.test(currentVersion) && compareVersions(currentVersion, policy.target_version) < 0
  return json({
    targetVersion: policy.target_version,
    popupEnabled,
    forceUpdate,
    content: policy.content,
    downloadUrl: policy.download_url,
    updatedAt: policy.updated_at,
    shouldShow: versionBehind && popupEnabled,
  })
}

async function issueClientApiKey(env, userId, deviceId, deviceName) {
  const resolvedDeviceId = deviceId || randomToken(16), resolvedDeviceName = deviceName || 'NSTrans 客户端'
  await env.DB.prepare("UPDATE api_keys SET revoked_at=CURRENT_TIMESTAMP WHERE user_id=? AND device_id=? AND origin='official-client' AND revoked_at IS NULL").bind(userId, resolvedDeviceId).run()
  const raw = `nst_live_${randomToken(24)}`, prefix = raw.slice(0, 17)
  await env.DB.prepare("INSERT INTO api_keys(user_id,key_prefix,key_hash,origin,device_id,device_name) VALUES(?,?,?,?,?,?)").bind(userId, prefix, await sha256(raw), 'official-client', resolvedDeviceId, resolvedDeviceName).run()
  return raw
}

async function temporaryEncryptionKey(secret) {
  if (!secret) throw new Error('客户端账号服务尚未完成配置')
  const material = await crypto.subtle.digest('SHA-256', encoder.encode(`nstrans-client-flow:${secret}`))
  return crypto.subtle.importKey('raw', material, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}
async function encryptTemporarySecret(value, secret) { const iv = crypto.getRandomValues(new Uint8Array(12)); const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await temporaryEncryptionKey(secret), encoder.encode(value)); return { value: bytesBase64url(new Uint8Array(encrypted)), iv: bytesBase64url(iv) } }
async function decryptTemporarySecret(value, iv, secret) { const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64urlBytes(iv) }, await temporaryEncryptionKey(secret), base64urlBytes(value)); return new TextDecoder().decode(decrypted) }

async function verifyClientBuild(attestation, env) {
  if (typeof attestation !== 'string' || attestation.length > 8192) throw new Error('缺少客户端构建凭证')
  let envelope, payload
  try {
    envelope = JSON.parse(new TextDecoder().decode(base64urlBytes(attestation)))
    payload = JSON.parse(new TextDecoder().decode(base64urlBytes(envelope.payload)))
  } catch { throw new Error('客户端构建凭证格式无效') }
  const keys = JSON.parse(env.CLIENT_BUILD_PUBLIC_KEYS || '{}')
  const publicKey = keys[payload.keyId]
  if (!publicKey || payload.schema !== 1 || !envelope.signature) throw new Error('客户端签名密钥未知')
  if (!/^\d+\.\d+\.\d+(?:[-+].*)?$/u.test(payload.version || '')) throw new Error('客户端版本无效')
  if (compareVersions(payload.version, env.CLIENT_MIN_VERSION || '0.1.4') < 0) throw new Error(`客户端版本过低，请升级至 ${env.CLIENT_MIN_VERSION || '0.1.4'} 或更高版本`)
  if (!Number.isFinite(Date.parse(payload.issuedAt)) || !Number.isFinite(Date.parse(payload.expiresAt))) throw new Error('客户端构建时间信息无效')
  const key = await crypto.subtle.importKey('raw', base64urlBytes(publicKey), { name: 'Ed25519' }, false, ['verify'])
  const valid = await crypto.subtle.verify('Ed25519', key, base64urlBytes(envelope.signature), encoder.encode(envelope.payload))
  if (!valid) throw new Error('客户端构建签名校验失败')
  return { version: payload.version, keyId: payload.keyId, platform: payload.platform, variant: payload.variant, issuedAt: payload.issuedAt, expiresAt: payload.expiresAt }
}

async function updateAccountProfile(request, env) {
  const auth = await requireUser(request, env); if (auth.response) return auth.response
  const username = clean((await readJson(request)).username, 32)
  if (!validUsername(username)) return json({ error: '用户名需为 3–32 个中英文字、数字、下划线或连字符' }, 400)
  try { await env.DB.prepare('UPDATE users SET username=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(username, auth.user.id).run() }
  catch { return json({ error: '用户名已被使用' }, 409) }
  return json({ ok: true, username })
}

async function updateAccountPassword(request, env) {
  const auth = await requireUser(request, env); if (auth.response) return auth.response
  const password = String((await readJson(request)).password || '')
  if (password.length < 10 || password.length > 128) return json({ error: '密码长度需为 10–128 个字符' }, 400)
  const data = await hashPassword(password)
  await env.DB.prepare('UPDATE users SET password_hash=?,password_salt=?,password_iterations=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(data.hash, data.salt, data.iterations, auth.user.id).run()
  return json({ ok: true })
}

function validateCredentials(username, password) {
  if (!validUsername(username)) return '用户名需为 3–32 个中英文字、数字、下划线或连字符'
  if (password.length < 10 || password.length > 128) return '密码长度需为 10–128 个字符'
  return ''
}
function validUsername(value) { return /^[\p{L}\p{N}_-]{3,32}$/u.test(value) }
async function hashPassword(password, salt = randomToken(16), iterations = 180000) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: encoder.encode(salt), iterations }, key, 256)
  return { hash: bytesBase64url(new Uint8Array(bits)), salt, iterations }
}
async function verifyPassword(password, user) { const result = await hashPassword(password, user.password_salt, user.password_iterations); return safeEqual(result.hash, user.password_hash) }
function base64urlBytes(value) { const base64 = value.replace(/-/gu, '+').replace(/_/gu, '/').padEnd(Math.ceil(value.length / 4) * 4, '='); return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0)) }
function bytesBase64url(bytes) { return btoa(String.fromCharCode(...bytes)).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/gu, '') }
function compareVersions(left, right) { const a = left.split(/[.+-]/u).slice(0, 3).map(Number), b = right.split(/[.+-]/u).slice(0, 3).map(Number); for (let i = 0; i < 3; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) - (b[i] || 0); return 0 }

async function logout(request, env) {
  const raw = cookies(request).session
  if (raw) await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await sha256(raw)).run()
  return new Response(null, { status: 302, headers: { location: '/', 'set-cookie': cookie('session', '', 0) } })
}

async function currentUser(request, env) {
  const raw = cookies(request).session
  if (!raw) return null
  return env.DB.prepare(`SELECT u.id,COALESCE(u.username,u.login) login,u.avatar_url,u.role,(u.github_id>0) github_bound,(u.password_hash IS NOT NULL) has_password FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>CURRENT_TIMESTAMP`).bind(await sha256(raw)).first()
}

async function requireUser(request, env, admin = false) {
  const user = await currentUser(request, env)
  if (!user) return { response: json({ error: '请先登录 NSTrans 账号' }, 401) }
  if (admin && user.role !== 'admin') return { response: json({ error: '需要管理员权限' }, 403) }
  if (request.method !== 'GET' && !sameOrigin(request, env)) return { response: json({ error: '来源校验失败' }, 403) }
  return { user }
}

async function me(request, env) { const user = await currentUser(request, env); return user ? json({ user }) : json({ user: null }, 401) }

async function publicStats(env) {
  const row = await env.DB.prepare(`SELECT
    (SELECT COUNT(*) FROM games WHERE status='approved') games,
    (SELECT COUNT(*) FROM terms) terms,
    (SELECT COUNT(*) FROM translations) translations,
    (SELECT COUNT(*) FROM users) contributors`).first()
  return json(row)
}

async function listKeys(request, env) {
  const auth = await requireUser(request, env); if (auth.response) return auth.response
  const { results } = await env.DB.prepare('SELECT id,key_prefix,origin,device_name,created_at,last_used_at FROM api_keys WHERE user_id=? AND revoked_at IS NULL ORDER BY id DESC').bind(auth.user.id).all()
  return json({ keys: results })
}

async function createKey(request, env) {
  const auth = await requireUser(request, env); if (auth.response) return auth.response
  const count = await env.DB.prepare('SELECT COUNT(*) count FROM api_keys WHERE user_id=? AND revoked_at IS NULL').bind(auth.user.id).first()
  if (count.count >= 5) return json({ error: '最多保留 5 个有效 Key，请先撤销旧 Key' }, 409)
  const raw = `nst_live_${randomToken(24)}`, prefix = raw.slice(0, 17)
  const result = await env.DB.prepare('INSERT INTO api_keys(user_id,key_prefix,key_hash) VALUES(?,?,?)').bind(auth.user.id, prefix, await sha256(raw)).run()
  return json({ key: raw, id: result.meta.last_row_id, prefix }, 201)
}

async function revokeKey(request, env, id) {
  const auth = await requireUser(request, env); if (auth.response) return auth.response
  await env.DB.prepare('UPDATE api_keys SET revoked_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?').bind(id, auth.user.id).run()
  return json({ ok: true })
}

async function listGames(request, env) {
  const { results } = await env.DB.prepare(`SELECT g.*,COALESCE(u.username,u.login) submitter FROM games g LEFT JOIN users u ON u.id=g.submitted_by
    WHERE g.status='approved' ORDER BY g.created_at DESC`).all()
  return json({ games: results })
}

async function submitGame(request, env) {
  const auth = await requireUser(request, env); if (auth.response) return auth.response
  const result = await createGame(env, await readJson(request), auth.user)
  return json(result.body, result.status)
}

async function updateGame(request, env, id) {
  const auth = await requireUser(request, env, true); if (auth.response) return auth.response
  const current = await env.DB.prepare('SELECT id,japanese_name,chinese_name,poster_url FROM games WHERE id=? AND status=?').bind(id, 'approved').first()
  if (!current) return json({ error: '游戏不存在' }, 404)
  const body = await readJson(request)
  const chinese = body.chineseName === undefined ? current.chinese_name : clean(body.chineseName, 120)
  const japanese = body.japaneseName === undefined ? current.japanese_name : clean(body.japaneseName, 120)
  const poster = body.posterUrl === undefined ? current.poster_url || '' : clean(body.posterUrl, 600)
  const validation = validateGameInput(chinese, poster)
  if (validation) return json({ error: validation }, 400)
  const duplicate = await env.DB.prepare('SELECT id FROM games WHERE chinese_name=? AND id!=? AND status=?').bind(chinese, id, 'approved').first()
  if (duplicate) return json({ error: '已存在同名中文游戏' }, 409)
  await env.DB.prepare(`UPDATE games SET japanese_name=?,chinese_name=?,poster_url=?,approved_by=?,updated_at=CURRENT_TIMESTAMP
    WHERE id=?`).bind(japanese, chinese, poster || null, auth.user.id, id).run()
  return json({ id, chineseName: chinese, japaneseName: japanese, posterUrl: poster || null, status: 'approved' })
}

async function deleteGame(request, env, id) {
  const auth = await requireUser(request, env, true); if (auth.response) return auth.response
  if (id === 'general') return json({ error: '通用词库不能删除' }, 400)
  const result = await env.DB.prepare('DELETE FROM games WHERE id=?').bind(id).run()
  if (!result.meta.changes) return json({ error: '游戏不存在' }, 404)
  return json({ ok: true, id })
}

async function getUpdatePolicy(request, env) {
  const auth = await requireUser(request, env, true); if (auth.response) return auth.response
  const policy = await env.DB.prepare('SELECT target_version,popup_enabled,force_update,content,download_url,updated_at FROM client_update_policy WHERE id=1').first()
  return json({ policy })
}

async function saveUpdatePolicy(request, env) {
  const auth = await requireUser(request, env, true); if (auth.response) return auth.response
  const body = await readJson(request), targetVersion = clean(body.targetVersion, 40), content = clean(body.content, 2000)
  const forceUpdate = Boolean(body.forceUpdate), popupEnabled = forceUpdate || Boolean(body.popupEnabled)
  const downloadUrl = clean(body.downloadUrl, 600) || `${env.SITE_ORIGIN}/download`
  if (!/^\d+\.\d+\.\d+(?:[-+].*)?$/u.test(targetVersion)) return json({ error: '目标版本必须使用 1.2.3 格式' }, 400)
  if (!content) return json({ error: '弹窗内容不能为空' }, 400)
  if (!isHttpsUrl(downloadUrl)) return json({ error: '下载地址必须使用 HTTPS' }, 400)
  await env.DB.prepare(`INSERT INTO client_update_policy(id,target_version,popup_enabled,force_update,content,download_url,updated_by,updated_at)
    VALUES(1,?,?,?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET target_version=excluded.target_version,popup_enabled=excluded.popup_enabled,
    force_update=excluded.force_update,content=excluded.content,download_url=excluded.download_url,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`)
    .bind(targetVersion, popupEnabled ? 1 : 0, forceUpdate ? 1 : 0, content, downloadUrl, auth.user.id).run()
  return json({ ok: true, policy: { target_version: targetVersion, popup_enabled: popupEnabled ? 1 : 0, force_update: forceUpdate ? 1 : 0, content, download_url: downloadUrl } })
}

async function listTerms(request, env, gameId) {
  const game = await env.DB.prepare("SELECT id FROM games WHERE id=? AND status='approved'").bind(gameId).first()
  if (!game) return json({ error: '游戏不存在' }, 404)
  const search = clean(new URL(request.url).searchParams.get('q'), 80)
  const pattern = `%${escapeLike(search)}%`
  const statement = search
    ? env.DB.prepare(`SELECT t.id term_id,t.source_text,t.kind,tr.id translation_id,tr.target_text,tr.score
      FROM terms t LEFT JOIN translations tr ON tr.term_id=t.id
      WHERE t.game_id=? AND (t.source_text LIKE ? ESCAPE '\\' OR EXISTS (
        SELECT 1 FROM translations matched WHERE matched.term_id=t.id AND matched.target_text LIKE ? ESCAPE '\\'
      )) ORDER BY t.updated_at DESC,tr.score DESC LIMIT 3000`).bind(gameId, pattern, pattern)
    : env.DB.prepare(`SELECT t.id term_id,t.source_text,t.kind,tr.id translation_id,tr.target_text,tr.score
      FROM terms t LEFT JOIN translations tr ON tr.term_id=t.id WHERE t.game_id=? ORDER BY t.updated_at DESC,tr.score DESC LIMIT 3000`).bind(gameId)
  const { results } = await statement.all()
  const terms = groupTerms(results)
  if (gameId !== 'general') return json({ terms, searchExclusions: [], searchExclusionCount: 0 })
  const [{ results: exclusions }, count] = await Promise.all([
    search
      ? env.DB.prepare("SELECT source_text,source_name,source_url FROM search_exclusions WHERE game_id=? AND source_text LIKE ? ESCAPE '\\' ORDER BY source_text LIMIT 500").bind(gameId, pattern).all()
      : env.DB.prepare('SELECT source_text,source_name,source_url FROM search_exclusions WHERE game_id=? ORDER BY source_text LIMIT 500').bind(gameId).all(),
    env.DB.prepare('SELECT COUNT(*) count FROM search_exclusions WHERE game_id=?').bind(gameId).first(),
  ])
  return json({ terms, searchExclusions: exclusions, searchExclusionCount: count?.count ?? 0 })
}

async function vote(request, env, translationId) {
  const auth = await requireUser(request, env); if (auth.response) return auth.response
  const body = await readJson(request), value = Number(body.value)
  if (value !== 1 && value !== -1) return json({ error: '评分只能是赞或踩' }, 400)
  const exists = await env.DB.prepare('SELECT id FROM translations WHERE id=?').bind(translationId).first()
  if (!exists) return json({ error: '译文不存在' }, 404)
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO votes(user_id,translation_id,value) VALUES(?,?,?)
      ON CONFLICT(user_id,translation_id) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP`).bind(auth.user.id, translationId, value),
    env.DB.prepare('UPDATE translations SET score=bonus_score+(SELECT COALESCE(SUM(value),0) FROM votes WHERE translation_id=?),updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(translationId, translationId),
  ])
  const result = await env.DB.prepare('SELECT score FROM translations WHERE id=?').bind(translationId).first()
  return json({ score: result?.score ?? 0 })
}

async function editTranslationFromWeb(request, env, translationId) {
  const auth = await requireUser(request, env); if (auth.response) return auth.response
  const body = await readJson(request)
  const result = await editTranslation(env, translationId, body, auth.user, null, 'web', 3)
  return json(result.body, result.status)
}

async function createTranslationFromWeb(request, env, gameId) {
  const auth = await requireUser(request, env); if (auth.response) return auth.response
  const result = await createDictionaryEntry(env, { ...(await readJson(request)), gameId }, auth.user, null, 'web', 3)
  return json(result.body, result.status)
}

async function apiGames(_request, env) {
  const { results } = await env.DB.prepare(`SELECT id,japanese_name,chinese_name,poster_url,updated_at
    FROM games WHERE status='approved' ORDER BY chinese_name,id`).all()
  return cors(json({ games: results.map((game) => ({ id: game.id, japaneseName: game.japanese_name, chineseName: game.chinese_name, posterUrl: game.poster_url, updatedAt: game.updated_at })) }))
}

async function apiCreateGame(request, env) {
  const auth = await apiKeyUser(request, env); if (auth.response) return cors(auth.response)
  const result = await createGame(env, await readJson(request), auth.user)
  return cors(json(result.body, result.status))
}

function validateGameInput(chinese, poster) {
  if (!chinese) return '游戏中文名为必填项'
  if (poster && !isHttpsUrl(poster)) return '封面 URL 必须为空或使用有效的 HTTPS 地址'
  return ''
}

async function createGame(env, body, user) {
  const chinese = clean(body?.chineseName, 120)
  const japanese = clean(body?.japaneseName, 120)
  const poster = clean(body?.posterUrl, 600)
  const validation = validateGameInput(chinese, poster)
  if (validation) return { status: 400, body: { error: validation } }
  const duplicate = await env.DB.prepare('SELECT id FROM games WHERE chinese_name=? AND status=?').bind(chinese, 'approved').first()
  if (duplicate) return { status: 409, body: { error: '已存在同名中文游戏', id: duplicate.id } }
  const id = `game-${randomToken(10).toLowerCase()}`
  await env.DB.prepare(`INSERT INTO games(id,japanese_name,chinese_name,poster_url,status,submitted_by,approved_by)
    VALUES(?,?,?,?,?,?,?)`).bind(id, japanese, chinese, poster || null, 'approved', user.id, user.role === 'admin' ? user.id : null).run()
  return { status: 201, body: { id, chineseName: chinese, japaneseName: japanese, posterUrl: poster || null, status: 'approved' } }
}

async function apiDictionaries(request, env) {
  const auth = await apiKeyUser(request, env); if (auth.response) return cors(auth.response)
  const body = await readJson(request)
  const gameIds = [...new Set((Array.isArray(body.gameIds) ? body.gameIds : []).map((id) => clean(id, 80)).filter(Boolean))]
  if (!gameIds.length || gameIds.length > 20) return cors(json({ error: 'gameIds 必须包含 1–20 个游戏 ID' }, 400))
  const placeholders = gameIds.map(() => '?').join(',')
  const { results: games } = await env.DB.prepare(`SELECT id,japanese_name,chinese_name FROM games WHERE status='approved' AND id IN (${placeholders})`).bind(...gameIds).all()
  if (games.length !== gameIds.length) {
    const found = new Set(games.map((game) => game.id))
    return cors(json({ error: '包含不存在的游戏', unknownGameIds: gameIds.filter((id) => !found.has(id)) }, 404))
  }
  const { results } = await env.DB.prepare(`SELECT t.game_id,t.id term_id,t.source_text,t.kind,tr.id translation_id,tr.target_text,tr.score,tr.updated_at
    FROM terms t JOIN translations tr ON tr.term_id=t.id WHERE t.game_id IN (${placeholders})
    ORDER BY t.game_id,t.source_text,tr.score DESC,tr.id LIMIT 10001`).bind(...gameIds).all()
  if (results.length > 10000) return cors(json({ error: '请求结果超过 10000 条，请减少 gameIds 后重试' }, 413))
  const dictionaries = Object.fromEntries(gameIds.map((gameId) => [gameId, []]))
  for (const row of results) dictionaries[row.game_id].push({ termId: row.term_id, translationId: row.translation_id, source: row.source_text, target: row.target_text, kind: row.kind, score: row.score, updatedAt: row.updated_at })
  return cors(json({ dictionaries }))
}

async function apiCreateTranslation(request, env) {
  const auth = await apiKeyUser(request, env); if (auth.response) return cors(auth.response)
  const result = await createDictionaryEntry(env, await readJson(request), auth.user, auth.user.key_id, 'api', 1)
  return cors(json(result.body, result.status))
}

async function apiCreateTranslations(request, env) {
  const auth = await apiKeyUser(request, env); if (auth.response) return cors(auth.response)
  const body = await readJson(request), items = body.items
  if (!Array.isArray(items) || !items.length || items.length > 100) return cors(json({ error: 'items 必须包含 1–100 条新增数据' }, 400))
  const created = [], rejected = []
  for (let index = 0; index < items.length; index++) {
    const result = await createDictionaryEntry(env, items[index], auth.user, auth.user.key_id, 'api', 1)
    if (result.status === 200 || result.status === 201) created.push({ index, ...result.body })
    else rejected.push({ index, reason: result.body.error })
  }
  return cors(json({ created, rejected }, rejected.length ? 207 : 201))
}

async function apiEditTranslation(request, env, translationId) {
  const auth = await apiKeyUser(request, env); if (auth.response) return cors(auth.response)
  const result = await editTranslation(env, translationId, await readJson(request), auth.user, auth.user.key_id, 'api', 1)
  return cors(json(result.body, result.status))
}

async function apiEditTranslations(request, env) {
  const auth = await apiKeyUser(request, env); if (auth.response) return cors(auth.response)
  const body = await readJson(request), items = body.items
  if (!Array.isArray(items) || !items.length || items.length > 100) return cors(json({ error: 'items 必须包含 1–100 条修改' }, 400))
  const updated = [], rejected = []
  for (let index = 0; index < items.length; index++) {
    const item = items[index], translationId = Number(item?.translationId)
    if (!Number.isSafeInteger(translationId) || translationId < 1) { rejected.push({ index, reason: 'translationId 无效' }); continue }
    const result = await editTranslation(env, translationId, item, auth.user, auth.user.key_id, 'api', 1)
    if (result.status === 200) updated.push({ index, ...result.body })
    else rejected.push({ index, translationId, reason: result.body.error })
  }
  return cors(json({ updated, rejected }, rejected.length ? 207 : 200))
}

async function editTranslation(env, translationId, body, user, apiKeyId, channel, scoreDelta) {
  const current = await env.DB.prepare(`SELECT tr.id,tr.term_id,tr.target_text,t.game_id,t.source_text,t.kind
    FROM translations tr JOIN terms t ON t.id=tr.term_id WHERE tr.id=?`).bind(translationId).first()
  if (!current) return { status: 404, body: { error: '译文不存在' } }
  const source = clean(body.source ?? current.source_text, 240), target = clean(body.target ?? current.target_text, 240)
  if (!source || !target) return { status: 400, body: { error: 'source 和 target 不能为空' } }
  if (!isEditableDictionaryItem(source, target)) return { status: 400, body: { error: '词条包含标点、日文译文或长度超限，不能写入词库' } }
  const normalizedSource = normalize(source), normalizedTarget = normalize(target)
  const sourceConflict = await env.DB.prepare('SELECT id FROM terms WHERE game_id=? AND normalized_source=? AND id!=?').bind(current.game_id, normalizedSource, current.term_id).first()
  if (sourceConflict) return { status: 409, body: { error: '修改后的原文已存在于该游戏词库' } }
  const targetConflict = await env.DB.prepare('SELECT id FROM translations WHERE term_id=? AND normalized_target=? AND id!=?').bind(current.term_id, normalizedTarget, translationId).first()
  if (targetConflict) return { status: 409, body: { error: '该词条已存在相同译文' } }
  if (source === current.source_text && target === current.target_text) return { status: 200, body: { translationId, source, target, unchanged: true } }
  await env.DB.batch([
    env.DB.prepare('UPDATE terms SET source_text=?,normalized_source=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(source, normalizedSource, current.term_id),
    env.DB.prepare(`UPDATE translations SET target_text=?,normalized_target=?,bonus_score=bonus_score+?,score=score+?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(target, normalizedTarget, scoreDelta, scoreDelta, translationId),
    env.DB.prepare(`INSERT INTO dictionary_edits(translation_id,user_id,api_key_id,channel,score_delta,before_source,before_target,after_source,after_target)
      VALUES(?,?,?,?,?,?,?,?,?)`).bind(translationId, user.id, apiKeyId, channel, scoreDelta, current.source_text, current.target_text, source, target),
  ])
  const updated = await env.DB.prepare('SELECT score,updated_at FROM translations WHERE id=?').bind(translationId).first()
  return { status: 200, body: { translationId, termId: current.term_id, source, target, score: updated.score, scoreDelta, updatedAt: updated.updated_at } }
}

async function createDictionaryEntry(env, body, user, apiKeyId, channel, scoreDelta) {
  const gameId = clean(body?.gameId, 80), source = clean(body?.source, 240), target = clean(body?.target, 240)
  const kind = body?.kind === 'phrase' ? 'phrase' : body?.kind === 'term' ? 'term' : ''
  if (!gameId || !source || !target || !kind) return { status: 400, body: { error: 'gameId、source、target 和 kind 均为必填项' } }
  if (!isEditableDictionaryItem(source, target)) return { status: 400, body: { error: '词条包含标点、日文译文或长度超限，不能写入词库' } }
  const game = await env.DB.prepare("SELECT id FROM games WHERE id=? AND status='approved'").bind(gameId).first()
  if (!game) return { status: 404, body: { error: '游戏不存在' } }
  const normalizedSource = normalize(source), normalizedTarget = normalize(target)
  await env.DB.prepare(`INSERT INTO terms(game_id,source_text,normalized_source,kind) VALUES(?,?,?,?)
    ON CONFLICT(game_id,normalized_source) DO UPDATE SET source_text=excluded.source_text,updated_at=CURRENT_TIMESTAMP`).bind(gameId, source, normalizedSource, kind).run()
  const term = await env.DB.prepare('SELECT id,kind FROM terms WHERE game_id=? AND normalized_source=?').bind(gameId, normalizedSource).first()
  const existing = await env.DB.prepare('SELECT id,score FROM translations WHERE term_id=? AND normalized_target=?').bind(term.id, normalizedTarget).first()
  if (existing) return { status: 200, body: { termId: term.id, translationId: existing.id, gameId, source, target, kind: term.kind, score: existing.score, unchanged: true } }
  await env.DB.prepare(`INSERT INTO translations(term_id,target_text,normalized_target,score,bonus_score,submitted_by,provenance)
    VALUES(?,?,?,?,?,?,?)`).bind(term.id, target, normalizedTarget, scoreDelta, scoreDelta, user.id, 'community').run()
  const translation = await env.DB.prepare('SELECT id,score,updated_at FROM translations WHERE term_id=? AND normalized_target=?').bind(term.id, normalizedTarget).first()
  await env.DB.prepare(`INSERT INTO dictionary_edits(translation_id,user_id,api_key_id,channel,score_delta,before_source,before_target,after_source,after_target)
    VALUES(?,?,?,?,?,?,?,?,?)`).bind(translation.id, user.id, apiKeyId, channel, scoreDelta, '', '', source, target).run()
  return { status: 201, body: { termId: term.id, translationId: translation.id, gameId, source, target, kind: term.kind, score: translation.score, scoreDelta, updatedAt: translation.updated_at } }
}

async function dictionary(env, gameId) {
  const game = await env.DB.prepare("SELECT id FROM games WHERE id=? AND status='approved'").bind(gameId).first()
  if (!game) return cors(json({ error: '游戏不存在' }, 404))
  const { results } = await env.DB.prepare(`SELECT source_text,target_text,kind,score,updated_at FROM (
    SELECT t.source_text,tr.target_text,t.kind,tr.score,tr.updated_at,
    ROW_NUMBER() OVER(PARTITION BY t.id ORDER BY tr.score DESC,tr.updated_at DESC) rank
    FROM terms t JOIN translations tr ON tr.term_id=t.id WHERE t.game_id=?) WHERE rank=1 ORDER BY source_text`).bind(gameId).all()
  const versionRow = await env.DB.prepare(`SELECT COALESCE(MAX(t.updated_at),'0') term_version,COALESCE(MAX(tr.updated_at),'0') translation_version,
    COUNT(tr.id) translation_count,COALESCE(SUM(tr.id),0) translation_ids,COALESCE(SUM(tr.id*tr.score),0) score_fingerprint
    FROM terms t LEFT JOIN translations tr ON tr.term_id=t.id WHERE t.game_id=?`).bind(gameId).first()
  const safeResults = results.filter((row) => !containsJapaneseKana(row.target_text) && !containsDictionaryPunctuation(row.source_text) && !containsDictionaryPunctuation(row.target_text))
  const exclusionRows = gameId === 'general' ? await env.DB.prepare('SELECT source_text FROM search_exclusions WHERE game_id=? ORDER BY source_text').bind(gameId).all() : { results: [] }
  const exclusionVersion = gameId === 'general' ? await env.DB.prepare("SELECT COALESCE(MAX(updated_at),'0') version FROM search_exclusions WHERE game_id=?").bind(gameId).first() : { version: '0' }
  const dictionaryVersion = `${versionRow.term_version}-${versionRow.translation_version}-${versionRow.translation_count}-${versionRow.translation_ids}-${versionRow.score_fingerprint}-${exclusionVersion?.version ?? '0'}-katakana-search-v5`
  const response = json({ schemaVersion: 1, gameId, version: dictionaryVersion, license: env.LICENSE_NAME, entries: safeResults.map((row) => ({ source: row.source_text, target: row.target_text, category: row.kind === 'phrase' ? 'ui' : 'learned', score: row.score })), searchExclusions: exclusionRows.results.map((row) => row.source_text) })
  response.headers.set('cache-control', 'public,max-age=60'); response.headers.set('etag', `W/"${gameId}-${dictionaryVersion}-${safeResults.length}"`)
  return cors(response)
}

async function uploadContributions(request, env) {
  const auth = await apiKeyUser(request, env); if (auth.response) return cors(auth.response)
  const payload = await readJson(request), items = Array.isArray(payload) ? payload : payload.items
  if (!Array.isArray(items) || !items.length || items.length > 100) return cors(json({ error: 'items 必须包含 1–100 条记录' }, 400))
  const accepted = [], rejected = []
  for (let index = 0; index < items.length; index++) {
    try {
      const item = items[index], gameId = clean(item.gameId, 80), source = clean(item.source, 240), target = clean(item.target, 240)
      const kind = item.kind === 'term' ? 'term' : ['translation', 'phrase'].includes(item.kind) ? 'phrase' : ''
      const provenance = ['translategemma', 'wikimedia'].includes(item.provenance) ? item.provenance : 'community'
      if (!gameId || !source || !target) throw new Error('缺少 gameId/source/target')
      if (!kind || !isShareableCommunityItem(source, target, kind, provenance, item.sourceUrl)) throw new Error('仅接受专有名词、单词和简短菜单标签')
      const game = await env.DB.prepare("SELECT id FROM games WHERE id=? AND status='approved'").bind(gameId).first(); if (!game) throw new Error('游戏不存在')
      await env.DB.prepare(`INSERT INTO terms(game_id,source_text,normalized_source,kind) VALUES(?,?,?,?)
        ON CONFLICT(game_id,normalized_source) DO UPDATE SET source_text=excluded.source_text,kind=excluded.kind,updated_at=CURRENT_TIMESTAMP`).bind(gameId, source, normalize(source), kind).run()
      const term = await env.DB.prepare('SELECT id FROM terms WHERE game_id=? AND normalized_source=?').bind(gameId, normalize(source)).first()
      const existing = await env.DB.prepare('SELECT id FROM translations WHERE term_id=? AND normalized_target=?').bind(term.id, normalize(target)).first()
      if (existing) await env.DB.prepare('UPDATE translations SET updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(existing.id).run()
      else await env.DB.prepare('INSERT INTO translations(term_id,target_text,normalized_target,submitted_by,provenance,source_url) VALUES(?,?,?,?,?,?)').bind(term.id, target, normalize(target), auth.user.id, provenance, isHttpsUrl(item.sourceUrl) ? item.sourceUrl : null).run()
      accepted.push({ index, termId: term.id })
    } catch (error) { rejected.push({ index, reason: error instanceof Error ? error.message : '无效记录' }) }
  }
  return cors(json({ accepted, rejected }, rejected.length ? 207 : 201))
}

async function apiKeyUser(request, env) {
  const header = request.headers.get('authorization') || '', raw = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!raw) return { response: json({ error: '缺少客户端 API Key' }, 401) }
  const user = await env.DB.prepare(`SELECT u.id,COALESCE(u.username,u.login) login,u.role,k.id key_id FROM api_keys k JOIN users u ON u.id=k.user_id
    WHERE k.key_hash=? AND k.revoked_at IS NULL`).bind(await sha256(raw)).first()
  if (!user) return { response: json({ error: 'API Key 无效或已撤销' }, 401) }
  await env.DB.prepare('UPDATE api_keys SET last_used_at=CURRENT_TIMESTAMP WHERE id=?').bind(user.key_id).run()
  return { user }
}

function groupTerms(rows) {
  const map = new Map()
  for (const row of rows) {
    if (!map.has(row.term_id)) map.set(row.term_id, { id: row.term_id, source: row.source_text, kind: row.kind, translations: [] })
    if (row.translation_id) map.get(row.term_id).translations.push({ id: row.translation_id, target: row.target_text, score: row.score })
  }
  return [...map.values()]
}

async function servePage(request, env) { return secureAsset(await env.ASSETS.fetch(request)) }
function secureAsset(response) {
  const next = new Response(response.body, response)
  next.headers.set('x-content-type-options', 'nosniff'); next.headers.set('referrer-policy', 'strict-origin-when-cross-origin')
  next.headers.set('content-security-policy', "default-src 'self'; img-src 'self' https: data:; script-src 'self' https://static.cloudflareinsights.com; style-src 'self'; connect-src 'self' https://cloudflareinsights.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://github.com")
  return next
}
function cors(response) { response.headers.set('access-control-allow-origin', '*'); response.headers.set('access-control-allow-headers', 'authorization,content-type'); response.headers.set('access-control-allow-methods', 'GET,POST,PATCH,DELETE,OPTIONS'); return response }
function json(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: jsonHeaders }) }
async function readJson(request) { try { return await request.json() } catch { return {} } }
function clean(value, max) { return typeof value === 'string' ? value.trim().slice(0, max) : '' }
function normalize(value) { return value.normalize('NFKC').replace(/\s+/gu, '').toLowerCase() }
function escapeLike(value) { return value.replace(/[\\%_]/gu, (character) => `\\${character}`) }
function isEditableDictionaryItem(source, target) {
  const sourceLength = [...normalize(source)].length, targetLength = [...normalize(target)].length
  return sourceLength > 0 && sourceLength <= 32 && targetLength > 0 && targetLength <= 64
    && !/[\n\r]/u.test(source) && !/[\n\r]/u.test(target)
    && !containsJapaneseKana(target) && !containsDictionaryPunctuation(source) && !containsDictionaryPunctuation(target)
}
function isShareableCommunityItem(source, target, kind, provenance, sourceUrl) {
  const compact = normalize(source), targetLength = [...normalize(target)].length
  if (!compact || !targetLength || [...compact].length > 32 || targetLength > 64 || /[\n\r]/u.test(source) || /[\n\r]/u.test(target) || containsJapaneseKana(target) || containsDictionaryPunctuation(source) || containsDictionaryPunctuation(target)) return false
  const standalone = [...compact].length <= 32 && !/(?:です|ます|ません|ください|だった|である|して|した|する|される|できる|ない|たい|ている|てる|から|ので|けれど|けど)$/u.test(compact)
  const katakana = /[\p{Script=Katakana}ー][\p{Script=Katakana}ー・]{1,23}/u.test(source)
  if (kind === 'term' && provenance === 'wikimedia') return isTrustedWikiUrl(sourceUrl) && (standalone || katakana)
  if ([...compact].length > 16 || !standalone) return false
  return ['はい', 'いいえ', 'もどる', '戻る', 'つづける', 'はじめから'].includes(source) || !/\p{Script=Hiragana}/u.test(source)
}
function containsJapaneseKana(value) { return /[\p{Script=Hiragana}\p{Script=Katakana}ー]/u.test(value) }
function containsDictionaryPunctuation(value) { return /\p{P}/u.test(value) }
function isTrustedWikiUrl(value) { if (!isHttpsUrl(value)) return false; return ['ja.wikipedia.org', 'www.wikidata.org'].includes(new URL(value).hostname) }
function isHttpsUrl(value) { if (typeof value !== 'string') return false; try { return new URL(value).protocol === 'https:' } catch { return false } }
function sameOrigin(request, env) { const origin = request.headers.get('origin'); return !origin || origin === env.SITE_ORIGIN }
function cookies(request) { return Object.fromEntries((request.headers.get('cookie') || '').split(';').map((part) => part.trim().split(/=(.*)/su).slice(0, 2)).filter(([key]) => key).map(([key, value]) => [decodeURIComponent(key), decodeURIComponent(value || '')])) }
function cookie(name, value, maxAge) { return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}` }
function randomToken(bytes) { const data = new Uint8Array(bytes); crypto.getRandomValues(data); return btoa(String.fromCharCode(...data)).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/gu, '') }
async function sha256(value) { const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))); return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('') }
function safeEqual(a, b) { if (a.length !== b.length) return false; let result = 0; for (let index = 0; index < a.length; index++) result |= a.charCodeAt(index) ^ b.charCodeAt(index); return result === 0 }
