import type { TranslationProvider } from '../types'
import { invoke, isTauri } from '@tauri-apps/api/core'
export interface TranslationRequest { text: string; sourceLanguage: string; targetLanguage: string; imageDataUrl?: string }
export interface Translator { id: TranslationProvider; label: string; available(): Promise<boolean>; translate(request: TranslationRequest): Promise<string>; translateMany?(requests: TranslationRequest[]): Promise<string[]> }

declare global { interface Window { macTranslation?: { isAvailable(): Promise<boolean>; translate(request: TranslationRequest): Promise<string> } } }

export async function macTranslationStatus(): Promise<{ available: boolean; error?: string }> {
  if (window.macTranslation) return { available: await window.macTranslation.isAvailable() }
  if (isTauri()) return invoke('mac_translation_status')
  try {
    const response = await fetch('/api/macos-translation/status')
    return await response.json() as { available: boolean; error?: string }
  } catch { return { available: false, error: 'macOS 原生翻译服务未连接。' } }
}

const macTranslator: Translator = {
  id: 'macos', label: 'macOS 系统翻译',
  async available() { return (await macTranslationStatus()).available },
  async translate(request) { return (await this.translateMany!([request]))[0] },
  async translateMany(requests) {
    if (window.macTranslation) return Promise.all(requests.map((request) => window.macTranslation!.translate(request)))
    if (isTauri()) {
      const result = await invoke<{ translations?: string[]; error?: string }>('mac_translate', { texts: requests.map((request) => request.text) })
      if (!result.translations) throw new Error(result.error || 'macOS 系统翻译不可用')
      return result.translations
    }
    const response = await fetch('/api/macos-translation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ texts: requests.map((request) => request.text) }) })
    const result = await response.json() as { translations?: string[]; error?: string }
    if (!response.ok || !result.translations) throw new Error(result.error || 'macOS 系统翻译不可用')
    return result.translations
  },
}
const llmTranslator: Translator = { id: 'llm', label: 'LLM API', available: async () => false, async translate() { throw new Error('LLM API 尚未配置') } }
const previewTranslator: Translator = { id: 'preview', label: '仅 OCR', available: async () => true, async translate() { return '' }, async translateMany(requests) { return requests.map(() => '') } }
export const translators: Record<TranslationProvider, Translator> = { macos: macTranslator, llm: llmTranslator, preview: previewTranslator }
