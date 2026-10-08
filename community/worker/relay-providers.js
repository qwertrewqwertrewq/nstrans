import { upstreamRequest, upstreamOutput } from './gemini-upstream.js'

export const platforms = ['google', 'bailian', 'deepseek']
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }) }
export function bailianHost(credential) {
  if (!/^[a-zA-Z0-9-]{1,80}$/u.test(credential.workspace || '')) fail('阿里百炼密钥需要填写北京业务空间 ID')
  return `https://${credential.workspace}.cn-beijing.maas.aliyuncs.com`
}
export async function discoverModels(credential, key, fetcher = (...args) => fetch(...args)) {
  const found = new Map()
  let token = ''
  for (let page = 1; page <= 30; page++) {
    const url = credential.platform === 'google'
      ? new URL('https://generativelanguage.googleapis.com/v1beta/models')
      : credential.platform === 'deepseek' ? new URL('https://api.deepseek.com/models')
        : new URL(`${bailianHost(credential)}/api/v1/models`)
    if (credential.platform === 'google') { url.searchParams.set('pageSize','1000'); if (token) url.searchParams.set('pageToken',token) }
    if (credential.platform === 'bailian') {
      url.searchParams.set('page_no',String(page)); url.searchParams.set('page_size','100')
      url.searchParams.set('inference_providers','aliyun-bailian'); url.searchParams.set('service_site','asia-pacific-china')
      url.searchParams.set('capabilities','TG')
      url.searchParams.append('capabilities','VU')
    }
    const response = await fetcher(url.href, { headers: credential.platform === 'google' ? {'x-goog-api-key':key} : {authorization:`Bearer ${key}`}, redirect:'manual', signal:AbortSignal.timeout(30000) })
    if (!response.ok) fail(`官方模型目录返回 ${response.status}，请检查密钥、权限和地域`,502)
    const body = await response.text()
    if (body.length > 6000000) fail('官方模型目录过大',502)
    let data
    try { data=JSON.parse(body) } catch { fail('官方模型目录返回格式无效',502) }
    const rows = credential.platform === 'google' ? data.models : credential.platform === 'deepseek' ? data.data : data.output?.models
    if (!Array.isArray(rows)) fail('官方模型目录返回格式无效',502)
    for (const row of rows) {
      const id = credential.platform === 'google' ? row.name?.replace(/^models\//u,'') : credential.platform === 'deepseek' ? row.id : row.model
      if (typeof id !== 'string' || !/^[\w.-]{1,160}$/u.test(id)) continue
      let vision=false, search=false
      if (credential.platform === 'google') {
        if (!row.supportedGenerationMethods?.includes('generateContent') || !id.startsWith('gemini-') || /image|audio|tts|robotics/iu.test(id)) continue
        // The list API does not advertise grounding. Only verified families get it.
        vision=['gemini-2.5-flash','gemini-2.5-flash-lite','gemini-2.5-pro'].includes(id)
        search=vision
      } else if (credential.platform === 'bailian') {
        if (!row.capabilities?.some(c=>['TG','VU'].includes(c)) || (row.inference_metadata?.response_modality && !row.inference_metadata.response_modality.includes('Text'))) continue
        vision=row.capabilities.includes('VU') || row.inference_metadata?.request_modality?.includes('Image')
        search=row.features?.includes('web-search') === true
      } else {
        if (row.output_modalities && !row.output_modalities.includes('text')) continue
        // DeepSeek does not document hosted web search. Image support is metadata driven.
        vision=row.input_modalities?.includes('image') === true
      }
      found.set(id,{id,name:String(row.displayName || row.name || id).slice(0,200),vision,search})
    }
    token=data.nextPageToken || ''
    const more=credential.platform === 'google' ? Boolean(token) : credential.platform === 'bailian' ? page*100 < data.output.total : false
    if (!more) return [...found.values()].sort((a,b)=>a.id.localeCompare(b.id))
  }
  fail('官方模型目录分页超出限制，请稍后重试',502)
}
export function providerRequest(platform, credential, input, key) {
  if (platform === 'google') return upstreamRequest(input,key)
  const content=input.image ? [{type:'text',text:input.prompt},{type:'image_url',image_url:{url:input.image}}] : input.prompt
  return {
    url: platform === 'deepseek' ? 'https://api.deepseek.com/chat/completions' : `${bailianHost(credential)}/compatible-mode/v1/chat/completions`,
    headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},
    payload:{model:input.model,messages:[{role:'user',content}],max_tokens:4096,stream:false,
      ...(platform === 'deepseek' ? {thinking:{type:'disabled'}} : {}),
      ...(platform === 'bailian' ? {enable_thinking:false,...(input.search ? {stream:true,stream_options:{include_usage:true},enable_search:true,search_options:{forced_search:true,enable_source:true}} : {})} : {})},
  }
}
export async function providerResponse(platform, response) {
  if (platform!=='bailian' || !response.headers.get('content-type')?.includes('text/event-stream')) return response.json()
  const reader=response.body.getReader(), decoder=new TextDecoder()
  let buffer='', text='', total=0, finish=null, usage={}, id, done=false
  function line(value) {
    if (!value.startsWith('data:')) return
    const data=value.slice(5).trim()
    if (data==='[DONE]') { done=true; return }
    if (!data) return
    const chunk=JSON.parse(data)
    if (chunk.error) throw new Error('UPSTREAM_STREAM_ERROR')
    if (typeof chunk.id==='string') id=chunk.id
    if (chunk.usage) usage=chunk.usage
    for (const choice of chunk.choices || []) if ((choice.index ?? 0)===0) {
      if (typeof choice.delta?.content==='string') text+=choice.delta.content
      if (choice.finish_reason) finish=choice.finish_reason
    }
  }
  try {
    while (true) {
      const next=await reader.read()
      if (next.done) break
      total+=next.value.byteLength
      if (total>8000000) throw new Error('UPSTREAM_STREAM_TOO_LARGE')
      buffer+=decoder.decode(next.value,{stream:true})
      let end
      while ((end=buffer.indexOf('\n'))>=0) { line(buffer.slice(0,end).replace(/\r$/u,'')); buffer=buffer.slice(end+1) }
    }
    buffer+=decoder.decode()
    if (buffer.trim()) line(buffer.trim())
    if (!done || finish!=='stop') throw new Error('UPSTREAM_OUTPUT_INCOMPLETE')
    return {id,usage,choices:[{finish_reason:finish,message:{content:text}}]}
  } finally { await reader.cancel() }
}
export function providerOutput(platform, result) {
  if (platform === 'google') return upstreamOutput(result)
  const choice=result.choices?.[0]
  if (result.error || choice?.finish_reason !== 'stop' || typeof choice.message?.content !== 'string') throw new Error('UPSTREAM_OUTPUT_INCOMPLETE')
  const count=value=>Number.isSafeInteger(value)&&value>=0?value:0
  const usage=result.usage || {}
  return {text:choice.message.content,input:count(usage.prompt_tokens),output:count(usage.completion_tokens),cached:count(usage.prompt_tokens_details?.cached_tokens),upstream:typeof result.id==='string'?result.id.slice(0,200):null}
}
