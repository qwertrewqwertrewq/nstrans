const jsonHeaders = { 'content-type': 'application/json; charset=utf-8' }
const encoder = new TextEncoder()

export default {
  async fetch(request, env) {
    try { return await route(request, env) }
    catch (error) { console.error(error); return json({ error: '服务器内部错误' }, 500) }
  },
}

async function route(request, env) {
  const url = new URL(request.url), path = url.pathname
  if (request.method === 'OPTIONS' && path.startsWith('/api/v1/')) return cors(new Response(null, { status: 204 }))
  if (path === '/auth/github') return startGithubAuth(env)
  if (path === '/auth/github/callback') return githubCallback(request, env)
  if (path === '/auth/logout') return logout(request, env)
  if (path === '/api/stats' && request.method === 'GET') return publicStats(env)
  if (path === '/api/me' && request.method === 'GET') return me(request, env)
  if (path === '/api/keys' && request.method === 'GET') return listKeys(request, env)
  if (path === '/api/keys' && request.method === 'POST') return createKey(request, env)
  if (/^\/api\/keys\/\d+$/u.test(path) && request.method === 'DELETE') return revokeKey(request, env, Number(path.split('/').pop()))
  if (path === '/api/games' && request.method === 'GET') return listGames(request, env)
  if (path === '/api/games' && request.method === 'POST') return submitGame(request, env)
  if (/^\/api\/admin\/games\/[^/]+\/approve$/u.test(path) && request.method === 'POST') return moderateGame(request, env, decodeURIComponent(path.split('/')[4]), 'approved')
  if (/^\/api\/admin\/games\/[^/]+\/reject$/u.test(path) && request.method === 'POST') return moderateGame(request, env, decodeURIComponent(path.split('/')[4]), 'rejected')
  if (/^\/api\/games\/[^/]+\/terms$/u.test(path) && request.method === 'GET') return listTerms(request, env, decodeURIComponent(path.split('/')[3]))
  if (/^\/api\/games\/[^/]+\/terms$/u.test(path) && request.method === 'POST') return createTranslationFromWeb(request, env, decodeURIComponent(path.split('/')[3]))
  if (/^\/api\/translations\/\d+\/vote$/u.test(path) && request.method === 'POST') return vote(request, env, Number(path.split('/')[3]))
  if (/^\/api\/translations\/\d+$/u.test(path) && request.method === 'PATCH') return editTranslationFromWeb(request, env, Number(path.split('/')[3]))
  if (path === '/api/v1/games' && request.method === 'GET') return apiGames(request, env)
  if (path === '/api/v1/dictionaries/batch' && request.method === 'POST') return apiDictionaries(request, env)
  if (path === '/api/v1/translations' && request.method === 'POST') return apiCreateTranslation(request, env)
  if (path === '/api/v1/translations/batch' && request.method === 'POST') return apiCreateTranslations(request, env)
  if (path === '/api/v1/translations/batch' && request.method === 'PATCH') return apiEditTranslations(request, env)
  if (/^\/api\/v1\/translations\/\d+$/u.test(path) && request.method === 'PATCH') return apiEditTranslation(request, env, Number(path.split('/')[4]))
  if (/^\/api\/v1\/dictionaries\/[^/]+$/u.test(path) && request.method === 'GET') return dictionary(env, decodeURIComponent(path.split('/')[4]))
  if (path === '/api/v1/contributions' && request.method === 'POST') return uploadContributions(request, env)
  if (path === '/' || path === '/dashboard' || path === '/how-it-works' || path === '/client' || path === '/download') return servePage(request, env)
  return secureAsset(await env.ASSETS.fetch(request))
}

async function startGithubAuth(env) {
  if (!env.GITHUB_CLIENT_ID) return json({ error: 'GitHub OAuth 尚未配置' }, 503)
  const state = randomToken(24), callback = `${env.SITE_ORIGIN}/auth/github/callback`
  const target = new URL('https://github.com/login/oauth/authorize')
  target.search = new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID, redirect_uri: callback, scope: 'read:user', state }).toString()
  return new Response(null, { status: 302, headers: { location: target.toString(), 'set-cookie': cookie('oauth_state', state, 600) } })
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
  await env.DB.prepare(`INSERT INTO users(github_id, login, avatar_url, role) VALUES (?, ?, ?, ?)
    ON CONFLICT(github_id) DO UPDATE SET login=excluded.login, avatar_url=excluded.avatar_url,
    role=CASE WHEN excluded.role='admin' THEN 'admin' ELSE users.role END, updated_at=CURRENT_TIMESTAMP`).bind(profile.id, profile.login, profile.avatar_url || '', role).run()
  const user = await env.DB.prepare('SELECT id FROM users WHERE github_id=?').bind(profile.id).first()
  const raw = randomToken(32), hash = await sha256(raw)
  await env.DB.batch([env.DB.prepare('DELETE FROM sessions WHERE expires_at <= CURRENT_TIMESTAMP'), env.DB.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,datetime('now','+30 days'))").bind(hash, user.id)])
  const headers = new Headers({ location: `${env.SITE_ORIGIN}/dashboard` }); headers.append('set-cookie', cookie('session', raw, 30 * 86400)); headers.append('set-cookie', cookie('oauth_state', '', 0))
  return new Response(null, { status: 302, headers })
}

async function logout(request, env) {
  const raw = cookies(request).session
  if (raw) await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await sha256(raw)).run()
  return new Response(null, { status: 302, headers: { location: '/', 'set-cookie': cookie('session', '', 0) } })
}

async function currentUser(request, env) {
  const raw = cookies(request).session
  if (!raw) return null
  return env.DB.prepare(`SELECT u.id,u.login,u.avatar_url,u.role FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>CURRENT_TIMESTAMP`).bind(await sha256(raw)).first()
}

async function requireUser(request, env, admin = false) {
  const user = await currentUser(request, env)
  if (!user) return { response: json({ error: '请先使用 GitHub 登录' }, 401) }
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
  const { results } = await env.DB.prepare('SELECT id,key_prefix,created_at,last_used_at FROM api_keys WHERE user_id=? AND revoked_at IS NULL ORDER BY id DESC').bind(auth.user.id).all()
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
  const user = await currentUser(request, env)
  let query = `SELECT g.*,u.login submitter FROM games g LEFT JOIN users u ON u.id=g.submitted_by WHERE g.status='approved'`
  const binds = []
  if (user?.role === 'admin') query = 'SELECT g.*,u.login submitter FROM games g LEFT JOIN users u ON u.id=g.submitted_by'
  else if (user) { query = `SELECT g.*,u.login submitter FROM games g LEFT JOIN users u ON u.id=g.submitted_by WHERE g.status='approved' OR g.submitted_by=?`; binds.push(user.id) }
  const { results } = await env.DB.prepare(`${query} ORDER BY g.status='approved' DESC,g.created_at DESC`).bind(...binds).all()
  return json({ games: results })
}

async function submitGame(request, env) {
  const auth = await requireUser(request, env); if (auth.response) return auth.response
  const body = await readJson(request), japanese = clean(body.japaneseName, 120), chinese = clean(body.chineseName, 120), poster = clean(body.posterUrl, 600)
  if (!japanese || !chinese || !isHttpsUrl(poster)) return json({ error: '请填写日文名、中文名和有效的 HTTPS 海报 URL' }, 400)
  const id = `game-${randomToken(10).toLowerCase()}`
  await env.DB.prepare('INSERT INTO games(id,japanese_name,chinese_name,poster_url,submitted_by) VALUES(?,?,?,?,?)').bind(id, japanese, chinese, poster, auth.user.id).run()
  return json({ id, status: 'pending' }, 201)
}

async function moderateGame(request, env, id, status) {
  const auth = await requireUser(request, env, true); if (auth.response) return auth.response
  await env.DB.prepare('UPDATE games SET status=?,approved_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status=?').bind(status, auth.user.id, id, 'pending').run()
  return json({ ok: true })
}

async function listTerms(request, env, gameId) {
  const game = await env.DB.prepare("SELECT id FROM games WHERE id=? AND status='approved'").bind(gameId).first()
  if (!game) return json({ error: '游戏不存在或尚未批准' }, 404)
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

async function apiGames(request, env) {
  const auth = await apiKeyUser(request, env); if (auth.response) return cors(auth.response)
  const { results } = await env.DB.prepare(`SELECT id,japanese_name,chinese_name,poster_url,updated_at
    FROM games WHERE status='approved' ORDER BY chinese_name,id`).all()
  return cors(json({ games: results.map((game) => ({ id: game.id, japaneseName: game.japanese_name, chineseName: game.chinese_name, posterUrl: game.poster_url, updatedAt: game.updated_at })) }))
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
    return cors(json({ error: '包含不存在或尚未批准的游戏', unknownGameIds: gameIds.filter((id) => !found.has(id)) }, 404))
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
  if (!game) return { status: 404, body: { error: '游戏不存在或尚未批准' } }
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
  if (!game) return cors(json({ error: '游戏不存在或尚未批准' }, 404))
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
      const game = await env.DB.prepare("SELECT id FROM games WHERE id=? AND status='approved'").bind(gameId).first(); if (!game) throw new Error('游戏不存在或尚未批准')
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
  const user = await env.DB.prepare(`SELECT u.id,u.login,u.role,k.id key_id FROM api_keys k JOIN users u ON u.id=k.user_id
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
function cors(response) { response.headers.set('access-control-allow-origin', '*'); response.headers.set('access-control-allow-headers', 'authorization,content-type'); response.headers.set('access-control-allow-methods', 'GET,POST,PATCH,OPTIONS'); return response }
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
