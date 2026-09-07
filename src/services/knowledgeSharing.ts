import type { GameId } from '../gameAdapters/types'
import { isLikelyStandaloneLabel } from './translateGemmaPrompt'

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>
export type KnowledgeContribution = {
  id: string
  gameId: GameId
  kind: 'translation' | 'term'
  source: string
  target: string
  provenance: 'translategemma' | 'wikimedia'
  sourceUrl?: string
  createdAt: number
}
export interface ContributionUploader { upload(items: readonly KnowledgeContribution[]): Promise<{ acceptedIds: string[] }> }

const normalizedLength = (value: string) => [...value.normalize('NFKC').replace(/\s+/gu, '')].length
const unsafeStructure = /[\n\r]|\p{P}/u
const katakanaTerm = /[\p{Script=Katakana}ー][\p{Script=Katakana}ー・]{1,23}/u
const commonUiLabels = new Set(['はい', 'いいえ', 'もどる', '戻る', 'つづける', 'はじめから'])
const isTrustedWikiUrl = (value?: string) => { try { return ['ja.wikipedia.org', 'www.wikidata.org'].includes(new URL(value ?? '').hostname) } catch { return false } }

/** Conservative allowlist: reusable terms and compact UI labels only, never dialogue or descriptions. */
export function isShareableContribution(input: Pick<KnowledgeContribution, 'kind' | 'source' | 'target' | 'provenance' | 'sourceUrl'>) {
  const source = input.source.trim(), target = input.target.trim(), sourceLength = normalizedLength(source), targetLength = normalizedLength(target)
  if (!source || !target || sourceLength > 32 || targetLength > 64 || unsafeStructure.test(source) || unsafeStructure.test(target)) return false
  if (input.kind === 'term' && input.provenance === 'wikimedia') return isTrustedWikiUrl(input.sourceUrl) && (isLikelyStandaloneLabel(source) || katakanaTerm.test(source))
  if (sourceLength > 16 || !isLikelyStandaloneLabel(source)) return false
  return commonUiLabels.has(source) || !/\p{Script=Hiragana}/u.test(source)
}

export class HttpContributionUploader implements ContributionUploader {
  private readonly baseUrl: string
  private readonly apiKey: string
  constructor(baseUrl: string, apiKey: string) { this.baseUrl = baseUrl.replace(/\/$/u, ''); this.apiKey = apiKey }
  async upload(items: readonly KnowledgeContribution[]) {
    const response = await fetch(`${this.baseUrl}/api/v1/contributions`, { method: 'POST', headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ items }) })
    const body = await response.json() as { accepted?: Array<{ index: number }>; error?: string }
    if (!response.ok && response.status !== 207) throw new Error(body.error || `社区上传失败 (${response.status})`)
    return { acceptedIds: (body.accepted ?? []).map(({ index }) => items[index]?.id).filter((id): id is string => Boolean(id)) }
  }
}

const SETTINGS_KEY = 'yomilens.knowledge-sharing.enabled.v1'
const QUEUE_KEY = 'yomilens.knowledge-sharing.queue.v1'

/** Consent-gated local outbox. It performs no network request until a server uploader is supplied. */
export class CommunityContributionQueue {
  private enabled: boolean
  private items: KnowledgeContribution[]
  private sequence = 0
  private inFlight: Promise<number> | null = null
  private readonly storage?: StorageLike

  constructor(storage?: StorageLike) {
    this.storage = storage
    this.enabled = storage?.getItem(SETTINGS_KEY) === 'true'
    try {
      const stored = JSON.parse(storage?.getItem(QUEUE_KEY) ?? '[]') as KnowledgeContribution[]
      this.items = Array.isArray(stored) ? stored.filter(isShareableContribution) : []
      if (this.items.length !== stored.length) this.persist()
    } catch { this.items = [] }
  }

  isEnabled() { return this.enabled }
  setEnabled(enabled: boolean) { this.enabled = enabled; try { this.storage?.setItem(SETTINGS_KEY, String(enabled)) } catch { /* Ignore storage failure. */ } }
  pendingCount() { return this.items.length }

  enqueue(input: Omit<KnowledgeContribution, 'id' | 'createdAt'>) {
    if (!this.enabled || !isShareableContribution(input)) return
    if (this.items.some((item) => item.gameId === input.gameId && item.kind === input.kind && item.source === input.source && item.target === input.target)) return
    const createdAt = Date.now()
    this.items.push({ ...input, id: `${createdAt}-${this.sequence++}`, createdAt })
    this.persist()
  }

  async flush(uploader: ContributionUploader) {
    if (this.inFlight) return this.inFlight
    if (!this.enabled || !this.items.length) return 0
    this.inFlight = this.performFlush(uploader)
    try { return await this.inFlight } finally { this.inFlight = null }
  }

  private async performFlush(uploader: ContributionUploader) { const batch = [...this.items], { acceptedIds } = await uploader.upload(batch), accepted = new Set(acceptedIds); this.items = this.items.filter(({ id }) => !accepted.has(id)); this.persist(); return batch.length - this.items.length }

  private persist() { try { this.storage?.setItem(QUEUE_KEY, JSON.stringify(this.items)) } catch { /* Keep the in-memory queue alive. */ } }
}

export function browserContributionQueue() {
  try { return new CommunityContributionQueue(window.localStorage) } catch { return new CommunityContributionQueue() }
}

const API_KEY_STORAGE = 'yomilens.community-api-key.v1'
export function loadCommunityApiKey() { try { return window.localStorage.getItem(API_KEY_STORAGE) ?? '' } catch { return '' } }
export function saveCommunityApiKey(value: string) { try { if (value) window.localStorage.setItem(API_KEY_STORAGE, value); else window.localStorage.removeItem(API_KEY_STORAGE) } catch { /* Native secure storage can replace this browser adapter. */ } }
