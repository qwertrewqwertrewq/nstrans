import { describe, expect, it } from 'vitest'
import { TranslationMemory } from './translationMemory'
import { CommunityContributionQueue } from './knowledgeSharing'

class TestStorage {
  value: string | null = null
  getItem() { return this.value }
  setItem(_key: string, value: string) { this.value = value }
}

describe('TranslationMemory', () => {
  it('persists normalized model translations across instances', () => {
    const storage = new TestStorage(), first = new TranslationMemory(storage)
    first.rememberTranslation('zelda-totk', 'ja', 'zh-Hans', 'オプ ション', '选项')
    const second = new TranslationMemory(storage)
    expect(second.lookup('zelda-totk', 'ja', 'zh-Hans', 'オプション')).toBe('选项')
  })

  it('only exposes learned entity mappings as mandatory glossary terms', () => {
    const memory = new TranslationMemory()
    memory.rememberEntity({ gameId: 'zelda-totk', source: '精確名', target: '精确名', status: 'learned', updatedAt: 1 })
    memory.rememberEntity({ gameId: 'zelda-totk', source: '曖昧名', status: 'pending', updatedAt: 1 })
    expect(memory.matchLearnedEntity('zelda-totk', '精確名')?.target).toBe('精确名')
    expect(memory.matchLearnedEntity('zelda-totk', '曖昧名')).toBeUndefined()
  })

  it('retries misses and empty research but reuses useful term research', () => {
    const memory = new TranslationMemory()
    memory.rememberEntity({ gameId: 'zelda-totk', source: 'ジオシニオ', status: 'missing', updatedAt: 1 })
    expect(memory.needsEntityLookup('zelda-totk', 'ジオシニオ')).toBe(true)
    memory.rememberEntity({ gameId: 'zelda-totk', source: 'ジオシニオ', status: 'pending', research: { term: 'ジオシニオ', query: '王国之泪 ジオシニオ', evidence: [], sourceUrls: [] }, updatedAt: 2 })
    expect(memory.needsEntityLookup('zelda-totk', 'ジオシニオ')).toBe(true)
    memory.rememberEntity({ gameId: 'zelda-totk', source: 'ジオシニオ', status: 'pending', research: { term: 'ジオシニオ', query: '王国之泪 ジオシニオ', evidence: ['候选资料'], sourceUrls: [] }, updatedAt: 3 })
    expect(memory.needsEntityLookup('zelda-totk', 'ジオシニオ')).toBe(false)
  })

  it('removes previously learned controller glyphs but keeps Han-shaped OCR aliases', () => {
    const storage = new TestStorage()
    storage.value = JSON.stringify({ version: 2, translations: [], entities: [
      { gameId: 'zelda-totk', source: '4', target: '+', status: 'learned', updatedAt: 1 },
      { gameId: 'zelda-totk', source: 'X', target: 'X', status: 'learned', updatedAt: 1 },
      { gameId: 'zelda-totk', source: '世儿夕', canonicalSource: 'ゼルダ', target: '塞尔达', status: 'learned', updatedAt: 1 },
    ] })
    const memory = new TranslationMemory(storage)
    expect(memory.matchLearnedEntity('zelda-totk', '4')).toBeUndefined()
    expect(memory.matchLearnedEntity('zelda-totk', 'X')).toBeUndefined()
    expect(memory.matchLearnedEntity('zelda-totk', '世儿夕')?.target).toBe('塞尔达')
  })

  it('queues only short translations and learned terms after sharing consent', () => {
    const contributions = new CommunityContributionQueue(), memory = new TranslationMemory(undefined, contributions)
    contributions.setEnabled(true)
    memory.rememberTranslation('general', 'ja', 'zh-Hans', '設定', '设置')
    memory.rememberTranslation('general', 'ja', 'zh-Hans', 'これは共有対象にしない非常に長い会話文章で三十二文字を明確に超えるように作られています。', '这是一段不应共享的长对话。')
    memory.rememberEntity({ gameId: 'general', source: '固有名', target: '专有名', status: 'learned', sourceUrl: 'https://ja.wikipedia.org/wiki/%E5%9B%BA%E6%9C%89%E5%90%8D', updatedAt: 1 })
    expect(contributions.pendingCount()).toBe(2)
  })
})
