import { loadCommunityApiKey } from './knowledgeSharing'

/** Keep the existing Wikimedia parser and evidence URLs; proxy only transport. */
export const wikiMirrorFetch: typeof fetch = async (input, init) => {
  const apiKey = loadCommunityApiKey().trim()
  if (!apiKey) throw new Error('使用 wiki镜像需要先登录社区账号')
  const upstream = new URL(input instanceof Request ? input.url : String(input))
  const site = { 'ja.wikipedia.org': 'ja', 'zh.wikipedia.org': 'zh', 'www.wikidata.org': 'wikidata' }[upstream.hostname]
  if (!site || upstream.pathname !== '/w/api.php') throw new Error('不支持的 Wiki 请求')
  const response = await fetch('https://nstrans.221129.xyz/api/v1/wiki-mirror', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ site, params: Object.fromEntries(upstream.searchParams) }),
    signal: init?.signal,
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error || `wiki镜像请求失败 (${response.status})`)
  }
  return response
}
