import type { TranslationEngineId } from '../types'
import type { GlossaryEntry } from '../gameAdapters/types'
import type { TranslationRequest } from './translator'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { buildTranslateGemmaBatchPrompt, buildTranslateGemmaPrompt } from './translateGemmaPrompt'
import { writeDiagnosticLog } from './diagnosticLog'

export type ConversationTurn = { sources: string[]; translations: string[] }
export type TerminologyResearch = { term: string; query: string; evidence: string[]; sourceUrls: string[] }
export type LlamaBackend = 'cuda' | 'vulkan' | 'cpu'
export type LlamaBackendStatus = { backend: LlamaBackend }
export type RuntimeRequest = {
  requests: TranslationRequest[]
  history?: ConversationTurn[]
  glossary?: GlossaryEntry[]
  research?: TerminologyResearch[]
  correction?: string
}
export interface TranslationRuntime {
  id: TranslationEngineId
  label: string
  available(): Promise<boolean>
  translateMany(request: RuntimeRequest): Promise<string[]>
}

async function post(path: string, body: unknown) {
  const startedAt = performance.now()
  try {
    const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const result = await response.json() as { translations?: string[]; available?: boolean; error?: string }
    if (!response.ok || !result.translations) throw new Error(result.error || `${path} 服务不可用`)
    writeDiagnosticLog('LLM', 'TranslateGemma 响应', `${Math.round(performance.now() - startedAt)} ms · ${result.translations.length} 条`, 'success')
    return result.translations
  } catch (reason) {
    writeDiagnosticLog('LLM', 'TranslateGemma 连接或响应失败', reason instanceof Error ? reason.message : String(reason), 'error')
    throw reason
  }
}

async function status(path: string) {
  try {
    const response = await fetch(path)
    return response.ok && Boolean(((await response.json()) as { available?: boolean }).available)
  } catch { return false }
}

// HTTP is only the current desktop-development transport. The router above this
// adapter is platform-neutral; packaged Windows/Android builds can replace this
// transport with Tauri commands/JNI without changing routing or context rules.
const translateGemmaRuntime: TranslationRuntime = {
  id: 'translategemma', label: 'TranslateGemma 4B',
  available: async () => {
    const available = isTauri()
      ? await invoke<{ available: boolean }>('translategemma_status').then((result) => result.available).catch(() => false)
      : await status('/api/translategemma/status')
    writeDiagnosticLog('LLM', '运行时状态', available ? 'TranslateGemma 已连接' : 'TranslateGemma 不可用', available ? 'success' : 'warning', 5_000)
    return available
  },
  translateMany: async ({ requests, history = [], glossary, research, correction }) => {
    writeDiagnosticLog('LLM', '发送翻译请求', `${requests.length} 条 · 上下文 ${history.length} 轮 · 术语 ${glossary?.length ?? 0} 条${correction ? ' · 纠错重试' : ''}`, 'info')
    if (!isTauri()) return post('/api/translategemma', { texts: requests.map(({ text }) => text), history, glossary, research, correction })
    const context = history.flatMap((turn) => turn.sources.map((source, index) => `${source} → ${turn.translations[index] ?? ''}`))
    if (requests.length > 1) {
      const startedAt = performance.now()
      try {
        const prompt = buildTranslateGemmaBatchPrompt({ sources: requests.map(({ text }) => text), glossary, research, context, correction })
        const result = await invoke<{ translation: string }>('translategemma_generate', { prompt })
        const raw = result.translation.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '')
        const arrayText = raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1)
        const parsed = JSON.parse(arrayText) as unknown
        if (!Array.isArray(parsed) || parsed.length !== requests.length || parsed.some((value) => typeof value !== 'string' || !value.trim())) throw new Error(`批量结果数量不符（预期 ${requests.length} 条）`)
        const translations = parsed.map((value) => String(value).trim())
        writeDiagnosticLog('LLM', 'TranslateGemma 批量响应', `${translations.length} 条 · ${Math.round(performance.now() - startedAt)} ms`, 'success')
        return translations
      } catch (reason) {
        writeDiagnosticLog('LLM', '批量响应解析失败，自动逐条重试', reason instanceof Error ? reason.message : String(reason), 'warning')
      }
    }
    const translations: string[] = []
    for (const [index, request] of requests.entries()) {
      const startedAt = performance.now()
      try {
        const prompt = buildTranslateGemmaPrompt({ source: request.text, glossary, research, context, correction })
        const result = await invoke<{ translation: string }>('translategemma_generate', { prompt })
        translations.push(result.translation)
        context.push(`${request.text} → ${result.translation}`)
        writeDiagnosticLog('LLM', 'TranslateGemma 响应', `${index + 1}/${requests.length} · ${Math.round(performance.now() - startedAt)} ms · ${result.translation.length} 字`, 'success')
      } catch (reason) {
        writeDiagnosticLog('LLM', 'TranslateGemma 连接或响应失败', reason instanceof Error ? reason.message : String(reason), 'error')
        throw reason
      }
    }
    return translations
  },
}

export const translationRuntimes: Record<TranslationEngineId, TranslationRuntime> = {
  translategemma: translateGemmaRuntime,
}

export async function translationRuntimeStatus() {
  const entries = await Promise.all(Object.values(translationRuntimes).map(async (runtime) => [runtime.id, await runtime.available()] as const))
  return Object.fromEntries(entries) as Record<TranslationEngineId, boolean>
}

export async function unloadTranslateGemma() {
  if (isTauri()) await invoke('translategemma_unload')
}

export async function getTranslateGemmaBackend(): Promise<LlamaBackendStatus> {
  if (!isTauri()) return { backend: 'cpu' }
  return invoke<LlamaBackendStatus>('translategemma_backend_status')
}

export async function setTranslateGemmaBackend(backend: LlamaBackend): Promise<LlamaBackendStatus> {
  if (!isTauri()) throw new Error('推理后端仅可在 NSTrans 客户端中切换')
  return invoke<LlamaBackendStatus>('translategemma_set_backend', { backend })
}

export async function installTranslateGemma() {
  if (!isTauri()) throw new Error('模型下载仅由 NSTrans 桌面客户端管理')
  const result = await invoke<{ available: boolean; error?: string }>('translategemma_install')
  if (!result.available) throw new Error(result.error || 'TranslateGemma 4B 安装失败')
}

export async function installTranslateGemmaFromUrl(url: string) {
  if (!isTauri()) throw new Error('URL 模型下载仅由 NSTrans 桌面客户端管理')
  const result = await invoke<{ available: boolean; error?: string }>('translategemma_install_url', { url })
  if (!result.available) throw new Error(result.error || 'URL 模型安装失败')
}

export async function importTranslateGemmaFile(path: string) {
  if (!isTauri()) throw new Error('本地模型导入仅由 NSTrans 桌面客户端管理')
  const result = await invoke<{ available: boolean; error?: string }>('translategemma_import_file', { path })
  if (!result.available) throw new Error(result.error || '本地模型导入失败')
}

export async function pickAndImportTranslateGemmaFile() {
  if (!isTauri()) throw new Error('本地模型选择仅由 NSTrans 桌面客户端管理')
  const result = await invoke<{ available: boolean; cancelled: boolean; error?: string }>('translategemma_pick_file')
  if (result.cancelled) return false
  if (!result.available) throw new Error(result.error || '本地模型导入失败')
  return true
}
