import { composeKnownTerms } from '../gameAdapters/termComposition'
import type { GameDictionaryPack, GameId, GlossaryEntry } from '../gameAdapters/types'

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>
type StoredPacks = { version: 1; packs: GameDictionaryPack[] }
export type ScopedGlossaryEntry = GlossaryEntry & { scope: '游戏' | '通用' | '本地学习' }
const STORAGE_KEY = 'yomilens.dictionary-packs.v1'
const normalize = (text: string) => text.normalize('NFKC').replace(/\s+/gu, '').trim()

export interface DictionaryDistributionProvider {
  fetchPack(gameId: GameId, installedVersion?: string): Promise<GameDictionaryPack | null>
}

export class HttpDictionaryDistributionProvider implements DictionaryDistributionProvider {
  private readonly baseUrl: string
  constructor(baseUrl: string) { this.baseUrl = baseUrl.replace(/\/$/u, '') }
  async fetchPack(gameId: GameId, installedVersion?: string) {
    void installedVersion
    const response = await fetch(`${this.baseUrl}/api/v1/dictionaries/${encodeURIComponent(gameId)}`)
    if (!response.ok) throw new Error(`远程词库不可用 (${response.status})`)
    return await response.json() as GameDictionaryPack
  }
}

/** Stores validated server packs in a platform-neutral shape. No server is configured yet. */
export class DictionaryPackRepository {
  private readonly packs = new Map<GameId, GameDictionaryPack>()
  private readonly storage?: StorageLike

  constructor(storage?: StorageLike) {
    this.storage = storage
    try {
      const data = JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null') as StoredPacks | null
      if (data?.version === 1) data.packs.forEach((pack) => { if (isValidPack(pack)) this.packs.set(pack.gameId, pack) })
    } catch { /* Ignore corrupt or unavailable storage. */ }
  }

  install(pack: GameDictionaryPack) {
    if (!isValidPack(pack)) throw new Error('无效的词库包')
    this.packs.set(pack.gameId, pack)
    this.persist()
  }

  async sync(gameId: GameId, provider: DictionaryDistributionProvider) {
    const current = this.packs.get(gameId)
    const pack = await provider.fetchPack(gameId, current?.version)
    if (!pack || pack.version === current?.version) return false
    this.install(pack); return true
  }

  match(gameId: GameId, text: string) {
    const entries = this.entriesFor(gameId)
    const exact = entries.find((entry) => normalize(entry.source) === normalize(text))
    return exact ?? composeKnownTerms(text, entries)
  }

  matchExact(gameId: GameId, text: string) {
    return this.entriesFor(gameId).find((entry) => normalize(entry.source) === normalize(text))
  }

  isSearchExcluded(text: string) {
    const key = normalize(text)
    return (this.packs.get('general')?.searchExclusions ?? []).some((entry) => normalize(entry) === key)
  }

  unresolvedKatakanaParts(gameId: GameId, text: string) {
    let residual = normalize(text)
    const exclusions = (this.packs.get('general')?.searchExclusions ?? []).map(normalize)
    if (exclusions.includes(residual)) return []
    const known = [...this.entriesFor(gameId).map((entry) => entry.source), ...exclusions.filter((term) => [...term].length >= 3)]
      .map(normalize)
      .filter((term) => term && residual.includes(term))
      .sort((a, b) => b.length - a.length)
    known.forEach((term) => { residual = residual.replaceAll(term, ' ') })
    return residual.split(/[^\p{Script=Katakana}ー]+/u).filter((term) => [...term].length >= 2)
  }

  findTerms(gameId: GameId, texts: readonly string[], limit = 32): GlossaryEntry[] {
    return this.findTermsWithScope(gameId, texts, limit).map(({ scope: _scope, ...entry }) => entry)
  }

  findTermsWithScope(gameId: GameId, texts: readonly string[], limit = 32): ScopedGlossaryEntry[] {
    const normalizedTexts = texts.map(normalize), seen = new Set<string>()
    const scoped: ScopedGlossaryEntry[] = gameId === 'general'
      ? (this.packs.get('general')?.entries ?? []).map((entry) => ({ ...entry, scope: '通用' }))
      : [
          ...(this.packs.get(gameId)?.entries ?? []).map((entry) => ({ ...entry, scope: '游戏' as const })),
          ...(this.packs.get('general')?.entries ?? []).map((entry) => ({ ...entry, scope: '通用' as const })),
        ]
    return scoped
      .filter((entry) => normalizedTexts.some((text) => text.includes(normalize(entry.source))))
      .filter((entry) => { const key = normalize(entry.source); if (seen.has(key)) return false; seen.add(key); return true })
      .sort((a, b) => b.source.length - a.source.length)
      .slice(0, limit)
  }

  matchedTerms(gameId: GameId, text: string) {
    const normalizedText = normalize(text), seen = new Set<string>()
    const scoped = gameId === 'general'
      ? (this.packs.get('general')?.entries ?? []).map((entry) => ({ ...entry, scope: '通用' as const }))
      : [
          ...(this.packs.get(gameId)?.entries ?? []).map((entry) => ({ ...entry, scope: '游戏' as const })),
          ...(this.packs.get('general')?.entries ?? []).map((entry) => ({ ...entry, scope: '通用' as const })),
        ]
    return scoped
      .filter((entry) => normalizedText.includes(normalize(entry.source)))
      .filter((entry) => { const key = normalize(entry.source); if (!key || seen.has(key)) return false; seen.add(key); return true })
      .sort((a, b) => b.source.length - a.source.length)
  }

  status(gameId: GameId) {
    const packs = gameId === 'general' ? [this.packs.get('general')] : [this.packs.get(gameId), this.packs.get('general')]
    const installed = packs.filter((pack): pack is GameDictionaryPack => Boolean(pack))
    return { version: installed.map((pack) => pack.version).join(' + ') || undefined, entries: installed.reduce((sum, pack) => sum + pack.entries.length, 0) }
  }

  private entriesFor(gameId: GameId) {
    const gameEntries = this.packs.get(gameId)?.entries ?? []
    return gameId === 'general' ? gameEntries : [...gameEntries, ...(this.packs.get('general')?.entries ?? [])]
  }

  private persist() {
    try { this.storage?.setItem(STORAGE_KEY, JSON.stringify({ version: 1, packs: [...this.packs.values()] } satisfies StoredPacks)) } catch { /* Storage failures must not stop OCR. */ }
  }
}

function isValidPack(pack: GameDictionaryPack) {
  return pack?.schemaVersion === 1 && typeof pack.gameId === 'string' && typeof pack.version === 'string' && Array.isArray(pack.entries) && pack.entries.every((entry) => typeof entry.source === 'string' && typeof entry.target === 'string') && (pack.searchExclusions === undefined || (Array.isArray(pack.searchExclusions) && pack.searchExclusions.every((entry) => typeof entry === 'string')))
}

export function browserDictionaryPacks() {
  try { return new DictionaryPackRepository(window.localStorage) } catch { return new DictionaryPackRepository() }
}
