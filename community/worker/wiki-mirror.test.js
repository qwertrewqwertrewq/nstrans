import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from './index.js'
import { wikiMirrorUrl } from './wiki-mirror.js'

afterEach(() => vi.unstubAllGlobals())
const request = (key, params = { action: 'query', generator: 'search', gsrsearch: 'ゼルダ' }) => new Request('https://nstrans.221129.xyz/api/v1/wiki-mirror', {
  method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify({ site: 'ja', params }),
})
const database = (user) => ({ prepare: () => ({ bind: () => ({ first: async () => user, run: async () => ({}) }) }) })

describe('authenticated Wiki mirror', () => {
  it('rejects missing and revoked keys before contacting Wikimedia', async () => {
    const upstream = vi.fn()
    vi.stubGlobal('fetch', upstream)
    for (const key of ['', 'revoked']) {
      const response = await worker.fetch(request(key), { DB: database(null) })
      expect(response.status).toBe(401)
      expect(response.headers.get('access-control-allow-origin')).toBe('*')
    }
    expect(upstream).not.toHaveBeenCalled()
  })
  it('only forwards read-only parameters and does not forward the community key', async () => {
    const upstream = vi.fn(async () => Response.json({ query: { pages: {} } }))
    vi.stubGlobal('fetch', upstream)
    const response = await worker.fetch(request('test-key'), { DB: database({ id: 1, key_id: 2 }) })
    expect(response.status).toBe(200)
    const [url, options] = upstream.mock.calls[0]
    expect(url.hostname).toBe('ja.wikipedia.org')
    expect(url.searchParams.get('gsrsearch')).toBe('ゼルダ')
    expect(JSON.stringify(options)).not.toContain('test-key')
    expect(options.redirect).toBe('error')
  })
  it('rejects arbitrary hosts and write actions', () => {
    expect(() => wikiMirrorUrl({ site: 'https://example.com', params: {} })).toThrow()
    expect(() => wikiMirrorUrl({ site: 'ja', params: { action: 'edit', titles: 'Example' } })).toThrow()
    const url = wikiMirrorUrl({ site: 'zh', params: { action: 'query', titles: '薩爾達', callback: 'x', prop: 'revisions' } })
    expect(url.searchParams.get('variant')).toBe('zh-cn')
    expect(url.searchParams.has('callback')).toBe(false)
    expect(url.searchParams.has('prop')).toBe(false)
  })
})
