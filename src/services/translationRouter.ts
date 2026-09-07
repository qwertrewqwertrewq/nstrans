import type { TranslationEngineId, TranslationRoutingSettings } from '../types'
import { isLikelyStandaloneLabel } from './translateGemmaPrompt'
import { EntityLearningQueue, extractKatakanaCandidates } from './entityLookup'
import { TranslationMemory } from './translationMemory'
import { DictionaryPackRepository } from './dictionaryPacks'
import type { ConversationTurn, RuntimeRequest, TranslationRuntime } from './translationRuntime'
import { validateTranslation } from './translationQuality'
import { getGameProfile } from '../gameAdapters/registry'
import { defaultEntitySearchSettings } from './entitySearchSettings'
import { writeDiagnosticLog } from './diagnosticLog'

export type RoutedTranslation = { text: string; engine: TranslationEngineId }
export const defaultRoutingSettings: TranslationRoutingSettings = {
  gameId: 'zelda-totk', contextResetSeconds: 45, contextMaxTurns: 8, entityLookupEnabled: true, entitySearch: defaultEntitySearchSettings,
}

/**
 * TranslateGemma can occasionally copy a mandatory Japanese term even when the
 * prompt tells it not to.  A glossary match is an exact mapping, so enforce it
 * on the candidate before quality validation.  Only terms present in the
 * current source are eligible; context-only glossary entries must not rewrite
 * unrelated output.
 */
export function enforceMatchedGlossary(source: string, candidate: string, glossary: ReadonlyArray<{ source: string; target: string }>) {
  return glossary
    .filter((entry) => entry.source && entry.target && source.includes(entry.source) && candidate.includes(entry.source))
    .sort((a, b) => b.source.length - a.source.length)
    .reduce((text, entry) => text.replaceAll(entry.source, entry.target), candidate)
}

export class TranslationRouter {
  private history: ConversationTurn[] = []
  private lastLongTextAt = 0
  private readonly runtimes: Record<TranslationEngineId, TranslationRuntime>
  private readonly memory: TranslationMemory
  private readonly entityLearner?: EntityLearningQueue
  private readonly dictionaries: DictionaryPackRepository
  private activeGameId: TranslationRoutingSettings['gameId'] = 'general'

  constructor(runtimes: Record<TranslationEngineId, TranslationRuntime>, memory = new TranslationMemory(), entityLearner?: EntityLearningQueue, dictionaries = new DictionaryPackRepository()) { this.runtimes = runtimes; this.memory = memory; this.entityLearner = entityLearner; this.dictionaries = dictionaries }

  resetContext() {
    this.history = []; this.lastLongTextAt = 0
  }
  getContextState() { return { turns: this.history.length, lastLongTextAt: this.lastLongTextAt } }
  getKnowledgeState() { return this.memory.stats() }

  async translate(requests: RuntimeRequest['requests'], settings: TranslationRoutingSettings, now = Date.now()): Promise<RoutedTranslation[]> {
    if (settings.gameId !== this.activeGameId) {
      this.resetContext()
      this.activeGameId = settings.gameId
    }
    const output: Array<RoutedTranslation | undefined> = new Array(requests.length)
    const unresolved: Array<{ index: number; request: RuntimeRequest['requests'][number] }> = []
    const hasContextualInput = requests.some((request) => !isLikelyStandaloneLabel(request.text))
    if (hasContextualInput && this.lastLongTextAt && now - this.lastLongTextAt > settings.contextResetSeconds * 1000) this.resetContext()
    requests.forEach((request, index) => {
      const dictionaryEntry = this.dictionaries.match(settings.gameId, request.text)
      const learnedEntry = dictionaryEntry ? undefined : this.memory.matchLearnedEntity(settings.gameId, request.text)
      const glossaryEntry = dictionaryEntry ?? learnedEntry
      if (glossaryEntry && validateTranslation(request.text, glossaryEntry.target, request.targetLanguage).valid) {
        const matched = dictionaryEntry
          ? this.dictionaries.matchedTerms(settings.gameId, request.text).map((entry) => `[${entry.scope}] ${entry.source} → ${entry.target}`)
          : [`[本地学习] ${glossaryEntry.source} → ${glossaryEntry.target}`]
        writeDiagnosticLog('词库', '直接命中', matched.join('；'), 'success', 1_000)
        output[index] = { text: glossaryEntry.target, engine: 'translategemma' }; return
      }
      unresolved.push({ index, request })
    })

    if (settings.entityLookupEnabled && unresolved.length) {
      const profile = getGameProfile(settings.gameId)
      const candidates = unresolved.flatMap(({ request }) => extractKatakanaCandidates(request.text)
        .flatMap((term) => this.dictionaries.unresolvedKatakanaParts(settings.gameId, term))
        .filter((term) => !this.memory.matchLearnedEntity(settings.gameId, term))
        .map((source) => ({ source, queryText: request.text })))
      if (candidates.length) writeDiagnosticLog('搜索', '发现待查询片假名', [...new Set(candidates.map(({ source }) => source))].join('、'), 'info', 1_000)
      await this.entityLearner?.resolve(candidates, settings.gameId, profile.searchNames, 13_000, settings.entitySearch)
    }

    const pending: typeof unresolved = []
    unresolved.forEach(({ index, request }) => {
      const remembered = this.memory.lookup(settings.gameId, request.sourceLanguage, request.targetLanguage, request.text)
      if (remembered && validateTranslation(request.text, remembered, request.targetLanguage).valid) output[index] = { text: remembered, engine: 'translategemma' }
      else pending.push({ index, request })
    })

    if (pending.length) {
      const history = [...this.history]
      const glossaryTexts = [...pending.map(({ request }) => request.text), ...history.flatMap((turn) => turn.sources)]
      const staticTerms = this.dictionaries.findTermsWithScope(settings.gameId, glossaryTexts)
      const learnedTerms = this.memory.findLearnedTerms(settings.gameId, glossaryTexts)
      const glossary = [...staticTerms]
      const knownSources = new Set(staticTerms.map(({ source }) => source.normalize('NFKC').replace(/\s+/gu, '')))
      for (const entry of learnedTerms) {
        const key = entry.source.normalize('NFKC').replace(/\s+/gu, '')
        if (!knownSources.has(key)) { glossary.push({ ...entry, scope: '本地学习' }); knownSources.add(key) }
      }
      const research = this.memory.findResearch(settings.gameId, glossaryTexts)
      if (glossary.length) writeDiagnosticLog('词库', '术语提示交给 LLM', glossary.map(({ source, target, scope }) => `[${scope}] ${source} → ${target}`).join('；'), 'success', 1_000)
      const translations = await this.runtimes.translategemma.translateMany({ requests: pending.map(({ request }) => request), history, glossary, research })
      pending.forEach(({ request }, position) => {
        translations[position] = enforceMatchedGlossary(request.text, translations[position] ?? '', glossary)
      })
      const invalid = pending.flatMap(({ request }, position) => {
        const validation = validateTranslation(request.text, translations[position] ?? '', request.targetLanguage)
        return validation.valid ? [] : [{ position, request, reason: validation.reason }]
      })
      if (invalid.length) {
        const repaired = await this.runtimes.translategemma.translateMany({
          requests: invalid.map(({ request }) => request),
          history,
          glossary,
          research,
          correction: `The rejected output contained untranslated Japanese or was empty (${[...new Set(invalid.map(({ reason }) => reason))].join('; ')}). Translate every component, including unknown katakana proper nouns.`,
        })
        invalid.forEach(({ position, request }, repairPosition) => {
          const candidate = enforceMatchedGlossary(request.text, repaired[repairPosition] ?? '', glossary)
          // An invalid retry is a failed translation, not a translation equal
          // to the source. Returning an empty result lets the frame pipeline
          // keep the original pixels and retry later without locking the track.
          translations[position] = validateTranslation(request.text, candidate, request.targetLanguage).valid ? candidate : ''
        })
      }
      pending.forEach(({ index, request }, position) => {
        const result = { text: translations[position] ?? '', engine: 'translategemma' as const }
        output[index] = result
        if (validateTranslation(request.text, result.text, request.targetLanguage).valid) {
          this.memory.rememberTranslation(settings.gameId, request.sourceLanguage, request.targetLanguage, request.text, result.text)
        }
      })
      const dialogueItems = pending.filter(({ request }) => !isLikelyStandaloneLabel(request.text))
      if (dialogueItems.length) {
        this.history.push({ sources: dialogueItems.map(({ request }) => request.text), translations: dialogueItems.map(({ index }) => output[index]?.text ?? '') })
        this.history = this.history.slice(-settings.contextMaxTurns)
      }
    }
    if (hasContextualInput) this.lastLongTextAt = now
    return output.map((item) => item ?? { text: '', engine: 'translategemma' })
  }
}
