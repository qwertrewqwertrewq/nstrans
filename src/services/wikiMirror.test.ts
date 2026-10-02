import { afterEach, describe, expect, it, vi } from 'vitest'
import { wikiMirrorFetch } from './wikiMirror'
vi.mock('./knowledgeSharing', () => ({ loadCommunityApiKey: vi.fn() }))
import { loadCommunityApiKey } from './knowledgeSharing'

afterEach(() => vi.unstubAllGlobals())
describe('Wiki mirror transport', () => {
  it('reads the latest community key for every request and forwards query parameters', async () => {
    vi.mocked(loadCommunityApiKey).mockReturnValueOnce('first').mockReturnValueOnce('second')
    const request = vi.fn<typeof fetch>(async () => Response.json({ query: {} }))
    vi.stubGlobal('fetch', request)
    const url = 'https://ja.wikipedia.org/w/api.php?action=query&list=search&srsearch=ゲーム+ゼルダ'
    await wikiMirrorFetch(url)
    await wikiMirrorFetch(url)
    expect(new Headers(request.mock.calls[0][1]?.headers).get('authorization')).toBe('Bearer first')
    expect(new Headers(request.mock.calls[1][1]?.headers).get('authorization')).toBe('Bearer second')
    expect(JSON.parse(String(request.mock.calls[0][1]?.body)).params.srsearch).toBe('ゲーム ゼルダ')
  })
  it('fails clearly before network access when logged out', async () => {
    vi.mocked(loadCommunityApiKey).mockReturnValue('')
    const request = vi.fn()
    vi.stubGlobal('fetch', request)
    await expect(wikiMirrorFetch('https://ja.wikipedia.org/w/api.php')).rejects.toThrow('先登录社区')
    expect(request).not.toHaveBeenCalled()
  })
})
