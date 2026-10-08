import { useEffect, useState, useSyncExternalStore } from 'react'
import type { EntitySearchSettings } from '../services/entitySearchSettings'
import { getCommunityGrounding, subscribeCommunityGrounding, setCommunityGrounding } from '../services/communityGrounding'
type Catalog = { enabled: boolean; costs: { translation: number; search: number; vision: number }; quota: { balance: number; spent: number } }
export function CommunityModelAccess({ settings, onChange, apiKey }: {
  settings: EntitySearchSettings; onChange(next: Partial<EntitySearchSettings>): void; apiKey: string
}) {
  const [catalog, setCatalog] = useState<Catalog>()
  const [error, setError] = useState(''), [loading, setLoading] = useState(false), [refresh, setRefresh] = useState(0)
  useEffect(() => {
    if (settings.remoteProvider !== 'community') return
    const controller = new AbortController()
    void Promise.resolve().then(async () => {
      if (controller.signal.aborted) return
      setCatalog(undefined); setError('')
      if (!apiKey.trim()) { setError('请先登录社区账号'); setLoading(false); return }
      setLoading(true)
      try {
        const response = await fetch('https://nstrans.221129.xyz/api/v1/relay/catalog', {
          headers: { authorization: `Bearer ${apiKey}` }, signal: controller.signal,
        })
        const body = await response.json()
        if (!response.ok) throw new Error(body.error || '无法读取社区服务状态')
        if (!controller.signal.aborted) setCatalog(body)
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '社区连接失败')
      } finally { if (!controller.signal.aborted) setLoading(false) }
    })
    return () => controller.abort()
  }, [apiKey, settings.remoteProvider, refresh])
  useEffect(() => {
    const quota = (event: Event) => {
      const detail = (event as CustomEvent).detail
      if (detail) setCatalog(previous => previous ? { ...previous, quota: detail } : previous)
    }
    window.addEventListener('nstrans-community-quota', quota)
    return () => {
      window.removeEventListener('nstrans-community-quota', quota)
    }
  }, [])
  useEffect(() => { if (!apiKey.trim()) setCommunityGrounding() }, [apiKey])
  return <div className="remote-defaults">
    <label>远程模型服务</label>
    <select aria-label="远程模型服务" value={settings.remoteProvider || 'direct'}
      onChange={event => onChange({ remoteProvider: event.target.value as 'direct' | 'community' })}>
      <option value="direct">自有远程模型（API Key）</option>
      <option value="community">社区中转模型</option>
    </select>
    {settings.remoteProvider === 'community' && <>
      <small className="muted">使用社区登录凭据和账号额度。由服务器按翻译、搜索、视觉识别用途选择模型，无需选择具体型号或填写上游密钥。</small>
      <small className="muted">免费上游服务可能使用提交的文本、局部截图和回答改进产品，请勿提交敏感信息。</small>
      {error && <p role="alert">{error}</p>}
      {catalog && <p>{catalog.enabled ? `剩余 ${catalog.quota.balance} 点 · 已用 ${catalog.quota.spent} 点` : '社区中转模型尚未启用'}</p>}
      {catalog?.enabled && <small className="muted">翻译 {catalog.costs.translation} / 搜索 {catalog.costs.search} / 视觉 {catalog.costs.vision} 点</small>}
      <button className="secondary" disabled={loading || !apiKey.trim()} onClick={() => setRefresh(value => value + 1)}>
        {loading ? '正在读取服务与额度…' : '刷新服务与额度'}
      </button>
      <CommunitySearchAttribution />
    </>}
  </div>
}
export function CommunitySearchAttribution() {
  const grounding = useSyncExternalStore(subscribeCommunityGrounding, getCommunityGrounding)
  if (!grounding) return null
  return <div className="community-search-attribution">
    <small>最近一次社区搜索依据</small>
    <div>{grounding.sources.map((source,index) => <a key={`${source.url}:${index}`} href={source.url} target="_blank" rel="noopener noreferrer" style={{ marginRight: 12 }}>{source.title}</a>)}</div>
    {grounding.renderedContent && <iframe title="Google 搜索建议" sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={grounding.renderedContent} style={{ width: '100%', border: 0, height: 110 }} />}
  </div>
}
