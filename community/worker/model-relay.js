import { GEMINI_ENDPOINT } from './gemini-upstream.js'
import { platforms, bailianHost, discoverModels, providerRequest, providerOutput, providerResponse } from './relay-providers.js'
// No prompts, screenshots, outputs, or upstream credentials are stored in usage records.
export const planModels = Object.freeze([
  { id: 'gemini-2.5-flash', capability: 'multimodal-search' },
  { id: 'gemini-2.5-flash-lite', capability: 'multimodal-search' },
])
export const defaultRelayRoutes = { translation: 'gemini-2.5-flash-lite', search: 'gemini-2.5-flash', vision: 'gemini-2.5-flash' }
export const defaultProxyModels = planModels.map(model => ({ ...model, enabled: true, translationCost: 1, searchCost: 2, visionCost: 2 }))
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }) }
const encoder = new TextEncoder()
const base64 = bytes => btoa(String.fromCharCode(...bytes))
const bytes = value => Uint8Array.from(atob(value), char => char.charCodeAt(0))
async function encryptionKey(env) {
  if (!env.CLIENT_ACCESS_SECRET) fail('服务器尚未配置加密密钥', 503)
  const material = await crypto.subtle.digest('SHA-256', encoder.encode(`nstrans.model.relay.v1:${env.CLIENT_ACCESS_SECRET}`))
  return crypto.subtle.importKey('raw', material, 'AES-GCM', false, ['encrypt', 'decrypt'])
}
export async function encryptProxyKey(value, env) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  return { encrypted_key: base64(new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encryptionKey(env), encoder.encode(value)))), key_iv: base64(iv) }
}
async function decryptProxyKey(config, env) {
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(config.key_iv) }, await encryptionKey(env), bytes(config.encrypted_key)))
}
export function validateModels(models) {
  if (!Array.isArray(models) || models.length > 100) fail('最多配置 100 个模型')
  const ids = new Set()
  return models.map(model => {
    const known = planModels.find(item => item.id === model?.id)
    if (model?.platform && (!platforms.includes(model.platform) || !/^[\w.-]{1,160}$/u.test(model.model || '') || typeof model.keyId!=='string')) fail('模型平台配置无效')
    if ((!known && (!platforms.includes(model?.platform) || !/^[\w.-]{1,160}$/u.test(model?.model || '') || typeof model.keyId !== 'string')) || !/^[\w.-]{1,200}$/u.test(model?.id || '') || ids.has(model.id)) fail('模型配置无效或重复')
    ids.add(model.id)
    if (!['multimodal-search', 'search-only', 'translation-only','vision-only'].includes(model.capability)
      ) fail('模型能力配置无效')
    for (const field of ['translationCost', 'searchCost', 'visionCost']) {
      if (!Number.isSafeInteger(model[field]) || model[field] < 1 || model[field] > 100000) fail('调用点数必须为 1–100000 的整数')
    }
    return { id: model.id, ...(model.platform ? {platform:model.platform,model:model.model,keyId:model.keyId} : {}), capability: model.capability, enabled: model.enabled === true,
      translationCost: model.translationCost, searchCost: model.searchCost, visionCost: model.visionCost }
  })
}
async function configFor(env) {
  const row = await env.DB.prepare('SELECT * FROM model_relay_config WHERE id=1').first()
  const models=JSON.parse(row.models_json)
  return { ...row, routes: normalizeRoutes(JSON.parse(row.routes_json)), models: validateModels(models) }
}
export function normalizeRoutes(routes) {
  return Object.fromEntries(Object.keys(defaultRelayRoutes).map(purpose=>{
    const value=routes?.[purpose]
    const ids=Array.isArray(value)?value:typeof value==='string' && value?[value]:[]
    if (ids.length>5 || ids.some(id=>typeof id!=='string') || new Set(ids).size!==ids.length) fail('每个用途最多选择 5 个不重复模型')
    return [purpose,ids]
  }))
}
function supportsPurpose(model,purpose) {
  return model.enabled && (purpose==='vision'?['multimodal-search','vision-only'].includes(model.capability):purpose==='search'?['multimodal-search','search-only'].includes(model.capability):true)
}
async function readBody(request, max = 8192) {
  if (Number(request.headers.get('content-length')) > max) fail('请求内容过大', 413)
  const reader = request.body?.getReader()
  let count = 0
  const chunks = []
  if (reader) while (true) {
    const next = await reader.read()
    if (next.done) break
    count += next.value.byteLength
    if (count > max) { await reader.cancel(); fail('请求内容过大', 413) }
    chunks.push(next.value)
  }
  const all = new Uint8Array(count)
  let offset = 0
  for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.length }
  try { return JSON.parse(new TextDecoder().decode(all)) } catch { fail('请求必须为 JSON') }
}
export function validateProxyRequest(body, models, routes) {
  if (body?.model !== undefined) fail('社区中转模型由服务器选择，请勿提交具体型号')
  if (!['translation','search','vision'].includes(body?.purpose)) fail('请求用途必须为 translation、search 或 vision')
  const purpose = body.purpose
  const ids=normalizeRoutes(routes)[purpose]
  const candidates=ids.map(id=>models.find(item=>item.id===id)).filter(item=>item && supportsPurpose(item,purpose))
  const model = candidates[0]
  if (!model) fail('此用途的社区中转模型尚未启用', 503)
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
  if (!prompt || prompt.length > 24000) fail('提示词长度必须为 1–24000 字符')
  const image = body.imageDataUrl
  if (image && (typeof image !== 'string' || image.length > 2800000 || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/u.test(image))) fail('截图必须为不超过 2 MB 的 PNG/JPEG/WebP 内嵌图片')
  if ((purpose === 'vision') !== Boolean(image)) fail('视觉请求必须包含截图，其他用途不接受截图')
  if (body.enableSearch !== undefined) fail('请使用 purpose 指定请求用途')
  if (image && !['multimodal-search','vision-only'].includes(model.capability)) fail('所选模型不允许视觉输入', 403)
  if (purpose === 'search' && !['multimodal-search','search-only'].includes(model.capability)) fail('此用途的社区模型不允许搜索', 403)
  return { model, candidates, prompt, image, purpose, cost: model[`${purpose}Cost`] }
}
export async function proxyCatalog(env, user) {
  const config = await configFor(env)
  const quota = await env.DB.prepare('SELECT balance,granted,spent FROM model_relay_quotas WHERE user_id=?').bind(user.id).first()
  const costs = Object.fromEntries(Object.entries(config.routes).map(([purpose,ids]) => [purpose,ids.map(id=>config.models.find(model=>model.id===id && supportsPurpose(model,purpose))).find(Boolean)?.[`${purpose}Cost`] || 0]))
  return json({ enabled: Boolean(config.enabled && config.models.some(m=>m.enabled)), costs, quota: quota || { balance: 0, granted: 0, spent: 0 }, unit: '社区点数' })
}
export async function adminProxy(request, env, user) {
  try {
    const path = new URL(request.url).pathname
    if (path.endsWith('/credentials')) {
      if (request.method === 'GET') return json({credentials:(await env.DB.prepare('SELECT id,name,platform,workspace,created_at FROM model_relay_credentials ORDER BY created_at,id').all()).results})
      const body=await readBody(request)
      if (request.method === 'DELETE') {
        const config=await configFor(env)
        if (config.models.some(m=>m.keyId===body.id || (!m.platform && body.id==='legacy-google'))) fail('请先删除使用此密钥的模型')
        await env.DB.batch([env.DB.prepare('DELETE FROM model_relay_catalog WHERE credential_id=?').bind(body.id),env.DB.prepare('DELETE FROM model_relay_credentials WHERE id=?').bind(body.id)])
        return json({ok:true})
      }
      if (!['POST','PATCH'].includes(request.method)) return json({error:'不支持的方法'},405)
      const old=request.method==='PATCH' ? await env.DB.prepare('SELECT * FROM model_relay_credentials WHERE id=?').bind(body.id).first() : null
      if (request.method==='PATCH' && !old) fail('密钥不存在',404)
      const platform=old?.platform || body.platform, name=String(body.name || '').trim(), workspace=String(body.workspace || '').trim()
      if (!platforms.includes(platform) || !name || name.length>100) fail('请选择平台并填写密钥名称')
      if (platform==='bailian') bailianHost({workspace})
      const key=typeof body.apiKey==='string'?body.apiKey.trim():''
      if ((!key && !old) || key.length>512 || /[\r\n]/u.test(key)) fail('API Key 无效')
      const secret=key ? await encryptProxyKey(key,env) : old
      const id=old?.id || crypto.randomUUID()
      const statements=[env.DB.prepare('INSERT INTO model_relay_credentials(id,name,platform,workspace,encrypted_key,key_iv) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,workspace=excluded.workspace,encrypted_key=excluded.encrypted_key,key_iv=excluded.key_iv').bind(id,name,platform,workspace,secret.encrypted_key,secret.key_iv)]
      if (old && (key || workspace!==old.workspace)) statements.push(env.DB.prepare('DELETE FROM model_relay_catalog WHERE credential_id=?').bind(id))
      await env.DB.batch(statements)
      return json({ok:true,id})
    }
    if (path.endsWith('/discover') && request.method==='POST') {
      const body=await readBody(request)
      const credential=await env.DB.prepare('SELECT * FROM model_relay_credentials WHERE id=?').bind(body.keyId).first()
      if (!credential) fail('请选择已保存的密钥')
      const models=await discoverModels(credential,await decryptProxyKey(credential,env))
      await env.DB.batch([env.DB.prepare('DELETE FROM model_relay_catalog WHERE credential_id=?').bind(credential.id),...models.map(m=>env.DB.prepare('INSERT INTO model_relay_catalog(credential_id,model_id,metadata_json) VALUES(?,?,?)').bind(credential.id,m.id,JSON.stringify(m)))])
      return json({models})
    }
    if (path.endsWith('/config')) {
      const config = await configFor(env)
      if (request.method === 'GET') return json({ enabled: Boolean(config.enabled), keyConfigured: Boolean(config.encrypted_key), routes: config.routes, models: config.models, maxConcurrency: config.max_concurrency })
      if (request.method !== 'PATCH') return json({ error: '不支持的方法' }, 405)
      const body = await readBody(request, 128000)
      const models = validateModels(body.models)
      for (const model of models.filter(m=>m.platform)) {
        const key=await env.DB.prepare('SELECT * FROM model_relay_credentials WHERE id=?').bind(model.keyId).first()
        if (!key || key.platform!==model.platform) fail('模型与密钥平台不一致')
        const catalog=await env.DB.prepare('SELECT metadata_json FROM model_relay_catalog WHERE credential_id=? AND model_id=?').bind(model.keyId,model.model).first()
        const legacy=model.platform==='google' && model.keyId==='legacy-google' && planModels.some(m=>m.id===model.model)
        if (!catalog && !legacy) fail('请先使用此密钥获取官方模型列表，再选择模型')
        const metadata=catalog ? JSON.parse(catalog.metadata_json) : {vision:true,search:true}
        if ((['multimodal-search','vision-only'].includes(model.capability) && !metadata.vision) || (['multimodal-search','search-only'].includes(model.capability) && !metadata.search)) fail('模型能力超出官方支持范围')
      }
      const routes = normalizeRoutes(body.routes)
      for (const purpose of Object.keys(defaultRelayRoutes)) for (const id of routes[purpose]) {
        const model = models.find(model => model.id === id && model.enabled)
        if (!model || !supportsPurpose(model,purpose)) fail('请选择具有对应能力且已启用的服务器模型')
      }
      if (!Number.isInteger(body.maxConcurrency) || body.maxConcurrency < 1 || body.maxConcurrency > 8) fail('总并发必须为 1–8 的整数')
      const key = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''
      if (key.length > 512 || /[\r\n]/u.test(key)) fail('API Key 无效')
      const secret = body.clearKey === true ? { encrypted_key: null, key_iv: null } : key ? await encryptProxyKey(key, env) : config
      if (body.enabled === true && (!models.some(m=>m.enabled) || (!secret.encrypted_key && models.some(m=>!m.platform)))) fail('请先配置模型及上游 API Key')
      await env.DB.prepare('UPDATE model_relay_config SET enabled=?,endpoint=?,routes_json=?,encrypted_key=?,key_iv=?,models_json=?,max_concurrency=?,updated_at=CURRENT_TIMESTAMP WHERE id=1')
        .bind(body.enabled === true ? 1 : 0, GEMINI_ENDPOINT, JSON.stringify(routes), secret.encrypted_key, secret.key_iv, JSON.stringify(models),body.maxConcurrency).run()
      return json({ ok: true })
    }
    if (path.endsWith('/grants') && request.method === 'POST') {
      const body = await readBody(request)
      const ids = Array.isArray(body.userIds) ? [...new Set(body.userIds)] : []
      const action=body.action ?? 'adjust', amount=body.amount ?? 10
      if (!ids.length || ids.length > 100 || ids.some(id => !Number.isSafeInteger(id) || id < 1)
        || !['adjust','clear'].includes(action)
        || (action==='adjust' && (!Number.isSafeInteger(amount) || amount===0 || Math.abs(amount)>1000000))) fail('请选择 1–100 个用户，调整点数须为非零整数，范围 -1000000–1000000')
      const existing = await env.DB.prepare(`SELECT id FROM users WHERE id IN(${ids.map(() => '?').join(',')})`).bind(...ids).all()
      if (existing.results.length !== ids.length) fail('部分用户不存在')
      const note = typeof body.note === 'string' ? body.note.trim().slice(0, 200) : ''
      try {
        await env.DB.batch(ids.map(id => env.DB.prepare(`INSERT INTO model_relay_grants(user_id,admin_id,amount,action,note)
          SELECT ?,?,${action==='clear' ? '-COALESCE((SELECT balance FROM model_relay_quotas WHERE user_id=?),0)' : 'MAX(-COALESCE((SELECT balance FROM model_relay_quotas WHERE user_id=?),0),?)'},?,?`)
          .bind(id,user.id,id,...(action==='clear'?[]:[amount]),action,note)))
      } catch(error) {
        if (String(error).includes('QUOTA_PENDING')) fail('所选用户仍有模型请求处理中，请待完成后再扣减或清空额度',409)
        throw error
      }
      return json({ ok: true, users: ids.length })
    }
    if (request.method !== 'GET') return json({ error: '不支持的方法' }, 405)
    const url = new URL(request.url), page = Math.max(1, Math.min(100000, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1))
    if (path.endsWith('/users')) {
      const query = (url.searchParams.get('q') || '').slice(0, 100)
      const total = await env.DB.prepare('SELECT COUNT(*) count FROM users WHERE INSTR(LOWER(COALESCE(username,login)),LOWER(?))>0').bind(query).first()
      const rows = await env.DB.prepare(`SELECT u.id,COALESCE(u.username,u.login) login,u.role,COALESCE(q.balance,0) balance,COALESCE(q.granted,0) granted,COALESCE(q.spent,0) spent,
        (SELECT COUNT(*) FROM model_relay_usage r WHERE r.user_id=u.id AND r.status='reserved') pending
        FROM users u LEFT JOIN model_relay_quotas q ON q.user_id=u.id WHERE INSTR(LOWER(COALESCE(u.username,u.login)),LOWER(?))>0 ORDER BY u.id DESC LIMIT 50 OFFSET ?`).bind(query, (page - 1) * 50).all()
      return json({ users: rows.results, total: total.count, page })
    }
    if (path.endsWith('/usage')) {
      const id = Number(url.searchParams.get('userId')) || 0
      const total = await env.DB.prepare('SELECT COUNT(*) count FROM model_relay_usage WHERE (?=0 OR user_id=?)').bind(id,id).first()
      const rows = await env.DB.prepare(`SELECT r.*,COALESCE(u.username,u.login) login FROM model_relay_usage r JOIN users u ON u.id=r.user_id WHERE (?=0 OR r.user_id=?) ORDER BY r.created_at DESC,r.id DESC LIMIT 50 OFFSET ?`).bind(id,id,(page-1)*50).all()
      const summary = await env.DB.prepare(`SELECT COUNT(*) requests,COALESCE(SUM(input_tokens),0) inputTokens,COALESCE(SUM(output_tokens),0) outputTokens,
        COALESCE(SUM(CASE WHEN status IN('success','uncertain') THEN cost ELSE 0 END),0) points FROM model_relay_usage WHERE (?=0 OR user_id=?)`).bind(id,id).first()
      return json({ usage: rows.results, total: total.count, summary, page })
    }
    return json({ error: '接口不存在' }, 404)
  } catch (error) { if (error.status) return json({ error: error.message }, error.status); throw error }
}
export async function relayModel(request, env, user, fetchUpstream = (...args) => fetch(...args)) {
  let id, startedAt, sent = false, stage = 'config', upstreamKey = ''
  try {
    const config = await configFor(env)
    if (!config.enabled) fail('社区中转模型尚未启用', 503)
    const body = await readBody(request, 2900000)
    const { model, candidates, prompt, image, purpose, cost } = validateProxyRequest(body, config.models, config.routes)
    id = body.requestId || crypto.randomUUID()
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/iu.test(id)) fail('requestId 必须为 UUID')
    // Duplicate IDs never invoke upstream again; response text is intentionally not persisted.
    if (await env.DB.prepare('SELECT id FROM model_relay_usage WHERE id=?').bind(id).first()) fail('请求已处理或正在处理，请勿重复提交', 409)
    try {
      await env.DB.prepare('INSERT INTO model_relay_usage(id,user_id,model,purpose,cost) VALUES(?,?,?,?,?)').bind(id,user.id,model.platform ? `${model.platform}/${model.model}` : model.id,purpose,cost).run()
    } catch (error) {
      id = undefined
      if (String(error).includes('QUOTA_EXCEEDED')) fail('社区额度不足，请联系管理员', 402)
      if (String(error).includes('PROXY_BUSY')) fail('社区模型并发已满，请稍后重试', 429)
      if (String(error).includes('UNIQUE')) fail('请求已经提交', 409)
      throw error
    }
    startedAt = Date.now()
    const attempts=[]
    let uncertain=false, normalized, selectedModel, terminal=false
    for (const candidate of candidates) {
      const remaining=110000-(Date.now()-startedAt)
      if (remaining<=0) break
      let attemptSent=false, received=false
      const attemptStarted=Date.now(), label=candidate.platform?`${candidate.platform}/${candidate.model}`:candidate.id
      const attempt={model:label,status:'failed',error:null,durationMs:0,input:0,output:0}
      try {
        stage='request-setup'
        const credential=candidate.platform ? await env.DB.prepare('SELECT * FROM model_relay_credentials WHERE id=?').bind(candidate.keyId).first() : config
        if (!credential?.encrypted_key) throw new Error('CREDENTIAL_UNAVAILABLE')
        upstreamKey=await decryptProxyKey(credential,env)
        const upstream=providerRequest(candidate.platform || 'google',credential,{model:candidate.model || candidate.id,prompt,image,search:purpose==='search'},upstreamKey)
        const signal=AbortSignal.timeout(Math.min(candidates.length>1?30000:110000,remaining))
        stage='upstream-fetch'; attemptSent=true; sent=true
        const response=await fetchUpstream(upstream.url,{method:'POST',headers:upstream.headers,redirect:'manual',signal,body:JSON.stringify(upstream.payload)})
        if (!response.ok) {
          received=true; attempt.error=`UPSTREAM_${response.status}`
          await response.body?.cancel()
        } else {
          stage='upstream-response'
          const result=await providerResponse(candidate.platform || 'google',response)
          if (result.promptFeedback?.blockReason || ['SAFETY','RECITATION','PROHIBITED_CONTENT','BLOCKLIST','SPII','IMAGE_SAFETY'].includes(result.candidates?.[0]?.finishReason) || result.choices?.[0]?.finish_reason==='content_filter' || result.choices?.[0]?.message?.refusal) {
            terminal=true; throw new Error('UPSTREAM_CONTENT_REJECTED')
          }
          normalized=providerOutput(candidate.platform || 'google',result)
          if (!normalized.text?.trim()) throw new Error('UPSTREAM_EMPTY_OUTPUT')
          attempt.status='success'; attempt.input=normalized.input || 0; attempt.output=normalized.output || 0
          selectedModel=label
        }
      } catch(error) {
        if (attemptSent && !received) { uncertain=true; attempt.status='uncertain' }
        attempt.error=['CREDENTIAL_UNAVAILABLE','UPSTREAM_CONTENT_REJECTED','UPSTREAM_EMPTY_OUTPUT','UPSTREAM_OUTPUT_INCOMPLETE'].includes(error.message)?error.message:attemptSent?'UPSTREAM_INTERRUPTED':'LOCAL_SETUP_ERROR'
        normalized=undefined
      }
      attempt.durationMs=Date.now()-attemptStarted; attempts.push(attempt)
      await env.DB.prepare("UPDATE model_relay_usage SET attempts_json=?,model=? WHERE id=? AND status='reserved'").bind(JSON.stringify(attempts),selectedModel || label,id).run()
      if (normalized || terminal) break
    }
    if (normalized) {
      await settle(env,id,'success',{...normalized,duration:Date.now()-startedAt})
      const quota=await env.DB.prepare('SELECT balance,spent FROM model_relay_quotas WHERE user_id=?').bind(user.id).first()
      return json({content:normalized.text,grounding:normalized.grounding,requestId:id,cost,quota,usage:{inputTokens:normalized.input,outputTokens:normalized.output}})
    }
    const error=terminal?'UPSTREAM_CONTENT_REJECTED':uncertain?'UPSTREAM_UNCERTAIN':attempts.at(-1)?.error || 'UPSTREAM_UNAVAILABLE'
    await settle(env,id,uncertain?'uncertain':'failed',{error,duration:Date.now()-startedAt})
    return json({error:terminal?'上游内容安全拒绝，未继续切换模型；点数暂保留，请联系管理员核查':uncertain?'所有可用模型均未完成请求，点数暂保留，请联系管理员核查':'所有可用模型均调用失败，本次社区点数已退还',requestId:id},502)
  } catch (error) {
    if (!error.status) {
      // Only fixed diagnostic labels; never print an upstream body, prompt, URL or credential.
      const message = String(error?.message || '')
      const reason = /illegal invocation|incorrect this|instances of/iu.test(message) ? 'FETCH_RECEIVER'
        : /AbortSignal.*timeout|timeout.*not a function/iu.test(message) ? 'TIMEOUT_API'
        : /JSON/iu.test(message) ? 'RESPONSE_JSON' : /network|connection|DNS/iu.test(message) ? 'NETWORK' : 'RUNTIME'
      const runtimeMessage = stage === 'upstream-fetch' && error?.name === 'TypeError'
        ? message.replaceAll(upstreamKey, '[REDACTED]').replace(/https?:\/\/\S+/gu, '[URL]').replace(/[A-Za-z0-9_+/=-]{24,}/gu, '[REDACTED]').slice(0, 240) : undefined
      console.error('model-relay', JSON.stringify({ stage, reason, name: error?.name || 'Error', requestId: id, timeoutSupported: typeof AbortSignal.timeout === 'function', runtimeMessage }))
    }
    if (id && startedAt) await settle(env,id,sent ? 'uncertain' : 'failed',{ error: sent ? 'UPSTREAM_UNCERTAIN' : 'LOCAL_ERROR', duration: Date.now()-startedAt })
    if (error.status) return json({ error: error.message }, error.status)
    // An interrupted request may still be billed upstream. Keep reserved points and flag it for review.
    return json({ error: '代理请求未完成；若已发送上游，点数暂保留，请联系管理员核查', requestId: id }, 502)
  }
}
async function settle(env,id,status,info) {
  await env.DB.prepare(`UPDATE model_relay_usage SET status=?,input_tokens=?,output_tokens=?,cached_tokens=?,upstream_id=?,error_code=?,duration_ms=?,finished_at=CURRENT_TIMESTAMP WHERE id=? AND status='reserved'`)
    .bind(status,info.input||0,info.output||0,info.cached||0,info.upstream||null,info.error||null,info.duration||0,id).run()
}
export async function recoverProxyReservations(env) {
  // Crash recovery conservatively consumes the reservation; it never silently creates free retries.
  await env.DB.prepare("UPDATE model_relay_usage SET status='uncertain',error_code='INTERRUPTED',finished_at=CURRENT_TIMESTAMP WHERE status='reserved' AND created_at<datetime('now','-5 minutes')").run()
}
