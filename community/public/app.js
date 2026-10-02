const $ = (selector) => document.querySelector(selector)
const $$ = (selector) => [...document.querySelectorAll(selector)]
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/gu, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char])

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || `请求失败 (${response.status})`)
  return body
}

async function loadHomeStats() {
  try {
    const stats = await api('/api/stats')
    $('#statGames').textContent = stats.games
    $('#statTerms').textContent = stats.terms
    $('#statTranslations').textContent = stats.translations
    $('#statContributors').textContent = stats.contributors
  } catch { /* Keep graceful placeholders. */ }
}

const routeNames = { overview: '概览', keys: '客户端密钥', games: '游戏管理', dictionary: '词库与评分', account: '账号与绑定', updates: '版本通知' }
let dashboardUser = null
let dashboardGames = []
let dictionaryTerms = []
let dictionaryExclusions = []
let dictionaryExclusionCount = 0
let dictionaryName = ''
let dictionarySearchTimer = 0
const japaneseCollator = new Intl.Collator('ja', { usage: 'sort', sensitivity: 'base', numeric: true })

if (document.body.dataset.page === 'home') loadHomeStats()
if (document.body.dataset.page === 'dashboard') initDashboard()

async function initDashboard() {
  const requestedView = new URLSearchParams(location.search).get('view')
  const route = routeNames[requestedView] ? requestedView : 'overview'
  $$('[data-view]').forEach((view) => { view.hidden = view.dataset.view !== route })
  $$('[data-route]').forEach((link) => link.classList.toggle('active', link.dataset.route === route))
  $('#routeCrumb').textContent = routeNames[route]
  $('#mobileMenu').addEventListener('click', () => document.body.classList.toggle('menu-open'))
  $$('[data-open-dialog]').forEach((button) => button.addEventListener('click', () => document.getElementById(button.dataset.openDialog).showModal()))
  $$('[data-close-dialog]').forEach((button) => button.addEventListener('click', () => document.getElementById(button.dataset.closeDialog).close()))

  try {
    const [{ user }, stats, gamesResult] = await Promise.all([api('/api/me'), api('/api/stats'), api('/api/games')])
    dashboardUser = user
    dashboardGames = gamesResult.games
    $('#avatar').src = user.avatar_url || '/project-logo.svg'
    $('#login').textContent = `@${user.login}`
    $('#roleBadge').textContent = user.role === 'admin' ? '管理员' : '贡献者'
    $('#welcomeName').textContent = user.login
    $$('[data-admin-only]').forEach((element) => { element.hidden = user.role !== 'admin' })
    if (route === 'updates' && user.role !== 'admin') { location.href = '/dashboard'; return }
    renderMetrics(stats)
    setupGameForm()
    if (route === 'keys') { $('#createKey').addEventListener('click', createKey); await loadKeys() }
    if (route === 'games') renderGames(dashboardGames)
    if (route === 'dictionary') setupDictionary(dashboardGames)
    if (route === 'account') setupAccount(user)
    if (route === 'updates') await setupUpdatePolicy()
  } catch { location.href = '/auth/github' }
}

async function setupUpdatePolicy() {
  const form = $('#updatePolicyForm'), { policy } = await api('/api/admin/update-policy')
  form.elements.targetVersion.value = policy?.target_version || '0.1.5'
  form.elements.downloadUrl.value = policy?.download_url || `${location.origin}/download`
  form.elements.popupEnabled.checked = Boolean(policy?.popup_enabled)
  form.elements.forceUpdate.checked = Boolean(policy?.force_update)
  form.elements.content.value = policy?.content || ''
  const syncForceState = () => {
    if (form.elements.forceUpdate.checked) form.elements.popupEnabled.checked = true
    form.elements.popupEnabled.disabled = form.elements.forceUpdate.checked
  }
  syncForceState()
  form.elements.forceUpdate.addEventListener('change', syncForceState)
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    try {
      await api('/api/admin/update-policy', { method: 'PATCH', body: JSON.stringify({
        targetVersion: form.elements.targetVersion.value,
        downloadUrl: form.elements.downloadUrl.value,
        popupEnabled: form.elements.popupEnabled.checked,
        forceUpdate: form.elements.forceUpdate.checked,
        content: form.elements.content.value,
      }) })
      flash('客户端版本规则已保存')
      syncForceState()
    } catch (error) { flash(error.message, true) }
  })
}

function setupAccount(user) {
  const profile = $('#profileForm'), password = $('#passwordForm')
  profile.elements.username.value = user.login
  $('#githubStatus').textContent = user.github_bound ? '已绑定 GitHub，可继续使用 GitHub OAuth 登录。' : '尚未绑定 GitHub。绑定后两种登录方式会进入同一账号。'
  $('#githubBind').hidden = Boolean(user.github_bound)
  profile.addEventListener('submit', async (event) => { event.preventDefault(); try { await api('/api/account/profile', { method: 'PATCH', body: JSON.stringify(Object.fromEntries(new FormData(profile))) }); flash('用户名已更新') } catch (error) { flash(error.message, true) } })
  password.addEventListener('submit', async (event) => { event.preventDefault(); try { await api('/api/account/password', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(password))) }); password.reset(); flash('密码已设置') } catch (error) { flash(error.message, true) } })
}

function renderMetrics(stats) {
  const mapping = { dashGames: stats.games, dashTerms: stats.terms, dashTranslations: stats.translations, dashContributors: stats.contributors }
  for (const [id, value] of Object.entries(mapping)) if (document.getElementById(id)) document.getElementById(id).textContent = value
}

async function loadKeys() {
  const { keys } = await api('/api/keys')
  $('#keyList').innerHTML = keys.length ? keys.map((key) => `<div class="list-row"><div><strong>${key.origin === 'official-client' ? `${escapeHtml(key.device_name || 'NSTrans 官方客户端')} · ` : ''}${escapeHtml(key.key_prefix)}••••</strong><small>${key.origin === 'official-client' ? '由客户端登录自动配置 · ' : ''}创建于 ${date(key.created_at)}${key.last_used_at ? ` · 最近使用 ${date(key.last_used_at)}` : ' · 尚未使用'}</small></div><button data-revoke="${key.id}" class="danger-link">撤销</button></div>`).join('') : '<div class="empty-state">尚未生成客户端 Key</div>'
  $$('[data-revoke]').forEach((button) => button.addEventListener('click', async () => {
    if (!confirm('撤销后，使用此 Key 的客户端将立即无法上传。确定吗？')) return
    await api(`/api/keys/${button.dataset.revoke}`, { method: 'DELETE' })
    flash('Key 已撤销')
    await loadKeys()
  }))
}

async function createKey() {
  try {
    const result = await api('/api/keys', { method: 'POST' })
    const box = $('#newKey')
    box.hidden = false
    box.innerHTML = `<span>仅显示一次，请立即保存</span><code>${escapeHtml(result.key)}</code><button id="copyKey">复制 Key</button>`
    $('#copyKey').onclick = async () => { await navigator.clipboard.writeText(result.key); flash('API Key 已复制') }
    await loadKeys()
  } catch (error) { flash(error.message, true) }
}

function setupGameForm() {
  $('#gameForm').addEventListener('submit', async (event) => {
    event.preventDefault()
    const form = event.currentTarget
    const body = Object.fromEntries(new FormData(form))
    try {
      await api('/api/games', { method: 'POST', body: JSON.stringify(body) })
      form.reset()
      $('#gameDialog').close()
      flash('游戏已创建并立即开放')
      const result = await api('/api/games')
      dashboardGames = result.games
      if ($('#gameList')) renderGames(dashboardGames)
    } catch (error) { flash(error.message, true) }
  })
  $('#gameEditForm').addEventListener('submit', saveGameEdit)
}

function renderGames(games) {
  const admin = dashboardUser?.role === 'admin'
  $('#gameList').innerHTML = games.length ? games.map((game) => `<article class="game-tile">${game.poster_url ? `<img src="${escapeHtml(game.poster_url)}" alt="${escapeHtml(game.chinese_name)}海报">` : '<span class="poster-placeholder">NS</span>'}<span><strong>${escapeHtml(game.chinese_name)}</strong>${game.japanese_name ? `<small lang="ja">${escapeHtml(game.japanese_name)}</small>` : '<small>未填写日文名</small>'}<em>已开放</em><a class="text-link" href="/dashboard?view=dictionary&game=${encodeURIComponent(game.id)}">查看词库 →</a>${admin ? `<span class="game-admin-actions"><button data-edit-game="${escapeHtml(game.id)}">编辑</button>${game.id !== 'general' ? `<button class="danger-link" data-delete-game="${escapeHtml(game.id)}">删除</button>` : ''}</span>` : ''}</span></article>`).join('') : '<div class="empty-state">暂无游戏</div>'
  $$('[data-edit-game]').forEach((button) => button.addEventListener('click', () => openGameEditor(button.dataset.editGame)))
  $$('[data-delete-game]').forEach((button) => button.addEventListener('click', () => deleteGame(button.dataset.deleteGame)))
}

function setupDictionary(games) {
  const approved = games.filter((game) => game.status === 'approved')
  const select = $('#dictionaryGame')
  select.innerHTML = approved.length ? approved.map((game) => `<option value="${escapeHtml(game.id)}">${escapeHtml(game.chinese_name)}${game.japanese_name ? ` / ${escapeHtml(game.japanese_name)}` : ''}</option>`).join('') : '<option value="">暂无游戏</option>'
  const requested = new URLSearchParams(location.search).get('game')
  if (requested && approved.some((game) => game.id === requested)) select.value = requested
  const reload = () => loadTerms(select.value, select.options[select.selectedIndex]?.textContent || '')
  select.addEventListener('change', reload)
  $('#dictionarySearch').addEventListener('input', () => {
    clearTimeout(dictionarySearchTimer)
    dictionarySearchTimer = setTimeout(reload, 250)
  })
  $('#dictionarySort').addEventListener('change', renderTerms)
  $('#entryForm').addEventListener('submit', saveEntry)
  $('#newEntryForm').addEventListener('submit', saveNewEntry)
  if (select.value) loadTerms(select.value, select.options[select.selectedIndex].textContent)
}

function openGameEditor(id) {
  const game = dashboardGames.find((item) => item.id === id)
  if (!game) return
  const form = $('#gameEditForm')
  form.elements.id.value = game.id
  form.elements.chineseName.value = game.chinese_name
  form.elements.japaneseName.value = game.japanese_name || ''
  form.elements.posterUrl.value = game.poster_url || ''
  $('#gameEditDialog').showModal()
}

async function saveGameEdit(event) {
  event.preventDefault()
  const form = event.currentTarget
  try {
    await api(`/api/admin/games/${encodeURIComponent(form.elements.id.value)}`, { method: 'PATCH', body: JSON.stringify({ chineseName: form.elements.chineseName.value, japaneseName: form.elements.japaneseName.value, posterUrl: form.elements.posterUrl.value }) })
    $('#gameEditDialog').close()
    flash('游戏信息已更新')
    const result = await api('/api/games')
    dashboardGames = result.games
    renderGames(dashboardGames)
  } catch (error) { flash(error.message, true) }
}

async function deleteGame(id) {
  const game = dashboardGames.find((item) => item.id === id)
  if (!game || !confirm(`删除“${game.chinese_name}”会同时删除其全部词条和评分，确定继续吗？`)) return
  try {
    await api(`/api/admin/games/${encodeURIComponent(id)}`, { method: 'DELETE' })
    dashboardGames = dashboardGames.filter((item) => item.id !== id)
    renderGames(dashboardGames)
    flash('游戏及其词库已删除')
  } catch (error) { flash(error.message, true) }
}

async function loadTerms(gameId, name) {
  const panel = $('#termPanel')
  panel.innerHTML = '<div class="empty-state">正在加载…</div>'
  try {
    const query = $('#dictionarySearch').value.trim()
    const { terms, searchExclusions = [], searchExclusionCount = 0 } = await api(`/api/games/${encodeURIComponent(gameId)}/terms${query ? `?q=${encodeURIComponent(query)}` : ''}`)
    dictionaryTerms = terms
    dictionaryExclusions = searchExclusions
    dictionaryExclusionCount = searchExclusionCount
    dictionaryName = name
    renderTerms()
  } catch (error) { panel.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>` }
}

function renderTerms() {
  const panel = $('#termPanel')
  const terms = [...dictionaryTerms]
  if ($('#dictionarySort').value === 'score') terms.sort((left, right) => maxScore(right) - maxScore(left) || japaneseCollator.compare(left.source, right.source))
  else terms.sort((left, right) => japaneseCollator.compare(left.source, right.source) || maxScore(right) - maxScore(left))
  const exclusions = dictionaryExclusionCount ? `<section class="exclusion-panel"><header><div><strong>片假名搜索排除库</strong><small>${dictionaryExclusionCount} 个无译文通用词</small></div><span>当前显示 ${dictionaryExclusions.length} 个</span></header><div class="exclusion-cloud">${dictionaryExclusions.map((item) => `<span lang="ja" title="${escapeHtml(item.source_name)}">${escapeHtml(item.source_text)}</span>`).join('')}</div></section>` : ''
  panel.innerHTML = `<h2 class="term-panel-title">${escapeHtml(dictionaryName)} <small>${terms.length} 个翻译词条${dictionaryExclusionCount ? ` · ${dictionaryExclusionCount} 个搜索排除词` : ''}</small></h2>${exclusions}${terms.length ? terms.map(termCard).join('') : '<div class="empty-state">没有匹配的社区翻译词条。</div>'}`
  panel.querySelectorAll('[data-vote]').forEach((button) => button.addEventListener('click', async () => {
    try {
      const result = await api(`/api/translations/${button.dataset.id}/vote`, { method: 'POST', body: JSON.stringify({ value: Number(button.dataset.vote) }) })
      button.closest('.translation-option').querySelector('[data-score]').textContent = result.score
      const translation = dictionaryTerms.flatMap((term) => term.translations).find((item) => item.id === Number(button.dataset.id))
      if (translation) translation.score = result.score
      flash('评分已记录')
      if ($('#dictionarySort').value === 'score') renderTerms()
    } catch (error) { flash(error.message, true) }
  }))
  panel.querySelectorAll('[data-edit]').forEach((button) => button.addEventListener('click', () => openEntryEditor(Number(button.dataset.edit))))
}

function openEntryEditor(translationId) {
  const term = dictionaryTerms.find((item) => item.translations.some((translation) => translation.id === translationId))
  const translation = term?.translations.find((item) => item.id === translationId)
  if (!term || !translation) return
  const form = $('#entryForm')
  form.elements.translationId.value = translationId
  form.elements.source.value = term.source
  form.elements.target.value = translation.target
  $('#entryDialog').showModal()
}

async function saveEntry(event) {
  event.preventDefault()
  const form = event.currentTarget, translationId = Number(form.elements.translationId.value)
  try {
    await api(`/api/translations/${translationId}`, { method: 'PATCH', body: JSON.stringify({ source: form.elements.source.value, target: form.elements.target.value }) })
    $('#entryDialog').close()
    flash('词条已覆盖，评分 +3')
    const select = $('#dictionaryGame')
    await loadTerms(select.value, select.options[select.selectedIndex]?.textContent || '')
  } catch (error) { flash(error.message, true) }
}

async function saveNewEntry(event) {
  event.preventDefault()
  const form = event.currentTarget, select = $('#dictionaryGame')
  if (!select.value) { flash('请先选择游戏', true); return }
  try {
    const body = Object.fromEntries(new FormData(form))
    const result = await api(`/api/games/${encodeURIComponent(select.value)}/terms`, { method: 'POST', body: JSON.stringify(body) })
    $('#newEntryDialog').close()
    form.reset()
    flash(result.unchanged ? '相同词条已经存在，未重复加分' : '词条已新增，可信度 +3')
    await loadTerms(select.value, select.options[select.selectedIndex]?.textContent || '')
  } catch (error) { flash(error.message, true) }
}

function maxScore(term) { return term.translations.reduce((score, translation) => Math.max(score, Number(translation.score) || 0), Number.NEGATIVE_INFINITY) }
function termCard(term) { return `<article class="term-card"><header><span>${term.kind === 'term' ? '名词' : '短句'}</span><strong lang="ja">${escapeHtml(term.source)}</strong></header><div>${term.translations.map((translation) => `<div class="translation-option"><span>${escapeHtml(translation.target)}</span><div><button data-edit="${translation.id}" title="修改原文和译文">编辑</button><button data-vote="1" data-id="${translation.id}" title="赞">↑</button><b data-score>${translation.score}</b><button data-vote="-1" data-id="${translation.id}" title="踩">↓</button></div></div>`).join('')}</div></article>` }
function date(value) { return new Date(`${String(value).replace(' ', 'T')}Z`).toLocaleDateString('zh-CN') }
function flash(message, error = false) { const element = $('#flash'); element.textContent = message; element.className = `flash ${error ? 'error' : ''}`; element.hidden = false; clearTimeout(flash.timer); flash.timer = setTimeout(() => { element.hidden = true }, 4000) }
