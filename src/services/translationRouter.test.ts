import { describe, expect, it, vi } from 'vitest'
import type { TranslationRuntime } from './translationRuntime'
import { defaultRoutingSettings, enforceMatchedGlossary, TranslationRouter } from './translationRouter'
import { TranslationMemory } from './translationMemory'
import { DictionaryPackRepository } from './dictionaryPacks'
import { EntityLearningQueue } from './entityLookup'

function runtime(calls: unknown[][], responses?: string[][]): Record<'translategemma', TranslationRuntime> {
  return { translategemma: {
    id: 'translategemma', label: 'TranslateGemma', available: async () => true,
    translateMany: vi.fn(async ({ requests, history, glossary, research, correction }: Parameters<TranslationRuntime['translateMany']>[0]) => {
      calls.push([requests.map(({ text }) => text), history, glossary, research, correction])
      return responses?.shift() ?? requests.map((_request, index) => `模型译文${calls.length}-${index + 1}`)
    }),
  } }
}
const request = (text: string) => ({ text, sourceLanguage: 'ja', targetLanguage: 'zh-Hans' })

describe('TranslationRouter', () => {
  it('enforces only glossary terms matched inside the current source', () => {
    expect(enforceMatchedGlossary('はいこのゴーレム製造房', 'はい、这个ゴーレム制造房', [
      { source: 'ゴーレム', target: '魔像' },
      { source: 'はい', target: '是' },
      { source: 'リンク', target: '林克' },
    ])).toBe('是、这个魔像制造房')
  })

  it('ships no built-in short or game dictionary and sends new text to TranslateGemma', async () => {
    const calls: unknown[][] = [], router = new TranslationRouter(runtime(calls))
    const result = await router.translate(['設定', 'プルア', 'ジオシニオの祠'].map(request), defaultRoutingSettings)
    expect(result.map(({ text }) => text)).toEqual(['模型译文1-1', '模型译文1-2', '模型译文1-3'])
    expect(calls).toHaveLength(1)
  })

  it('uses complete and safely composed dictionary matches directly, including katakana terms', async () => {
    const calls: unknown[][] = [], dictionaries = new DictionaryPackRepository()
    dictionaries.install({ schemaVersion: 1, gameId: 'zelda-totk', version: '2026.09.03', entries: [
      { source: '設定', target: '设置', category: 'ui' },
      { source: 'ハイラル', target: '海拉鲁', category: 'location' },
      { source: '平原', target: '平原', category: 'location' },
    ] })
    const router = new TranslationRouter(runtime(calls), new TranslationMemory(), undefined, dictionaries)
    const result = await router.translate(['設定', '西ハイラル平原'].map(request), defaultRoutingSettings)
    expect(result.map(({ text }) => text)).toEqual(['设置', '西海拉鲁平原'])
    expect(calls).toHaveLength(0)
  })

  it('resolves katakana from the selected game first and the general dictionary second', async () => {
    const calls: unknown[][] = [], dictionaries = new DictionaryPackRepository()
    dictionaries.install({ schemaVersion: 1, gameId: 'general', version: '1', entries: [
      { source: 'ハイラル', target: '海拉尔', category: 'location' },
      { source: 'セーブ', target: '保存', category: 'ui' },
    ] })
    dictionaries.install({ schemaVersion: 1, gameId: 'zelda-totk', version: '1', entries: [
      { source: 'ハイラル', target: '海拉鲁', category: 'location' },
    ] })
    const router = new TranslationRouter(runtime(calls), new TranslationMemory(), undefined, dictionaries)
    const result = await router.translate(['ハイラル', 'セーブ'].map(request), defaultRoutingSettings)
    expect(result.map(({ text }) => text)).toEqual(['海拉鲁', '保存'])
    expect(calls).toHaveLength(0)
  })

  it('resolves a katakana entity before the model and supplies it as mandatory terminology', async () => {
    const calls: unknown[][] = [], memory = new TranslationMemory()
    const provider = { lookup: vi.fn(async (source: string) => source === 'ハイラル'
      ? { source, target: '海拉鲁', status: 'learned' as const, sourceUrl: 'https://www.wikidata.org/entity/Q1' }
      : { source, status: 'pending' as const }) }
    const router = new TranslationRouter(runtime(calls), memory, new EntityLearningQueue(memory, provider))
    const result = await router.translate([request('西ハイラル平原')], defaultRoutingSettings)
    expect(result[0].text).toBe('模型译文1-1')
    expect(calls).toHaveLength(1)
    expect(calls[0][2]).toEqual(expect.arrayContaining([expect.objectContaining({ source: 'ハイラル', target: '海拉鲁' })]))
  })

  it('does not search common katakana exclusions but searches an unknown game-specific name', async () => {
    const calls: unknown[][] = [], dictionaries = new DictionaryPackRepository(), memory = new TranslationMemory()
    dictionaries.install({ schemaVersion: 1, gameId: 'general', version: '2', entries: [], searchExclusions: ['セーブ'] })
    const provider = { lookup: vi.fn(async (source: string) => ({ source, status: 'missing' as const })) }
    const router = new TranslationRouter(runtime(calls), memory, new EntityLearningQueue(memory, provider), dictionaries)
    await router.translate([request('セーブ'), request('ジオシニオの祠')], defaultRoutingSettings)
    expect(provider.lookup).toHaveBeenCalledTimes(1)
    expect(provider.lookup).toHaveBeenCalledWith('ジオシニオ', expect.objectContaining({ gameNames: expect.arrayContaining(['塞尔达传说 王国之泪']) }))
    expect(provider.lookup).not.toHaveBeenCalledWith('ジオシニオ', expect.objectContaining({ queryText: expect.anything() }))
  })

  it('passes contextual search evidence to TranslateGemma instead of treating it as a direct replacement', async () => {
    const calls: unknown[][] = [], memory = new TranslationMemory()
    const research = { term: 'ジオシニオ', query: '王国之泪 ジオシニオ', evidence: ['检索摘要'], sourceUrls: ['https://zh.wikipedia.org/wiki/example'] }
    const provider = { lookup: vi.fn(async (source: string) => ({ source, status: 'pending' as const, research })) }
    const router = new TranslationRouter(runtime(calls), memory, new EntityLearningQueue(memory, provider))
    await router.translate([request('ジオシニオの祠')], defaultRoutingSettings)
    expect(calls[0][3]).toEqual([research])
    expect(calls[0][2]).toEqual([])
  })

  it('learns new translations and reuses them only inside the selected game category', async () => {
    const calls: unknown[][] = [], memory = new TranslationMemory(), router = new TranslationRouter(runtime(calls), memory)
    await router.translate([request('新アイテム')], defaultRoutingSettings)
    const remembered = await router.translate([request('新 アイテム')], defaultRoutingSettings)
    const otherGame = await router.translate([request('新アイテム')], { ...defaultRoutingSettings, gameId: 'general' })
    expect(remembered[0].text).toBe('模型译文1-1')
    expect(otherGame[0].text).toBe('模型译文2-1')
    expect(calls).toHaveLength(2)
  })

  it('attaches locally learned terminology to later dialogue', async () => {
    const calls: unknown[][] = [], memory = new TranslationMemory()
    memory.rememberEntity({ gameId: 'zelda-totk', source: 'プルア', target: '普尔亚', status: 'learned', updatedAt: 1 })
    await new TranslationRouter(runtime(calls), memory).translate([request('プルアはこちらへ来ました。')], defaultRoutingSettings)
    expect(calls[0][2]).toEqual(expect.arrayContaining([expect.objectContaining({ source: 'プルア', target: '普尔亚' })]))
  })

  it('never lets a local learned candidate override a selected-game dictionary term in the LLM glossary', async () => {
    const calls: unknown[][] = [], memory = new TranslationMemory(), dictionaries = new DictionaryPackRepository()
    memory.rememberEntity({ gameId: 'zelda-totk', source: 'ゼルダ', target: '薩爾達 消歧義', status: 'learned', updatedAt: 1 })
    dictionaries.install({ schemaVersion: 1, gameId: 'zelda-totk', version: '1', entries: [{ source: 'ゼルダ', target: '塞尔达', category: 'character' }] })
    await new TranslationRouter(runtime(calls), memory, undefined, dictionaries).translate([request('ゼルダ姫が来ました')], defaultRoutingSettings)
    expect(calls[0][2]).toEqual([expect.objectContaining({ source: 'ゼルダ', target: '塞尔达', scope: '游戏' })])
  })

  it('keeps dialogue context, excludes standalone labels and resets after timeout', async () => {
    const calls: unknown[][] = [], router = new TranslationRouter(runtime(calls)); const long = 'これは十分に長い会話の文章です。'
    await router.translate([request(long)], defaultRoutingSettings, 1_000)
    await router.translate([request('名前ラベル')], defaultRoutingSettings, 10_000)
    await router.translate([request(`${long}二`)], defaultRoutingSettings, 20_000)
    await router.translate([request(`${long}三`)], defaultRoutingSettings, 70_000)
    expect(calls[1][1]).toHaveLength(1)
    expect(calls[2][1]).toHaveLength(1)
    expect(calls[3][1]).toHaveLength(0)
  })

  it('retries mixed Japanese/Chinese output and stores only the repaired translation', async () => {
    const calls: unknown[][] = [], memory = new TranslationMemory()
    const router = new TranslationRouter(runtime(calls, [['ジニオ的神殿'], ['吉欧希尼欧神庙']]), memory)
    const result = await router.translate([request('ジオシニオの祠')], defaultRoutingSettings)
    expect(result[0].text).toBe('吉欧希尼欧神庙')
    expect(calls).toHaveLength(2)
    expect(calls[1][4]).toContain('Translate every component')
    expect(memory.lookup('zelda-totk', 'ja', 'zh-Hans', 'ジオシニオの祠')).toBe('吉欧希尼欧神庙')
  })

  it('applies a matched short-word glossary when the model leaves it in Japanese', async () => {
    const calls: unknown[][] = [], memory = new TranslationMemory(), dictionaries = new DictionaryPackRepository()
    dictionaries.install({ schemaVersion: 1, gameId: 'general', version: '3', entries: [
      { source: 'はい', target: '是', category: 'ui' },
      { source: 'ゴーレム', target: '魔像', category: 'monster' },
    ] })
    const router = new TranslationRouter(runtime(calls, [['はい、这个ゴーレム制造厂是从仓库运来的']]), memory, undefined, dictionaries)
    const source = 'はいこのゴーレム製造房では蔵より届けられた'
    const result = await router.translate([request(source)], defaultRoutingSettings)
    expect(result[0].text).toBe('是、这个魔像制造厂是从仓库运来的')
    expect(calls).toHaveLength(1)
    expect(memory.lookup('zelda-totk', 'ja', 'zh-Hans', source)).toBe('是、这个魔像制造厂是从仓库运来的')
  })

  it('does not store or display a mixed result when the repair also fails', async () => {
    const calls: unknown[][] = [], memory = new TranslationMemory()
    const router = new TranslationRouter(runtime(calls, [['ジニオ的神殿'], ['ジオシニオ神庙']]), memory)
    const result = await router.translate([request('ジオシニオの祠')], defaultRoutingSettings)
    expect(result[0].text).toBe('')
    expect(memory.lookup('zelda-totk', 'ja', 'zh-Hans', 'ジオシニオの祠')).toBeUndefined()
  })
})
