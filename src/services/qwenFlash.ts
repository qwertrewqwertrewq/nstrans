import { invoke, isTauri } from '@tauri-apps/api/core'
import type { GameId } from '../gameAdapters/types'
import { DEFAULT_LLM_SEARCH_PROMPT_TEMPLATE, renderSearchTemplate, type RemoteModelCapability } from './entitySearchSettings'
import { containsJapaneseKana } from './translationQuality'
import { writeDiagnosticLog } from './diagnosticLog'

type QwenResponse = { content: string }
export type QwenDictionaryEntry = {
  observed: string
  canonical: string
  target: string
}
export type QwenVisionResult = {
  correctedText: string
  translation: string
  entries: QwenDictionaryEntry[]
}

async function requestQwen(model: string, apiKey: string, prompt: string, imageDataUrl?: string, enableSearch = false, endpoint = '', capability: RemoteModelCapability = 'multimodal-search') {
  if (!apiKey.trim()) throw new Error('Qwen API Key 为空')
  if (capability === 'offline') throw new Error('离线远程模型路由尚未实现')
  if (imageDataUrl && capability !== 'multimodal-search') throw new Error('所选模型不支持视觉输入')
  const request = {
    model,
    apiKey,
    prompt,
    imageDataUrl: imageDataUrl || null,
    enableSearch,
    endpoint: endpoint || null,
    searchOnly: capability === 'search-only',
  }
  if (isTauri()) return (await invoke<QwenResponse>('qwen_flash_request', request)).content
  const response = await fetch('/api/qwen-flash', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  })
  const body = (await response.json()) as QwenResponse & { error?: string }
  if (!response.ok || !body.content) throw new Error(body.error || 'Qwen Flash 没有返回结果')
  return body.content
}

export function buildQwenTranslationPrompt(input: { texts: readonly string[]; history?: readonly { sources: string[]; translations: string[] }[]; glossary?: readonly { source: string; target: string }[]; correction?: string; gameNames?: readonly string[]; translationInstruction?: string }) {
  const context = (input.history ?? []).slice(-8).flatMap((turn) => turn.sources.map((source, index) => `${source} → ${turn.translations[index] ?? ''}`))
  const terms = (input.glossary ?? []).slice(0, 80).map((entry) => `${entry.source} → ${entry.target}`)
  return `你是日文游戏文本翻译器。把每条输入直接翻译为简体中文，不要解释、续写、添加“现在/我们/这意味着”等原文不存在的内容。简单名词只输出名词译名。保持输入数量和顺序。${input.gameNames?.length ? `\n当前游戏或上下文关键词：${input.gameNames.join(' / ')}` : ''}${input.translationInstruction?.trim() ? `\n用户附加翻译要求：${input.translationInstruction.trim()}` : ''}${terms.length ? `\n必须使用术语：${terms.join('；')}` : ''}${context.length ? `\n近期对话上下文：${context.join('\n')}` : ''}${input.correction ? `\n上次输出未通过检查，请修正：${input.correction}` : ''}\n输入：${JSON.stringify(input.texts)}\n只输出 JSON：{"translations":["译文1","译文2"]}`
}

export async function qwenTranslateMany(input: { texts: readonly string[]; history?: readonly { sources: string[]; translations: string[] }[]; glossary?: readonly { source: string; target: string }[]; correction?: string; gameNames?: readonly string[]; translationInstruction?: string; apiKey: string; model: string; endpoint?: string; capability: RemoteModelCapability }) {
  const prompt = buildQwenTranslationPrompt(input)
  const raw = parseJsonObject(await requestQwen(input.model, input.apiKey, prompt, undefined, false, input.endpoint, input.capability))
  const translations = Array.isArray(raw.translations) ? raw.translations.map((value) => typeof value === 'string' ? value.trim() : '') : []
  if (translations.length !== input.texts.length || translations.some((value) => !value)) throw new Error(`远程 LLM 返回数量不符（预期 ${input.texts.length} 条）`)
  return translations
}

function parseJsonObject(text: string): Record<string, unknown> {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/iu, '')
    .replace(/\s*```$/u, '')
  const start = cleaned.indexOf('{'),
    end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('Qwen 未返回 JSON 对象')
  return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>
}

const compactLength = (text: string) => [...text.normalize('NFKC').replace(/\s+/gu, '')].length
const safeTerm = (value: unknown, max: number) => (typeof value === 'string' && value.trim() && compactLength(value) <= max ? value.trim() : '')

export function parseQwenVisionResponse(text: string, observedText: string): QwenVisionResult | undefined {
  const raw = parseJsonObject(text)
  const correctedText = safeTerm(raw.correctedText, 160)
  const translation = safeTerm(raw.translation, 240)
  if (!translation || containsJapaneseKana(translation)) return undefined
  const entries = (Array.isArray(raw.entries) ? raw.entries : [])
    .flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const value = item as Record<string, unknown>,
        observed = safeTerm(value.observed, 32),
        canonical = safeTerm(value.canonical, 32),
        target = safeTerm(value.target, 48)
      const sourceShape = observed + canonical
      if (!observed || !canonical || !target || compactLength(observed) < 2 || compactLength(canonical) < 2 || !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(sourceShape) || containsJapaneseKana(target) || !/[\p{Script=Han}\p{Script=Latin}0-9]/u.test(target) || /^[+\-*/=×÷\p{P}\p{S}]+$/u.test(target) || /[。！？!?；;：:\n]/u.test(observed + canonical + target)) return []
      return [{ observed, canonical, target }]
    })
    .slice(0, 8)
  return { correctedText: correctedText || observedText, translation, entries }
}

export async function qwenSearchTerm(
  source: string,
  gameNames: readonly string[],
  remote: {
    apiKey: string
    model: string
    endpoint?: string
    capability: RemoteModelCapability
  },
  promptTemplate = DEFAULT_LLM_SEARCH_PROMPT_TEMPLATE,
) {
  const prompt = `${renderSearchTemplate(promptTemplate.trim() || DEFAULT_LLM_SEARCH_PROMPT_TEMPLATE, source, gameNames)}\n只输出 JSON：{"canonicalSource":"日文正确写法","target":"简体中文短译名","confidence":0到1,"evidence":["极短依据"]}。JSON 字段和格式不可省略。`
  const raw = parseJsonObject(await requestQwen(remote.model, remote.apiKey, prompt, undefined, true, remote.endpoint, remote.capability))
  const canonicalSource = safeTerm(raw.canonicalSource, 40) || source
  const target = safeTerm(raw.target, 60)
  const confidence = typeof raw.confidence === 'number' ? raw.confidence : 0
  if (!target || containsJapaneseKana(target) || confidence < 0.85) return undefined
  return {
    canonicalSource,
    target,
    confidence,
    evidence: Array.isArray(raw.evidence) ? raw.evidence.filter((item): item is string => typeof item === 'string').slice(0, 4) : [],
  }
}

export async function qwenVisionFallback(input: { observedText: string; candidates: readonly string[]; imageDataUrl: string; gameId: GameId; gameNames: readonly string[]; apiKey: string; model: string; endpoint?: string; capability?: RemoteModelCapability }): Promise<QwenVisionResult | undefined> {
  const { observedText, candidates, imageDataUrl, gameNames, apiKey, model } = input
  const prompt = `你是游戏画面 OCR 纠错与日中翻译器。图像仅是 OCR 文本区域的局部截图。\n游戏：${gameNames.join(' / ') || input.gameId}\n本地 OCR 原文：${observedText}\n未查到的片假名候选：${candidates.join('、')}\n任务：结合图像和游戏信息纠正 OCR，再把画面中的完整日文直接翻成简体中文。提取可复用的专有名词或短词；若 OCR 错字与正确日文不同，同时返回错误写法映射。例如 世儿夕→ゼルダ→塞尔达。\n只输出 JSON：{"correctedText":"纠正后的完整日文","translation":"直接简短译文","entries":[{"observed":"本地OCR写法","canonical":"正确日文词","target":"简体中文词"}]}。entries 只能包含独立短词或专名，禁止整段对白、标点和解释；无法确认则返回空 entries。`
  const startedAt = performance.now()
  writeDiagnosticLog('OCR', '进入 Qwen 视觉兜底', `${model} · ${candidates.join('、')}`, 'warning')
  const result = parseQwenVisionResponse(await requestQwen(model, apiKey, prompt, imageDataUrl, false, input.endpoint, input.capability), observedText)
  if (!result) return undefined
  writeDiagnosticLog('LLM', 'Qwen 视觉兜底响应', `${Math.round(performance.now() - startedAt)} ms · 学习 ${result.entries.length} 条`, 'success')
  return result
}
