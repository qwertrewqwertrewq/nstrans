import type { GameId } from '../gameAdapters/types'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { normalizeMemoryText, type StoredEntity, type TranslationMemory } from './translationMemory'
import type { TerminologyResearch } from './translationRuntime'
import { DEFAULT_TRADITIONAL_SEARCH_TEMPLATE, defaultEntitySearchSettings, remoteModelCredentials, renderSearchTemplate, resolveSearchKeywords, searchEngineKey, type EntitySearchEngineId, type EntitySearchSettings } from './entitySearchSettings'
import { writeDiagnosticLog } from './diagnosticLog'
import { qwenSearchTerm } from './qwenFlash'

export type EntityLookupResult = Omit<StoredEntity, 'gameId' | 'updatedAt'>
export type EntityLookupContext = {
  gameNames?: readonly string[]
  searchSettings?: EntitySearchSettings
}
export type EntityLookupCandidate = { source: string }
export interface EntityLookupProvider {
  lookup(source: string, context?: EntityLookupContext): Promise<EntityLookupResult>
}
export type EntitySearchHit = { title: string; url: string; snippet: string }
export interface EntityWebSearchTransport {
  search(engine: Exclude<EntitySearchEngineId, 'wiki'>, query: string, apiKey: string): Promise<EntitySearchHit[]>
}

type SearchPage = {
  title?: string
  langlinks?: Array<{ title?: string; '*'?: string }>
}
type SearchResponse = { query?: { pages?: Record<string, SearchPage> } }
type TitleResponse = { query?: { pages?: Record<string, { title?: string }> } }
type WikidataResponse = {
  search?: Array<{
    label?: string
    match?: { text?: string }
    display?: { label?: { value?: string } }
    concepturi?: string
  }>
}
type WikiSearchResponse = {
  query?: { search?: Array<{ title?: string; snippet?: string }> }
}

/** Public Wikimedia APIs need no key. Only exact Japanese-title matches are auto-learned. */
export class WikimediaEntityLookup implements EntityLookupProvider {
  private readonly request: typeof fetch
  constructor(request: typeof fetch = fetch) {
    this.request = request.bind(globalThis)
  }

  async lookup(source: string, context: EntityLookupContext = {}): Promise<EntityLookupResult> {
    const url = new URL('https://ja.wikipedia.org/w/api.php')
    url.search = new URLSearchParams({
      action: 'query',
      format: 'json',
      origin: '*',
      generator: 'search',
      gsrsearch: source,
      gsrnamespace: '0',
      gsrlimit: '5',
      prop: 'langlinks',
      lllang: 'zh',
      lllimit: 'max',
    }).toString()
    const response = await this.request(url, {
      headers: {
        'Api-User-Agent': 'NSTrans/0.1.0 (game translation terminology lookup)',
      },
    })
    if (!response.ok) throw new Error(`Wikipedia entity lookup failed: ${response.status}`)
    const pages = Object.values(((await response.json()) as SearchResponse).query?.pages ?? {})
    const exact = pages.find((page) => normalizeMemoryText(page.title ?? '') === normalizeMemoryText(source))
    const candidate = exact ?? pages[0]
    const linkedTitle = candidate?.langlinks?.[0]?.title ?? candidate?.langlinks?.[0]?.['*']
    if (!exact || !linkedTitle) {
      const wikidata = await this.lookupWikidata(source, candidate)
      if (wikidata.status === 'learned') return wikidata
      return await this.contextualSearch(source, context.gameNames ?? [], wikidata, context.searchSettings?.traditionalSearchTemplate)
    }

    const chineseTitle = await this.toSimplifiedChineseTitle(linkedTitle)
    return {
      source,
      target: chineseTitle,
      status: 'learned',
      sourceUrl: `https://ja.wikipedia.org/wiki/${encodeURIComponent(exact.title!.replace(/ /gu, '_'))}`,
    }
  }

  private async toSimplifiedChineseTitle(title: string) {
    const url = new URL('https://zh.wikipedia.org/w/api.php')
    url.search = new URLSearchParams({
      action: 'query',
      format: 'json',
      origin: '*',
      titles: title,
      redirects: '1',
      converttitles: '1',
      variant: 'zh-cn',
    }).toString()
    const response = await this.request(url, {
      headers: {
        'Api-User-Agent': 'NSTrans/0.1.0 (game translation terminology lookup)',
      },
    })
    if (!response.ok) return title
    const page = Object.values(((await response.json()) as TitleResponse).query?.pages ?? {})[0]
    return page?.title ?? title
  }

  private async lookupWikidata(source: string, wikipediaCandidate?: SearchPage): Promise<EntityLookupResult> {
    const url = new URL('https://www.wikidata.org/w/api.php')
    url.search = new URLSearchParams({
      action: 'wbsearchentities',
      format: 'json',
      origin: '*',
      search: source,
      language: 'ja',
      uselang: 'zh-cn',
      type: 'item',
      limit: '5',
    }).toString()
    const response = await this.request(url, {
      headers: {
        'Api-User-Agent': 'NSTrans/0.1.0 (game translation terminology lookup)',
      },
    })
    if (!response.ok) return { source, status: wikipediaCandidate ? 'pending' : 'missing' }
    const matches = ((await response.json()) as WikidataResponse).search ?? []
    const exact = matches.find((item) => normalizeMemoryText(item.match?.text ?? item.label ?? '') === normalizeMemoryText(source))
    const target = exact?.display?.label?.value
    if (exact && target && normalizeMemoryText(target) !== normalizeMemoryText(source))
      return {
        source,
        target,
        status: 'learned',
        sourceUrl: exact.concepturi?.replace(/^http:/u, 'https:'),
      }
    return {
      source,
      status: wikipediaCandidate || matches.length ? 'pending' : 'missing',
      sourceUrl: wikipediaCandidate?.title ? `https://ja.wikipedia.org/wiki/${encodeURIComponent(wikipediaCandidate.title.replace(/ /gu, '_'))}` : undefined,
    }
  }

  private async contextualSearch(source: string, gameNames: readonly string[], fallback: EntityLookupResult, queryTemplate = DEFAULT_TRADITIONAL_SEARCH_TEMPLATE): Promise<EntityLookupResult> {
    if (!gameNames.length) return fallback
    const localizedNames = [gameNames.find((name) => /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(name)) ?? gameNames[0], gameNames.find((name) => /\p{Script=Han}/u.test(name) && !/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(name)) ?? gameNames.at(-1)!]
    const searches = await Promise.all(
      ['ja', 'zh'].map(async (language, index) => {
        const query = buildEntitySearchQuery(source, [localizedNames[index]], queryTemplate)
        const url = new URL(`https://${language}.wikipedia.org/w/api.php`)
        url.search = new URLSearchParams({
          action: 'query',
          format: 'json',
          origin: '*',
          list: 'search',
          srsearch: query,
          srlimit: '3',
          srprop: 'snippet',
        }).toString()
        try {
          const response = await this.request(url, {
            headers: {
              'Api-User-Agent': 'NSTrans/0.1.0 (game translation terminology research)',
            },
          })
          if (!response.ok) return { query, evidence: [], sourceUrls: [] }
          const results = ((await response.json()) as WikiSearchResponse).query?.search ?? []
          return {
            query,
            evidence: results.map((item) => `${item.title ?? ''}: ${stripMarkup(item.snippet ?? '')}`.trim()).filter(Boolean),
            sourceUrls: results.map((item) => `https://${language}.wikipedia.org/wiki/${encodeURIComponent((item.title ?? '').replace(/ /gu, '_'))}`).filter((url) => !url.endsWith('/wiki/')),
          }
        } catch {
          return { query, evidence: [], sourceUrls: [] }
        }
      }),
    )
    const research: TerminologyResearch = {
      term: source,
      query: searches.map((item) => item.query).join(' / '),
      evidence: searches.flatMap((item) => item.evidence).slice(0, 6),
      sourceUrls: searches.flatMap((item) => item.sourceUrls).slice(0, 6),
    }
    return {
      ...fallback,
      source,
      research,
      sourceUrl: research.sourceUrls[0] ?? fallback.sourceUrl,
    }
  }
}

export class HttpEntityWebSearchTransport implements EntityWebSearchTransport {
  private readonly endpoint: string
  private readonly request: typeof fetch
  constructor(endpoint = '/api/entity-search', request: typeof fetch = fetch) {
    this.endpoint = endpoint
    this.request = request.bind(globalThis)
  }
  async search(engine: Exclude<EntitySearchEngineId, 'wiki'>, query: string, apiKey: string) {
    if (isTauri())
      return await invoke<EntitySearchHit[]>('entity_web_search', {
        engine,
        query,
        apiKey,
      })
    const response = await this.request(this.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ engine, query, apiKey }),
    })
    const body = (await response.json()) as {
      hits?: EntitySearchHit[]
      error?: string
    }
    if (!response.ok) throw new Error(body.error || `${engine} 搜索不可用`)
    return body.hits ?? []
  }
}

/** Selects generic search engines by user preference; no game-specific source is embedded here. */
export class ConfigurableEntityLookup implements EntityLookupProvider {
  private readonly wiki: EntityLookupProvider
  private readonly web: EntityWebSearchTransport
  constructor(wiki: EntityLookupProvider = new WikimediaEntityLookup(), web: EntityWebSearchTransport = new HttpEntityWebSearchTransport()) {
    this.wiki = wiki
    this.web = web
  }

  async lookup(source: string, context: EntityLookupContext = {}): Promise<EntityLookupResult> {
    const settings = context.searchSettings ?? defaultEntitySearchSettings
    const gameNames = resolveSearchKeywords(settings, context.gameNames ?? [])
    const resolvedContext = { ...context, gameNames, searchSettings: settings }
    const engines = [...new Set([settings.primary, settings.fallback])].filter((engine): engine is EntitySearchEngineId => engine !== 'none')
    let last: EntityLookupResult = { source, status: 'missing' }
    for (const engine of engines) {
      const startedAt = performance.now()
      const query = buildEntitySearchQuery(source, gameNames, settings.traditionalSearchTemplate)
      writeDiagnosticLog('搜索', '发起查询', `${source} · ${searchEngineLabel(engine)} · ${query}`, 'info')
      let result: EntityLookupResult
      try {
        result = engine === 'wiki' ? await this.wiki.lookup(source, resolvedContext) : await this.lookupWeb(engine, source, gameNames, searchEngineKey(settings, engine), settings)
        console.info('[entity-search]', {
          engine,
          source,
          durationMs: Math.round(performance.now() - startedAt),
          evidenceCount: result.research?.evidence.length ?? 0,
          status: result.status,
        })
        const duration = Math.round(performance.now() - startedAt),
          evidence = result.research?.evidence.length ?? 0
        writeDiagnosticLog('搜索', result.status === 'learned' ? '查询并学习成功' : evidence ? '查询获得候选' : '查询无结果', `${source} · ${duration} ms${evidence ? ` · ${evidence} 条依据` : ''}`, result.status === 'learned' || evidence ? 'success' : 'warning')
      } catch (error) {
        console.warn('[entity-search]', {
          engine,
          source,
          durationMs: Math.round(performance.now() - startedAt),
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        })
        writeDiagnosticLog('搜索', '查询失败', `${source} · ${error instanceof Error ? error.message : String(error)}`, 'error')
        result = { source, status: 'missing' }
      }
      last = result
      if (result.status === 'learned' || result.research?.evidence.length) return result
    }
    return last
  }

  private async lookupWeb(engine: Exclude<EntitySearchEngineId, 'wiki'>, source: string, gameNames: readonly string[], apiKey: string, settings: EntitySearchSettings): Promise<EntityLookupResult> {
    if (!apiKey) return { source, status: 'missing' }
    const query = buildEntitySearchQuery(source, gameNames, settings.traditionalSearchTemplate)
    if (engine === 'qwen') {
      const remote = remoteModelCredentials(settings, 'search')
      if (!remote) return { source, status: 'missing' }
      const result = await qwenSearchTerm(source, gameNames, remote, settings.llmSearchPromptTemplate)
      if (!result) return { source, status: 'missing' }
      return {
        source,
        canonicalSource: result.canonicalSource,
        target: result.target,
        status: 'learned',
        research: {
          term: source,
          query,
          evidence: result.evidence,
          sourceUrls: [],
        },
      }
    }
    const hits = await this.web.search(engine, query, apiKey)
    if (!hits.length) return { source, status: 'missing' }
    return {
      source,
      status: 'pending',
      sourceUrl: hits[0].url,
      research: {
        term: source,
        query,
        evidence: hits.map(({ title, snippet }) => `${title}: ${snippet}`.trim()).slice(0, 6),
        sourceUrls: hits.map(({ url }) => url).slice(0, 6),
      },
    }
  }
}

function searchEngineLabel(engine: EntitySearchEngineId) {
  return (
    {
      wiki: 'Wikipedia / Wikidata',
      brave: 'Brave Search',
      qianfan: '百度千帆',
      qwen: '千问远程模型',
    } as const
  )[engine]
}

export function buildEntitySearchQuery(source: string, gameNames: readonly string[], template = DEFAULT_TRADITIONAL_SEARCH_TEMPLATE) {
  return renderSearchTemplate(template.trim() || DEFAULT_TRADITIONAL_SEARCH_TEMPLATE, source, gameNames)
}

const stripMarkup = (text: string) =>
  text
    .replace(/<[^>]*>/gu, '')
    .replace(/&quot;/gu, '"')
    .replace(/&#0?39;/gu, "'")
    .replace(/&amp;/gu, '&')
    .replace(/\s+/gu, ' ')
    .trim()

export function extractKatakanaCandidates(source: string) {
  const candidates = new Set<string>()
  for (const match of source.matchAll(/[\p{Script=Katakana}ー][\p{Script=Katakana}ー・]{1,23}/gu)) candidates.add(match[0].replace(/^・|・$/gu, ''))
  return [...candidates].filter((term) => term.length >= 2)
}
export const extractEntityCandidates = extractKatakanaCandidates

export class EntityLearningQueue {
  private readonly inFlight = new Map<string, Promise<void>>()
  private readonly memory: TranslationMemory
  private readonly provider: EntityLookupProvider

  constructor(memory: TranslationMemory, provider: EntityLookupProvider) {
    this.memory = memory
    this.provider = provider
  }

  schedule(sources: readonly string[], gameId: GameId) {
    void this.resolve(sources.flatMap(extractKatakanaCandidates), gameId, [], 0)
  }

  async resolve(candidates: readonly (string | EntityLookupCandidate)[], gameId: GameId, gameNames: readonly string[] = [], timeoutMs = 3500, searchSettings: EntitySearchSettings = defaultEntitySearchSettings, force = false) {
    const unique = [
      ...new Map(
        candidates.map((candidate) => {
          const normalized = typeof candidate === 'string' ? { source: candidate } : candidate
          return [normalizeMemoryText(normalized.source), normalized]
        }),
      ).values(),
    ].slice(0, 4)
    const work = unique.map((candidate) => this.learn(candidate.source, gameId, gameNames, searchSettings, force))
    if (!work.length) return
    const settled = Promise.allSettled(work).then(() => undefined)
    if (timeoutMs <= 0) {
      await settled
      return
    }
    await Promise.race([settled, new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))])
  }

  private learn(source: string, gameId: GameId, gameNames: readonly string[], searchSettings: EntitySearchSettings, force = false) {
    const key = `${gameId}\u0000${normalizeMemoryText(source)}`
    if (!force && !this.memory.needsEntityLookup(gameId, source)) return Promise.resolve()
    const existing = this.inFlight.get(key)
    if (existing) return existing
    const task = this.provider
      .lookup(source, { gameNames, searchSettings })
      .then((result) => {
        const entry = {
          ...result,
          gameId,
          origin: 'search' as const,
          updatedAt: Date.now(),
        }
        this.memory.rememberEntity(entry, Boolean(result.sourceUrl))
        if (result.status === 'learned' && result.target && result.canonicalSource && normalizeMemoryText(result.canonicalSource) !== normalizeMemoryText(source)) {
          this.memory.rememberEntity(
            {
              ...entry,
              source: result.canonicalSource,
              canonicalSource: result.canonicalSource,
            },
            false,
          )
        }
      })
      .catch(() => undefined)
      .finally(() => this.inFlight.delete(key))
    this.inFlight.set(key, task)
    return task
  }
}
