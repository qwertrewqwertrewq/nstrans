import type { GameId, GlossaryEntry } from '../gameAdapters/types'
import { isShareableContribution, type CommunityContributionQueue } from './knowledgeSharing'
import { isLikelyStandaloneLabel } from './translateGemmaPrompt'
import { containsJapaneseKana } from './translationQuality'
import type { TerminologyResearch } from './translationRuntime'

export type MemoryOrigin = 'model' | 'wikimedia'
export type StoredTranslation = {
  gameId: GameId
  sourceLanguage: string
  targetLanguage: string
  source: string
  target: string
  origin: MemoryOrigin
  hits: number
  updatedAt: number
}
export type StoredEntity = {
  gameId: GameId
  source: string
  canonicalSource?: string
  target?: string
  status: 'learned' | 'pending' | 'missing'
  sourceUrl?: string
  research?: TerminologyResearch
  origin?: 'remote' | 'search' | 'ocr-fallback'
  manuallyEdited?: boolean
  updatedAt: number
}
type MemoryData = { version: 2; translations: StoredTranslation[]; entities: StoredEntity[] }
type LegacyMemoryData = { version: 1; translations: Array<Omit<StoredTranslation, 'gameId'> & { gameAdapterId: string }>; entities: Array<Omit<StoredEntity, 'gameId'> & { gameAdapterId: string }> }
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

const STORAGE_KEY = 'yomilens.translation-memory.v1'
export const normalizeMemoryText = (text: string) => text.normalize('NFKC').replace(/\s+/gu, '').trim()
const translationKey = (game: GameId, sourceLanguage: string, targetLanguage: string, source: string) => `${game}\u0000${sourceLanguage}\u0000${targetLanguage}\u0000${normalizeMemoryText(source)}`
const entityKey = (game: GameId, source: string) => `${game}\u0000${normalizeMemoryText(source)}`
const migrateGameId = (id: string): GameId => id === 'none' ? 'general' : id as GameId

export class TranslationMemory {
  private readonly translations = new Map<string, StoredTranslation>()
  private readonly entities = new Map<string, StoredEntity>()
  private readonly storage?: StorageLike
  private readonly contributions?: CommunityContributionQueue

  constructor(storage?: StorageLike, contributions?: CommunityContributionQueue) {
    this.storage = storage
    this.contributions = contributions
    try {
      const parsed = JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null') as MemoryData | LegacyMemoryData | null
      if (parsed?.version === 2) {
        parsed.translations.filter(isReusableTranslation).forEach((entry) => this.translations.set(translationKey(entry.gameId, entry.sourceLanguage, entry.targetLanguage, entry.source), entry))
        parsed.entities.filter(isReusableEntity).forEach((entry) => this.entities.set(entityKey(entry.gameId, entry.source), entry))
        if (this.translations.size !== parsed.translations.length || this.entities.size !== parsed.entities.length) this.persist()
      } else if (parsed?.version === 1) {
        parsed.translations.forEach(({ gameAdapterId, ...entry }) => { const migrated = { ...entry, gameId: migrateGameId(gameAdapterId) }; if (isReusableTranslation(migrated)) this.translations.set(translationKey(migrated.gameId, migrated.sourceLanguage, migrated.targetLanguage, migrated.source), migrated) })
        parsed.entities.forEach(({ gameAdapterId, ...entry }) => { const migrated = { ...entry, gameId: migrateGameId(gameAdapterId) }; if (isReusableEntity(migrated)) this.entities.set(entityKey(migrated.gameId, migrated.source), migrated) })
        this.persist()
      }
    } catch { /* Ignore corrupt or unavailable platform storage. */ }
  }

  lookup(game: GameId, sourceLanguage: string, targetLanguage: string, source: string) {
    const entry = this.translations.get(translationKey(game, sourceLanguage, targetLanguage, source))
    if (entry) entry.hits += 1
    return entry?.target
  }

  rememberTranslation(game: GameId, sourceLanguage: string, targetLanguage: string, source: string, target: string, origin: MemoryOrigin = 'model') {
    if (!normalizeMemoryText(source) || !target.trim()) return
    if (!isReusableTranslation({ source, target, origin })) return
    const key = translationKey(game, sourceLanguage, targetLanguage, source), previous = this.translations.get(key)
    this.translations.set(key, { gameId: game, sourceLanguage, targetLanguage, source, target: target.trim(), origin, hits: previous?.hits ?? 0, updatedAt: Date.now() })
    if (!previous || previous.target !== target.trim()) this.contributions?.enqueue({ gameId: game, kind: 'translation', source, target: target.trim(), provenance: 'translategemma' })
    this.persist()
  }

  entityStatus(game: GameId, source: string) { return this.entities.get(entityKey(game, source))?.status }
  entity(game: GameId, source: string) { return this.entities.get(entityKey(game, source)) }

  hasEntityKnowledge(game: GameId, source: string) {
    const entry = this.entities.get(entityKey(game, source))
    return entry?.status === 'learned' || Boolean(entry?.research?.evidence.length)
  }

  entityLookupWasEmpty(game: GameId, source: string) {
    const entry = this.entities.get(entityKey(game, source))
    return Boolean(entry) && entry?.status !== 'learned' && !entry?.research?.evidence.length
  }

  needsEntityLookup(game: GameId, source: string) {
    const entry = this.entities.get(entityKey(game, source))
    if (!entry || entry.status === 'missing') return true
    if (entry.status === 'learned') return false
    return !entry.research?.evidence.length
  }

  rememberEntity(entry: StoredEntity, share = true) {
    this.entities.set(entityKey(entry.gameId, entry.source), entry)
    if (share && entry.status === 'learned' && entry.target) this.contributions?.enqueue({ gameId: entry.gameId, kind: 'term', source: entry.source, target: entry.target, provenance: 'wikimedia', sourceUrl: entry.sourceUrl })
    this.persist()
  }

  matchLearnedEntity(game: GameId, source: string): GlossaryEntry | undefined {
    const entry = this.entities.get(entityKey(game, source))
    return entry?.status === 'learned' && entry.target ? { source: entry.source, target: entry.target, category: 'learned' } : undefined
  }

  matchManualEntity(game: GameId, source: string): GlossaryEntry | undefined {
    const entry = this.entities.get(entityKey(game, source))
    return entry?.status === 'learned' && entry.target && entry.manuallyEdited ? { source: entry.source, target: entry.target, category: 'learned' } : undefined
  }

  entitiesForText(game: GameId, text: string) {
    const normalized = normalizeMemoryText(text)
    return [...this.entities.values()].filter((entry) => entry.gameId === game && normalized.includes(normalizeMemoryText(entry.source)))
  }

  editEntity(game: GameId, oldSource: string, source: string, target: string, origin: StoredEntity['origin']) {
    const cleanedSource = source.trim(), cleanedTarget = target.trim()
    if (!cleanedSource || !cleanedTarget) throw new Error('原文和翻译不能为空')
    this.entities.delete(entityKey(game, oldSource))
    this.rememberEntity({ gameId: game, source: cleanedSource, target: cleanedTarget, status: 'learned', origin, manuallyEdited: true, updatedAt: Date.now() }, false)
  }

  findLearnedTerms(game: GameId, texts: readonly string[], limit = 24): GlossaryEntry[] {
    const normalizedTexts = texts.map(normalizeMemoryText)
    return [...this.entities.values()]
      .filter((entry) => entry.gameId === game && entry.status === 'learned' && entry.target && normalizedTexts.some((text) => text.includes(normalizeMemoryText(entry.source))))
      .slice(0, limit)
      .map((entry) => ({ source: entry.source, target: entry.target!, category: 'learned' }))
  }

  findManualTerms(game: GameId, texts: readonly string[], limit = 24): GlossaryEntry[] {
    const normalizedTexts = texts.map(normalizeMemoryText)
    return [...this.entities.values()]
      .filter((entry) => entry.gameId === game && entry.manuallyEdited && entry.status === 'learned' && entry.target && normalizedTexts.some((text) => text.includes(normalizeMemoryText(entry.source))))
      .slice(0, limit)
      .map((entry) => ({ source: entry.source, target: entry.target!, category: 'learned' }))
  }

  findResearch(game: GameId, texts: readonly string[], limit = 8): TerminologyResearch[] {
    const normalizedTexts = texts.map(normalizeMemoryText)
    return [...this.entities.values()]
      .filter((entry) => entry.gameId === game && entry.research && normalizedTexts.some((text) => text.includes(normalizeMemoryText(entry.source))))
      .slice(0, limit)
      .map((entry) => entry.research!)
  }

  stats() {
    const entities = [...this.entities.values()]
    return { translations: this.translations.size, learnedTerms: entities.filter(({ status }) => status === 'learned').length, pendingTerms: entities.filter(({ status }) => status === 'pending').length }
  }

  private persist() {
    try { this.storage?.setItem(STORAGE_KEY, JSON.stringify({ version: 2, translations: [...this.translations.values()], entities: [...this.entities.values()] } satisfies MemoryData)) } catch { /* Storage quota/privacy mode must not break translation. */ }
  }
}

function isReusableTranslation(entry: Pick<StoredTranslation, 'source' | 'target' | 'origin'>) {
  if (containsJapaneseKana(entry.target)) return false
  if (isShareableContribution({ kind: 'translation', source: entry.source, target: entry.target, provenance: entry.origin === 'wikimedia' ? 'wikimedia' : 'translategemma' })) return true
  const compactSource = entry.source.normalize('NFKC').replace(/\s+/gu, '')
  return [...compactSource].length <= 32
    && isLikelyStandaloneLabel(entry.source)
    && /[\p{Script=Katakana}ー・]{2,}/u.test(entry.source)
}

function isReusableEntity(entry: Pick<StoredEntity, 'source' | 'target' | 'status'>) {
  if (entry.status !== 'learned') return true
  if (!entry.target?.trim()) return false
  // Learned OCR aliases may legitimately look like Han characters (世儿夕),
  // but controller glyphs, ASCII button labels and punctuation-only mappings
  // are not Japanese terminology and must not survive migration.
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(entry.source)
    && !/^[\p{P}\p{S}\s]+$/u.test(entry.target)
}

export function browserTranslationMemory(contributions?: CommunityContributionQueue) {
  try { return new TranslationMemory(window.localStorage, contributions) } catch { return new TranslationMemory(undefined, contributions) }
}
