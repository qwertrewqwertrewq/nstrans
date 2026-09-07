import { describe, expect, it } from 'vitest'
import { DictionaryPackRepository } from './dictionaryPacks'

describe('DictionaryPackRepository', () => {
  it('starts empty and installs a versioned game-scoped pack', () => {
    const repository = new DictionaryPackRepository()
    expect(repository.status('general')).toEqual({ version: undefined, entries: 0 })
    repository.install({ schemaVersion: 1, gameId: 'general', version: '1', entries: [{ source: '設定', target: '设置', category: 'ui' }] })
    expect(repository.match('general', ' 設定 ')?.target).toBe('设置')
    expect(repository.match('zelda-totk', '設定')?.target).toBe('设置')
  })

  it('uses untranslated general katakana entries only as search exclusions', () => {
    const repository = new DictionaryPackRepository()
    repository.install({ schemaVersion: 1, gameId: 'general', version: '2', entries: [], searchExclusions: ['セーブ', 'ロード'] })
    expect(repository.isSearchExcluded(' セーブ ')).toBe(true)
    expect(repository.isSearchExcluded('ハイラル')).toBe(false)
  })

  it('searches only the unknown remainder after internal specialized terms and common exclusions', () => {
    const repository = new DictionaryPackRepository()
    repository.install({ schemaVersion: 1, gameId: 'general', version: '2', entries: [], searchExclusions: ['マップ'] })
    repository.install({ schemaVersion: 1, gameId: 'zelda-totk', version: '2', entries: [{ source: 'ハイラル', target: '海拉鲁', category: 'location' }] })
    expect(repository.unresolvedKatakanaParts('zelda-totk', 'ハイラルマップ')).toEqual([])
    expect(repository.unresolvedKatakanaParts('zelda-totk', 'ジオシニオマップ')).toEqual(['ジオシニオ'])
  })

  it('does not subtract a short common exclusion from inside a proper noun', () => {
    const repository = new DictionaryPackRepository()
    repository.install({ schemaVersion: 1, gameId: 'general', version: '2', entries: [], searchExclusions: ['ハイ'] })
    expect(repository.unresolvedKatakanaParts('zelda-totk', 'ハイ')).toEqual([])
    expect(repository.unresolvedKatakanaParts('zelda-totk', 'ハイラル')).toEqual(['ハイラル'])
  })

  it('always prefers the selected game dictionary over the general dictionary', () => {
    const repository = new DictionaryPackRepository()
    repository.install({ schemaVersion: 1, gameId: 'general', version: '1', entries: [{ source: 'ハイラル', target: '海拉尔', category: 'location' }] })
    repository.install({ schemaVersion: 1, gameId: 'zelda-totk', version: '1', entries: [{ source: 'ハイラル', target: '海拉鲁', category: 'location' }] })
    expect(repository.matchExact('zelda-totk', 'ハイラル')?.target).toBe('海拉鲁')
    expect(repository.match('zelda-totk', '西ハイラル平原')?.target).toBe('西海拉鲁平原')
  })
})
