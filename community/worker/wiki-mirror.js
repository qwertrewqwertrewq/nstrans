const hosts = { ja: 'ja.wikipedia.org', zh: 'zh.wikipedia.org', wikidata: 'www.wikidata.org' }

// Fixed hosts and read-only operations: this is not a general URL proxy.
export function wikiMirrorUrl(body) {
  const host = Object.hasOwn(hosts, body?.site ?? '') ? hosts[body.site] : null
  const p = body?.params
  if (!host || !p || typeof p !== 'object' || Array.isArray(p)) throw new Error('无效的 Wiki 请求')
  const url = new URL(`https://${host}/w/api.php`)
  const setText = (key) => {
    if (typeof p[key] !== 'string' || !p[key].trim() || p[key].length > 500) throw new Error('查询文字不能为空或超过 500 字')
    url.searchParams.set(key, p[key])
  }
  if (body.site === 'wikidata' && p.action === 'wbsearchentities') {
    setText('search')
    for (const [key, value] of Object.entries({ action: 'wbsearchentities', language: 'ja', uselang: 'zh-cn', type: 'item', limit: '5' })) url.searchParams.set(key, value)
  } else if (body.site !== 'wikidata' && p.action === 'query') {
    url.searchParams.set('action', 'query')
    if (p.generator === 'search') {
      setText('gsrsearch')
      for (const [key, value] of Object.entries({ generator: 'search', gsrnamespace: '0', gsrlimit: '5', prop: 'langlinks', lllang: 'zh', lllimit: '5' })) url.searchParams.set(key, value)
    } else if (p.list === 'search') {
      setText('srsearch')
      for (const [key, value] of Object.entries({ list: 'search', srlimit: '3', srprop: 'snippet' })) url.searchParams.set(key, value)
    } else if (body.site === 'zh' && p.titles) {
      setText('titles')
      for (const [key, value] of Object.entries({ redirects: '1', converttitles: '1', variant: 'zh-cn' })) url.searchParams.set(key, value)
    } else throw new Error('不支持的 Wiki 查询操作')
  } else throw new Error('仅支持 Wiki 只读搜索')
  url.searchParams.set('format', 'json')
  return url
}

export async function proxyWikiMirror(body) {
  let url
  try { url = wikiMirrorUrl(body) }
  catch (error) { return Response.json({ error: error.message }, { status: 400 }) }
  try {
    const upstream = await fetch(url, {
      headers: { 'User-Agent': 'NSTrans/1.0.0 (https://github.com/qwertrewqwertrewq/nstrans; terminology search)', accept: 'application/json' },
      signal: AbortSignal.timeout(12000),
      redirect: 'error',
    })
    if (!upstream.ok) return Response.json({ error: `Wiki 上游暂不可用 (${upstream.status})` }, { status: 502 })
    const data = await upstream.json()
    if (data.error) return Response.json({ error: 'Wiki 上游查询失败' }, { status: 502 })
    return Response.json(data, { headers: { 'cache-control': 'no-store' } })
  } catch { return Response.json({ error: 'Wiki 上游连接失败或超时，请稍后重试' }, { status: 502 }) }
}
