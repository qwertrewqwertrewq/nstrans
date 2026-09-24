import { invoke, isTauri } from '@tauri-apps/api/core'
import type { MachineTranslationProvider } from '../types'

type WebMachineProvider = Exclude<MachineTranslationProvider, 'nllb-600m'>

export const webMachineProviderLabels: Record<WebMachineProvider, string> = {
  'youdao-web': '网易有道网页机翻',
  'google-web': 'Google 网页机翻',
  'bing-web': 'Bing 网页机翻',
  'deepl-web': 'DeepL 网页机翻',
}

const textContent = (html: string, selector: string) => {
  const document = new DOMParser().parseFromString(html, 'text/html')
  return [...document.querySelectorAll(selector)]
    .map((node) => node.textContent?.trim() ?? '')
    .filter(Boolean)
    .join('\n')
    .trim()
}

export function parseMachineTranslationPage(provider: WebMachineProvider, html: string) {
  if (html.trimStart().startsWith('{')) {
    try {
      const payload = JSON.parse(html) as { translation?: string; error?: string }
      if (payload.translation?.trim()) return payload.translation.trim()
      if (payload.error) throw new Error(payload.error)
    } catch (reason) {
      if (reason instanceof SyntaxError) throw new Error('网页机翻返回了无法解析的响应')
      if (provider === 'bing-web' || provider === 'deepl-web') throw reason
    }
  }
  const translated = provider === 'youdao-web'
    ? textContent(html, '#translateResult li')
    : textContent(html, '.result-container')
  if (translated) return translated
  if (/captcha|unusual traffic|异常流量|验证码/iu.test(html)) throw new Error('网页机翻触发了服务方验证，请稍后重试或切换服务')
  throw new Error('网页机翻页面未返回可识别的译文，页面结构可能已更新')
}

async function fetchPage(provider: WebMachineProvider, text: string, sourceLanguage: string, targetLanguage: string) {
  if (isTauri()) return invoke<string>('machine_translation_page', { provider, text, sourceLanguage, targetLanguage })
  const response = await fetch('/api/machine-translation-page', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, text, sourceLanguage, targetLanguage }),
  })
  const result = await response.json() as { html?: string; error?: string }
  if (!response.ok || !result.html) throw new Error(result.error || '网页机翻服务不可用')
  return result.html
}

export async function translateWithWebPage(provider: WebMachineProvider, text: string, sourceLanguage: string, targetLanguage: string) {
  return parseMachineTranslationPage(provider, await fetchPage(provider, text, sourceLanguage, targetLanguage))
}

export async function translateManyWithWebPage(provider: WebMachineProvider, requests: readonly { text: string; sourceLanguage: string; targetLanguage: string }[]) {
  const results = new Array<string>(requests.length)
  // Public pages rate-limit bursts. Three workers are enough to reduce subtitle
  // latency without turning one OCR frame into an unbounded request spike.
  let cursor = 0
  const concurrency = provider === 'youdao-web' ? 3 : provider === 'google-web' ? 2 : 1
  const workers = Array.from({ length: Math.min(concurrency, requests.length) }, async () => {
    while (cursor < requests.length) {
      const index = cursor++
      const request = requests[index]
      results[index] = await translateWithWebPage(provider, request.text, request.sourceLanguage, request.targetLanguage)
    }
  })
  await Promise.all(workers)
  return results
}
