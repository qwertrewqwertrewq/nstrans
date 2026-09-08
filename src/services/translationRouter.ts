import type { TranslationEngineId, TranslationRoutingSettings } from '../types'
import { isLikelyStandaloneLabel } from './translateGemmaPrompt'
import { EntityLearningQueue, extractKatakanaCandidates } from './entityLookup'
import { TranslationMemory } from './translationMemory'
import { DictionaryPackRepository } from './dictionaryPacks'
import type { ConversationTurn, RuntimeRequest, TranslationRuntime } from './translationRuntime'
import { validateTranslation } from './translationQuality'
import { getGameProfile } from '../gameAdapters/registry'
import { defaultEntitySearchSettings, remoteModelCredentials, type EntitySearchEngineId } from './entitySearchSettings'
import { writeDiagnosticLog } from './diagnosticLog'
import { qwenVisionFallback } from './qwenFlash'

export type RoutedTranslation = { text: string; engine: TranslationEngineId }
export type TerminologySource = 'remote' | 'search' | 'ocr-fallback'
export type TerminologyItem = {
  id: string
  sentenceId: string
  sentence: string
  source: string
  target: string
  tag: TerminologySource
  category?: string
  manuallyEdited?: boolean
}
export const defaultRoutingSettings: TranslationRoutingSettings = {
  gameId: 'zelda-totk',
  translationStrategy: 'knowledge-assisted',
  coreTranslationEngine: 'local',
  contextResetSeconds: 45,
  contextMaxTurns: 8,
  entityLookupEnabled: true,
  entitySearch: defaultEntitySearchSettings,
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
  private readonly visionInFlight = new Set<string>()
  private readonly directVisionCache = new Map<string, { translation: string; expiresAt: number }>()
  private readonly runtimes: Partial<Record<TranslationEngineId, TranslationRuntime>>
  private readonly memory: TranslationMemory
  private readonly entityLearner?: EntityLearningQueue
  private readonly dictionaries: DictionaryPackRepository
  private activeGameId: TranslationRoutingSettings['gameId'] = 'general'

  constructor(runtimes: Partial<Record<TranslationEngineId, TranslationRuntime>>, memory = new TranslationMemory(), entityLearner?: EntityLearningQueue, dictionaries = new DictionaryPackRepository()) {
    this.runtimes = runtimes
    this.memory = memory
    this.entityLearner = entityLearner
    this.dictionaries = dictionaries
  }

  resetContext() {
    this.history = []
    this.lastLongTextAt = 0
    this.directVisionCache.clear()
  }
  getContextState() {
    return { turns: this.history.length, lastLongTextAt: this.lastLongTextAt }
  }
  getKnowledgeState() {
    return this.memory.stats()
  }

  getTerminology(sentences: readonly { id: string; text: string }[], gameId: string): TerminologyItem[] {
    return sentences.flatMap((sentence) => {
      const local = this.memory.entitiesForText(gameId, sentence.text)
      const remoteEntries = this.dictionaries.matchedTerms(gameId, sentence.text)
      const remotePairs = new Set(remoteEntries.map((entry) => `${entry.source.normalize('NFKC').replace(/\s+/gu, '')}\u0000${entry.target.normalize('NFKC').replace(/\s+/gu, '')}`))
      const remote = remoteEntries
        .filter((entry) => !this.memory.matchManualEntity(gameId, entry.source))
        .map((entry) => ({
          id: `${sentence.id}\u0000remote\u0000${entry.source}`,
          sentenceId: sentence.id,
          sentence: sentence.text,
          source: entry.source,
          target: entry.target,
          tag: 'remote' as const,
          category: entry.category,
        }))
      const learned = local
        .filter((entry) => entry.manuallyEdited || !remotePairs.has(`${entry.source.normalize('NFKC').replace(/\s+/gu, '')}\u0000${(entry.target ?? '').normalize('NFKC').replace(/\s+/gu, '')}`))
        .map((entry) => ({
          id: `${sentence.id}\u0000${entry.origin ?? 'search'}\u0000${entry.source}`,
          sentenceId: sentence.id,
          sentence: sentence.text,
          source: entry.source,
          target: entry.target ?? '',
          tag: entry.origin === 'ocr-fallback' ? ('ocr-fallback' as const) : entry.origin === 'remote' ? ('remote' as const) : ('search' as const),
          category: entry.status,
          manuallyEdited: entry.manuallyEdited,
        }))
      return [...remote, ...learned]
    })
  }

  editTerminology(item: TerminologyItem, source: string, target: string, gameId = this.activeGameId) {
    this.memory.editEntity(gameId, item.source, source, target, item.tag)
  }

  async researchTerminology(sources: readonly string[], settings: TranslationRoutingSettings, engine: EntitySearchEngineId) {
    const profile = getGameProfile(settings.gameId)
    await this.entityLearner?.resolve(sources, settings.gameId, profile.searchNames, 0, { ...settings.entitySearch, primary: engine, fallback: 'none' }, true)
    return sources.flatMap((source) => {
      const entry = this.memory.entity(settings.gameId, source)
      return entry?.status === 'learned' && entry.target
        ? [
            {
              source: entry.canonicalSource ?? entry.source,
              target: entry.target,
            },
          ]
        : []
    })
  }

  async inspectTerminologyWithVision(
    items: readonly {
      text: string
      candidates: string[]
      imageDataUrl: string
    }[],
    settings: TranslationRoutingSettings,
  ) {
    const remote = remoteModelCredentials(settings.entitySearch, 'vision')
    if (!remote?.apiKey) throw new Error('请先配置可用的多模态模型和 API Key')
    const profile = getGameProfile(settings.gameId)
    const learned: Array<{ source: string; target: string }> = []
    for (const item of items.slice(0, 8)) {
      const result = await qwenVisionFallback({
        observedText: item.text,
        candidates: item.candidates,
        imageDataUrl: item.imageDataUrl,
        gameId: settings.gameId,
        gameNames: profile.searchNames,
        ...remote,
      })
      for (const entry of result?.entries ?? []) {
        this.memory.rememberEntity(
          {
            gameId: settings.gameId,
            source: entry.observed,
            canonicalSource: entry.canonical,
            target: entry.target,
            status: 'learned',
            origin: 'ocr-fallback',
            updatedAt: Date.now(),
          },
          false,
        )
        if (entry.canonical !== entry.observed)
          this.memory.rememberEntity(
            {
              gameId: settings.gameId,
              source: entry.canonical,
              canonicalSource: entry.canonical,
              target: entry.target,
              status: 'learned',
              origin: 'ocr-fallback',
              updatedAt: Date.now(),
            },
            false,
          )
        learned.push({ source: entry.canonical, target: entry.target })
      }
    }
    return learned
  }

  async translate(requests: RuntimeRequest['requests'], settings: TranslationRoutingSettings, now = Date.now()): Promise<RoutedTranslation[]> {
    if (settings.gameId !== this.activeGameId) {
      this.resetContext()
      this.activeGameId = settings.gameId
    }
    const output: Array<RoutedTranslation | undefined> = new Array(requests.length)
    const unresolved: Array<{
      index: number
      request: RuntimeRequest['requests'][number]
    }> = []
    const hasContextualInput = requests.some((request) => !isLikelyStandaloneLabel(request.text))
    if (hasContextualInput && this.lastLongTextAt && now - this.lastLongTextAt > settings.contextResetSeconds * 1000) this.resetContext()
    const useKnowledge = settings.translationStrategy !== 'direct'
    const runtimeId: TranslationEngineId = settings.coreTranslationEngine === 'remote' ? 'remote-llm' : 'translategemma'
    requests.forEach((request, index) => {
      if (!useKnowledge) {
        const cached = this.directVisionCache.get(request.text.normalize('NFKC').replace(/\s+/gu, ''))
        if (cached && cached.expiresAt > now) { output[index] = { text: cached.translation, engine: 'remote-llm' }; return }
        unresolved.push({ index, request })
        return
      }
      const manualTerms = this.memory.findManualTerms(settings.gameId, [request.text])
      const manualEntry = this.memory.matchManualEntity(settings.gameId, request.text)
      const dictionaryEntry = manualEntry ? undefined : this.dictionaries.match(settings.gameId, request.text, manualTerms)
      const learnedEntry = dictionaryEntry ? undefined : this.memory.matchLearnedEntity(settings.gameId, request.text)
      const glossaryEntry = manualEntry ?? dictionaryEntry ?? learnedEntry
      if (glossaryEntry && validateTranslation(request.text, glossaryEntry.target, request.targetLanguage).valid) {
        const matched = dictionaryEntry ? this.dictionaries.matchedTerms(settings.gameId, request.text).map((entry) => `[${entry.scope}] ${entry.source} → ${entry.target}`) : [`[本地学习] ${glossaryEntry.source} → ${glossaryEntry.target}`]
        writeDiagnosticLog('词库', '直接命中', matched.join('；'), 'success', 1_000)
        output[index] = {
          text: glossaryEntry.target,
          engine: 'translategemma',
        }
        return
      }
      unresolved.push({ index, request })
    })

    if (useKnowledge && settings.entityLookupEnabled && unresolved.length) {
      const profile = getGameProfile(settings.gameId)
      const candidates = unresolved.flatMap(({ request }) =>
        extractKatakanaCandidates(request.text)
          .flatMap((term) => this.dictionaries.unresolvedKatakanaParts(settings.gameId, term))
          .filter((term) => !this.memory.matchLearnedEntity(settings.gameId, term)),
      )
      if (candidates.length) writeDiagnosticLog('搜索', '发现待查询片假名', [...new Set(candidates)].join('、'), 'info', 1_000)
      // Terminology research must never hold the frame translation queue. A
      // result learned in the background is applied on the next OCR pass.
      // Candidates already confirmed empty are reserved for visual fallback
      // instead of immediately repeating the same web search.
      const searchCandidates = candidates.filter((term) => !this.memory.entityLookupWasEmpty(settings.gameId, term))
      void this.entityLearner?.resolve(searchCandidates, settings.gameId, profile.searchNames, 13_000, settings.entitySearch)

      const visionRemote = remoteModelCredentials(settings.entitySearch, 'vision')
      if (settings.entitySearch.visionFallbackEnabled && visionRemote?.apiKey) {
        // The image is sent only after every extracted term has completed the
        // configured lookup chain with no learned term and no search evidence.
        for (const { request } of unresolved) {
          if (this.visionInFlight.size >= 2) break
          if (!request.imageDataUrl) continue
          const katakanaCandidates = extractKatakanaCandidates(request.text)
            .flatMap((term) => this.dictionaries.unresolvedKatakanaParts(settings.gameId, term))
            .filter((term) => !this.memory.matchLearnedEntity(settings.gameId, term))
          const compactText = request.text.normalize('NFKC').replace(/\s+/gu, '')
          // Bad OCR can turn every katakana glyph into CJK-looking noise
          // (for example 世儿夕 instead of ゼルダ), leaving nothing that the
          // katakana search stage can extract. An explicit vision-fallback
          // opt-in therefore also admits short standalone labels.
          const noisyStandalone = !/[\p{Script=Hiragana}\p{Script=Katakana}ー]/u.test(compactText) && /^[\p{Script=Han}々〆ヶ]{2,16}$/u.test(compactText) && isLikelyStandaloneLabel(request.text)
          const requestCandidates = katakanaCandidates.length ? katakanaCandidates : noisyStandalone ? [compactText] : []
          if (!requestCandidates.length || katakanaCandidates.some((term) => !this.memory.entityLookupWasEmpty(settings.gameId, term))) continue
          const visionKey = `${settings.gameId}\u0000${compactText}`
          if (this.visionInFlight.has(visionKey)) continue
          this.visionInFlight.add(visionKey)
          void qwenVisionFallback({
            observedText: request.text,
            candidates: requestCandidates,
            imageDataUrl: request.imageDataUrl,
            gameId: settings.gameId,
            gameNames: profile.searchNames,
            ...visionRemote,
          })
            .then((result) => {
              if (!result || !validateTranslation(request.text, result.translation, request.targetLanguage).valid) return
              for (const entry of result.entries) {
                this.memory.rememberEntity(
                  {
                    gameId: settings.gameId,
                    source: entry.observed,
                    canonicalSource: entry.canonical,
                    target: entry.target,
                    status: 'learned',
                    origin: 'ocr-fallback',
                    updatedAt: Date.now(),
                  },
                  false,
                )
                if (entry.canonical !== entry.observed)
                  this.memory.rememberEntity(
                    {
                      gameId: settings.gameId,
                      source: entry.canonical,
                      canonicalSource: entry.canonical,
                      target: entry.target,
                      status: 'learned',
                      origin: 'ocr-fallback',
                      updatedAt: Date.now(),
                    },
                    false,
                  )
              }
              if (result.entries.length) writeDiagnosticLog('词库', 'Qwen OCR 纠错入库', result.entries.map((entry) => `${entry.observed}${entry.observed === entry.canonical ? '' : ` → ${entry.canonical}`} → ${entry.target}`).join('；'), 'success')
            })
            .catch((reason) => {
              writeDiagnosticLog('LLM', 'Qwen 视觉兜底失败', reason instanceof Error ? reason.message : String(reason), 'error')
            })
            .finally(() => this.visionInFlight.delete(visionKey))
        }
      }
    }

    if (!useKnowledge && settings.entitySearch.visionFallbackEnabled && unresolved.length) {
      const visionRemote = remoteModelCredentials(settings.entitySearch, 'vision')
      const profile = getGameProfile(settings.gameId)
      if (visionRemote?.apiKey) for (const { request } of unresolved) {
        if (this.visionInFlight.size >= 2 || !request.imageDataUrl) break
        const compactText = request.text.normalize('NFKC').replace(/\s+/gu, '')
        const candidates = extractKatakanaCandidates(request.text)
        if (!candidates.length || this.visionInFlight.has(compactText)) continue
        this.visionInFlight.add(compactText)
        void qwenVisionFallback({ observedText: request.text, candidates, imageDataUrl: request.imageDataUrl, gameId: settings.gameId, gameNames: profile.searchNames, ...visionRemote })
          .then((result) => { if (result?.translation && validateTranslation(request.text, result.translation, request.targetLanguage).valid) this.directVisionCache.set(compactText, { translation: result.translation, expiresAt: Date.now() + 30_000 }) })
          .catch((reason) => writeDiagnosticLog('LLM', '直送模式 OCR 视觉兜底失败', reason instanceof Error ? reason.message : String(reason), 'error'))
          .finally(() => this.visionInFlight.delete(compactText))
      }
    }

    const pending: typeof unresolved = []
    unresolved.forEach(({ index, request }) => {
      if (output[index]) return
      const remembered = useKnowledge ? this.memory.lookup(settings.gameId, request.sourceLanguage, request.targetLanguage, request.text) : undefined
      if (remembered && validateTranslation(request.text, remembered, request.targetLanguage).valid) output[index] = { text: remembered, engine: 'translategemma' }
      else pending.push({ index, request })
    })

    if (pending.length) {
      const history = [...this.history]
      const glossaryTexts = [...pending.map(({ request }) => request.text), ...history.flatMap((turn) => turn.sources)]
      const staticTerms = useKnowledge ? this.dictionaries.findTermsWithScope(settings.gameId, glossaryTexts) : []
      const learnedTerms = useKnowledge ? this.memory.findLearnedTerms(settings.gameId, glossaryTexts) : []
      const glossary = [...staticTerms]
      const knownSources = new Set(staticTerms.map(({ source }) => source.normalize('NFKC').replace(/\s+/gu, '')))
      for (const entry of learnedTerms) {
        const key = entry.source.normalize('NFKC').replace(/\s+/gu, '')
        if (!knownSources.has(key)) {
          glossary.push({ ...entry, scope: '本地学习' })
          knownSources.add(key)
        }
      }
      const research = useKnowledge ? this.memory.findResearch(settings.gameId, glossaryTexts) : []
      if (glossary.length) writeDiagnosticLog('词库', '术语提示交给 LLM', glossary.map(({ source, target, scope }) => `[${scope}] ${source} → ${target}`).join('；'), 'success', 1_000)
      const remoteModel = runtimeId === 'remote-llm' ? remoteModelCredentials(settings.entitySearch, 'core') : undefined
      if (runtimeId === 'remote-llm' && !remoteModel?.apiKey) throw new Error('请先在“密钥与远程管理”配置核心远程翻译模型和 API Key')
      const runtime = this.runtimes[runtimeId]
      if (!runtime) throw new Error(`翻译运行时不可用：${runtimeId}`)
      const translations = await runtime.translateMany({
        requests: pending.map(({ request }) => request),
        history,
        glossary,
        research,
        remoteModel,
      })
      pending.forEach(({ request }, position) => {
        translations[position] = enforceMatchedGlossary(request.text, translations[position] ?? '', glossary)
      })
      const invalid = pending.flatMap(({ request }, position) => {
        const validation = validateTranslation(request.text, translations[position] ?? '', request.targetLanguage)
        return validation.valid ? [] : [{ position, request, reason: validation.reason }]
      })
      if (invalid.length) {
        const repaired = await runtime.translateMany({
          requests: invalid.map(({ request }) => request),
          history,
          glossary,
          research,
          correction: `The rejected output contained untranslated Japanese or was empty (${[...new Set(invalid.map(({ reason }) => reason))].join('; ')}). Translate every component, including unknown katakana proper nouns.`,
          remoteModel,
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
        const result = {
          text: translations[position] ?? '',
          engine: runtimeId,
        }
        output[index] = result
        if (useKnowledge && validateTranslation(request.text, result.text, request.targetLanguage).valid) {
          this.memory.rememberTranslation(settings.gameId, request.sourceLanguage, request.targetLanguage, request.text, result.text)
        }
      })
      const dialogueItems = pending.filter(({ request }) => !isLikelyStandaloneLabel(request.text))
      if (dialogueItems.length) {
        this.history.push({
          sources: dialogueItems.map(({ request }) => request.text),
          translations: dialogueItems.map(({ index }) => output[index]?.text ?? ''),
        })
        this.history = this.history.slice(-settings.contextMaxTurns)
      }
    }
    if (hasContextualInput) this.lastLongTextAt = now
    return output.map((item) => item ?? { text: '', engine: runtimeId })
  }
}
