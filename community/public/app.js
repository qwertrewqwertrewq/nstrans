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

const routeNames = { overview: '概览', keys: '客户端密钥', games: '游戏管理', dictionary: '词库与评分', review: '审核队列' }
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
    $('#avatar').src = user.avatar_url
    $('#login').textContent = `@${user.login}`
    $('#roleBadge').textContent = user.role === 'admin' ? '管理员' : '贡献者'
    $('#welcomeName').textContent = user.login
    renderMetrics(stats)
    setupAdmin(user)
    setupGameForm()
    if (route === 'keys') { $('#createKey').addEventListener('click', createKey); await loadKeys() }
    if (route === 'games') renderGames(dashboardGames)
    if (route === 'dictionary') setupDictionary(dashboardGames)
    if (route === 'review') {
      if (user.role !== 'admin') { location.href = '/dashboard'; return }
      renderPending(dashboardGames.filter((game) => game.status === 'pending'))
    }
  } catch { location.href = '/auth/github' }
}

function renderMetrics(stats) {
  const mapping = { dashGames: stats.games, dashTerms: stats.terms, dashTranslations: stats.translations, dashContributors: stats.contributors }
  for (const [id, value] of Object.entries(mapping)) if (document.getElementById(id)) document.getElementById(id).textContent = value
}

function setupAdmin(user) {
  if (user.role !== 'admin') return
  const pending = dashboardGames.filter((game) => game.status === 'pending').length
  $('#adminNav').hidden = false
  $('#pendingCount').textContent = pending
}

async function loadKeys() {
  const { keys } = await api('/api/keys')
  $('#keyList').innerHTML = keys.length ? keys.map((key) => `<div class="list-row"><div><strong>${escapeHtml(key.key_prefix)}••••</strong><small>创建于 ${date(key.created_at)}${key.last_used_at ? ` · 最近使用 ${date(key.last_used_at)}` : ' · 尚未使用'}</small></div><button data-revoke="${key.id}" class="danger-link">撤销</button></div>`).join('') : '<div class="empty-state">尚未生成客户端 Key</div>'
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
    const body = Object.fromEntries(new FormData(event.currentTarget))
    try {
      await api('/api/games', { method: 'POST', body: JSON.stringify(body) })
      event.currentTarget.reset()
      $('#gameDialog').close()
      flash('游戏已提交，等待管理员批准')
      const result = await api('/api/games')
      dashboardGames = result.games
      if ($('#gameList')) renderGames(dashboardGames)
      setupAdmin(dashboardUser)
    } catch (error) { flash(error.message, true) }
  })
}

function renderGames(games) {
  $('#gameList').innerHTML = games.length ? games.map((game) => `<article class="game-tile ${game.status}">${game.poster_url ? `<img src="${escapeHtml(game.poster_url)}" alt="${escapeHtml(game.chinese_name)}海报">` : '<span class="poster-placeholder">NS</span>'}<span><strong>${escapeHtml(game.chinese_name)}</strong><small lang="ja">${escapeHtml(game.japanese_name)}</small><em>${statusName(game.status)}</em>${game.status === 'approved' ? `<a class="text-link" href="/dashboard?view=dictionary&game=${encodeURIComponent(game.id)}">查看词库 →</a>` : ''}</span></article>`).join('') : '<div class="empty-state">暂无游戏</div>'
}

function setupDictionary(games) {
  const approved = games.filter((game) => game.status === 'approved')
  const select = $('#dictionaryGame')
  select.innerHTML = approved.length ? approved.map((game) => `<option value="${escapeHtml(game.id)}">${escapeHtml(game.chinese_name)} / ${escapeHtml(game.japanese_name)}</option>`).join('') : '<option value="">暂无已批准游戏</option>'
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

function renderPending(games) {
  $('#pendingGames').innerHTML = games.length ? games.map((game) => `<div class="list-row game-review"><div><strong>${escapeHtml(game.chinese_name)}</strong><small>${escapeHtml(game.japanese_name)} · 提交者 @${escapeHtml(game.submitter || 'unknown')}</small><a href="${escapeHtml(game.poster_url)}" target="_blank" rel="noreferrer">查看海报 ↗</a></div><span><button class="approve" data-moderate="approve" data-id="${escapeHtml(game.id)}">批准</button><button class="danger-link" data-moderate="reject" data-id="${escapeHtml(game.id)}">拒绝</button></span></div>`).join('') : '<div class="empty-state">没有待审核游戏</div>'
  $$('[data-moderate]').forEach((button) => button.addEventListener('click', async () => {
    await api(`/api/admin/games/${encodeURIComponent(button.dataset.id)}/${button.dataset.moderate}`, { method: 'POST' })
    flash('审核状态已更新')
    const result = await api('/api/games')
    dashboardGames = result.games
    renderPending(dashboardGames.filter((game) => game.status === 'pending'))
    setupAdmin(dashboardUser)
  }))
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
function statusName(status) { return ({ approved: '已开放', pending: '审核中', rejected: '未通过' })[status] || status }
function flash(message, error = false) { const element = $('#flash'); element.textContent = message; element.className = `flash ${error ? 'error' : ''}`; element.hidden = false; clearTimeout(flash.timer); flash.timer = setTimeout(() => { element.hidden = true }, 4000) }
