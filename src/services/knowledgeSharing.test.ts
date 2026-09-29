import { describe, expect, it, vi } from 'vitest'
import { CommunityContributionQueue, CommunityDictionaryEditor, CommunityGameCatalogClient, isShareableContribution } from './knowledgeSharing'

describe('CommunityContributionQueue', () => {
  it('is opt-in and never queues local knowledge before consent', () => {
    const queue = new CommunityContributionQueue()
    queue.enqueue({ gameId: 'general', kind: 'translation', source: '設定', target: '设置', provenance: 'translategemma' })
    expect(queue.pendingCount()).toBe(0)
    queue.setEnabled(true)
    queue.enqueue({ gameId: 'general', kind: 'translation', source: '設定', target: '设置', provenance: 'translategemma' })
    expect(queue.pendingCount()).toBe(1)
  })

  it('uploads only through an explicitly supplied future server adapter', async () => {
    const queue = new CommunityContributionQueue(), upload = vi.fn(async (items) => ({ acceptedIds: items.map(({ id }: { id: string }) => id) }))
    queue.setEnabled(true); queue.enqueue({ gameId: 'zelda-totk', kind: 'term', source: 'ハイラル', target: '海拉鲁', provenance: 'wikimedia', sourceUrl: 'https://www.wikidata.org/entity/Q1' })
    expect(await queue.flush({ upload })).toBe(1)
    expect(upload).toHaveBeenCalledOnce(); expect(queue.pendingCount()).toBe(0)
  })

  it('allows reusable labels but rejects dialogue and unverified Wikimedia claims', () => {
    expect(isShareableContribution({ kind: 'translation', source: '設定', target: '设置', provenance: 'translategemma' })).toBe(true)
    expect(isShareableContribution({ kind: 'translation', source: 'はい', target: '是', provenance: 'translategemma' })).toBe(true)
    expect(isShareableContribution({ kind: 'translation', source: '今日は楽しい', target: '今天很开心', provenance: 'translategemma' })).toBe(false)
    expect(isShareableContribution({ kind: 'translation', source: 'どこへ行くの？', target: '要去哪里？', provenance: 'translategemma' })).toBe(false)
    expect(isShareableContribution({ kind: 'term', source: 'ハイラル', target: '海拉鲁', provenance: 'wikimedia' })).toBe(false)
    expect(isShareableContribution({ kind: 'translation', source: '・スタンプノマップピン', target: '地图图钉', provenance: 'translategemma' })).toBe(false)
    expect(isShareableContribution({ kind: 'translation', source: 'ズーム(', target: '缩放', provenance: 'translategemma' })).toBe(false)
    expect(isShareableContribution({ kind: 'translation', source: '移動(', target: '移动', provenance: 'translategemma' })).toBe(false)
  })
})

describe('CommunityDictionaryEditor', () => {
  it('uses the authenticated client PATCH API so a manual edit receives the API +1 score', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ dictionaries: { 'zelda-totk': [{ translationId: 123, source: 'ハイラル', target: '海拉鲁' }] } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ score: 8, scoreDelta: 1 }) })
    vi.stubGlobal('fetch', request)
    const result = await new CommunityDictionaryEditor('https://nstrans.example', 'nst_live_test').editOrCreate({ gameId: 'zelda-totk', oldSource: 'ハイラル', oldTarget: '海拉鲁', source: 'ハイラル', target: '海拉鲁大陆' })
    expect(result).toEqual({ created: false, score: 8, scoreDelta: 1 })
    expect(request).toHaveBeenNthCalledWith(2, 'https://nstrans.example/api/v1/translations/123', expect.objectContaining({ method: 'PATCH', headers: expect.objectContaining({ authorization: 'Bearer nst_live_test' }) }))
    vi.unstubAllGlobals()
  })
})

describe('CommunityGameCatalogClient', () => {
  it('creates a community game with the authenticated API and accepts an omitted Japanese name', async () => {
    const request = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'final-fantasy-vii-remake', chineseName: '最终幻想 VII 重制版', japaneseName: '', posterUrl: null }),
    })
    vi.stubGlobal('fetch', request)

    const game = await new CommunityGameCatalogClient('https://nstrans.example/', 'nst_live_test').create({ chineseName: '最终幻想 VII 重制版' })

    expect(game).toEqual(expect.objectContaining({
      id: 'final-fantasy-vii-remake',
      label: '最终幻想 VII 重制版',
      searchNames: ['最终幻想 VII 重制版'],
    }))
    expect(request).toHaveBeenCalledWith('https://nstrans.example/api/v1/games', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ authorization: 'Bearer nst_live_test' }),
      body: JSON.stringify({ chineseName: '最终幻想 VII 重制版' }),
    }))
    vi.unstubAllGlobals()
  })

  it('downloads the server catalog while keeping the built-in general profile out of selectable games', async () => {
    const request = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ games: [
        { id: 'general', chineseName: '通用游戏', japaneseName: '汎用ゲーム' },
        { id: 'persona-5', chineseName: '女神异闻录 5', japaneseName: 'ペルソナ5' },
      ] }),
    })
    vi.stubGlobal('fetch', request)

    const games = await new CommunityGameCatalogClient('https://nstrans.example').list()

    expect(games).toHaveLength(1)
    expect(games[0]).toEqual(expect.objectContaining({ id: 'persona-5', searchNames: ['ペルソナ5', '女神异闻录 5'] }))
    expect(request).toHaveBeenCalledWith('https://nstrans.example/api/v1/games')
    vi.unstubAllGlobals()
  })
})
