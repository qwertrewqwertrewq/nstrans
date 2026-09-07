import { describe, expect, it, vi } from 'vitest'
import { buildEntitySearchQuery, ConfigurableEntityLookup, extractEntityCandidates, WikimediaEntityLookup } from './entityLookup'

describe('entity lookup', () => {
  it('builds every web query with the selected game name and source term', () => {
    expect(buildEntitySearchQuery('グチニザ', ['ゼルダの伝説', '塞尔达传说 王国之泪'])).toBe('塞尔达传说 王国之泪 "グチニザ" 中文 译名')
  })

  it('searches with the complete OCR label while keeping the katakana term as the learned entity', async () => {
    const wiki = { lookup: vi.fn(async () => ({ source: 'チナガレ', status: 'missing' as const })) }
    const web = { search: vi.fn(async () => [{ title: '地名资料', url: 'https://example.com/location', snippet: 'チナガレ湿地帯的中文名称' }]) }
    const result = await new ConfigurableEntityLookup(wiki, web).lookup('チナガレ', {
      queryText: 'チナガレ湿地帯', gameNames: ['塞尔达传说 王国之泪'],
      searchSettings: { primary: 'brave', fallback: 'none', qianfanApiKey: '', braveApiKey: 'key' },
    })
    expect(web.search).toHaveBeenCalledWith('brave', '塞尔达传说 王国之泪 "チナガレ湿地帯" 中文 译名', 'key')
    expect(result.research).toMatchObject({ term: 'チナガレ', query: '塞尔达传说 王国之泪 "チナガレ湿地帯" 中文 译名' })
  })

  it('uses the configured fallback only when the primary engine has no results', async () => {
    const wiki = { lookup: vi.fn(async () => ({ source: 'グチニザ', status: 'missing' as const })) }
    const web = { search: vi.fn(async (engine: string) => engine === 'qianfan' ? [] : [{ title: '地名表', url: 'https://example.com/term', snippet: 'グチニザ对应古奇尼扎' }]) }
    const result = await new ConfigurableEntityLookup(wiki, web).lookup('グチニザ', {
      gameNames: ['塞尔达传说 王国之泪'],
      searchSettings: { primary: 'qianfan', fallback: 'brave', qianfanApiKey: 'q-key', braveApiKey: 'b-key' },
    })
    expect(web.search).toHaveBeenNthCalledWith(1, 'qianfan', '塞尔达传说 王国之泪 "グチニザ" 中文 译名', 'q-key')
    expect(web.search).toHaveBeenNthCalledWith(2, 'brave', '塞尔达传说 王国之泪 "グチニザ" 中文 译名', 'b-key')
    expect(result.research?.evidence[0]).toContain('古奇尼扎')
    expect(wiki.lookup).not.toHaveBeenCalled()
  })

  it('falls back when the primary wiki request fails', async () => {
    const wiki = { lookup: vi.fn(async () => { throw new Error('offline') }) }
    const web = { search: vi.fn(async () => [{ title: '结果', url: 'https://example.com', snippet: '候选译名' }]) }
    const result = await new ConfigurableEntityLookup(wiki, web).lookup('テスト', {
      gameNames: ['测试游戏'],
      searchSettings: { primary: 'wiki', fallback: 'brave', qianfanApiKey: '', braveApiKey: 'key' },
    })
    expect(result.research?.evidence).toEqual(['结果: 候选译名'])
    expect(web.search).toHaveBeenCalledOnce()
  })

  it('extracts only katakana candidates from labels and dialogue', () => {
    expect(extractEntityCandidates('西ハイラル平原')).toEqual(['ハイラル'])
    expect(extractEntityCandidates('プルアがこちらへ来ました。')).toContain('プルア')
  })

  it('learns only an exact Japanese title with a Chinese language link', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ query: { pages: { 1: { title: 'ゼルダの伝説', langlinks: [{ title: '薩爾達傳說' }] } } } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ query: { pages: { 2: { title: '塞尔达传说' } } } }) })
    const result = await new WikimediaEntityLookup(request).lookup('ゼルダの伝説')
    expect(result).toMatchObject({ status: 'learned', target: '塞尔达传说' })
  })

  it('stores a non-exact search hit only as a pending candidate', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ query: { pages: { 1: { title: '別の項目', langlinks: [{ title: '其他条目' }] } } } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ search: [] }) })
    const result = await new WikimediaEntityLookup(request).lookup('未知名')
    expect(result.status).toBe('pending')
    expect(result.target).toBeUndefined()
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('falls back to an exact free Wikidata Chinese label', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ query: { pages: {} } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ search: [{ match: { text: 'ハイラル' }, display: { label: { value: '海拉鲁' } }, concepturi: 'https://www.wikidata.org/entity/Q1' }] }) })
    const result = await new WikimediaEntityLookup(request).lookup('ハイラル')
    expect(result).toMatchObject({ status: 'learned', target: '海拉鲁', sourceUrl: 'https://www.wikidata.org/entity/Q1' })
  })

  it('searches free Japanese and Chinese Wikipedia with the game name when no exact entity exists', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ query: { pages: {} } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ search: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ query: { search: [{ title: '王国之泪', snippet: '<span>ジオシニオ</span> の名称' }] } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ query: { search: [{ title: '塞尔达传说 王国之泪', snippet: '神庙名称资料' }] } }) })
    const result = await new WikimediaEntityLookup(request).lookup('ジオシニオ', { gameNames: ['ゼルダの伝説 ティアーズ オブ ザ キングダム', '塞尔达传说 王国之泪'] })
    expect(result.research?.query).toContain('ゼルダの伝説 ティアーズ オブ ザ キングダム "ジオシニオ"')
    expect(result.research?.evidence).toContain('王国之泪: ジオシニオ の名称')
    expect(request).toHaveBeenCalledTimes(4)
  })

})
