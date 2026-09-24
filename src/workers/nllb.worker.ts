/// <reference lib="webworker" />
import { env, pipeline } from '@huggingface/transformers'

const worker = self as unknown as DedicatedWorkerGlobalScope
const MODEL_ID = 'Xenova/nllb-200-distilled-600M'
const HUGGING_FACE_ORIGIN = 'https://huggingface.co/'
const HUGGING_FACE_TEMPLATE = '{model}/resolve/{revision}/'
type NllbTranslator = (texts: string[], options: Record<string, unknown>) => Promise<unknown>
let translatorPromise: Promise<NllbTranslator> | undefined
let translatorSource: string | undefined

function translator(progress_callback?: (progress: Record<string, unknown>) => void, modelUrl?: string) {
  const source = modelUrl || MODEL_ID
  if (translatorSource !== source) {
    translatorPromise = undefined
    translatorSource = source
  }
  // Packaged clients read the extracted archive through NSTrans' loopback
  // file server. Do not duplicate the ~900 MB model in WebView Cache Storage.
  env.allowLocalModels = false
  env.allowRemoteModels = true
  env.useBrowserCache = !modelUrl
  env.remoteHost = modelUrl ? modelUrl.replace(/\/$/u, '') : HUGGING_FACE_ORIGIN
  // Transformers.js always inserts a separator around remotePathTemplate.
  // `.` is normalized by fetch and avoids producing `/nllb//file`.
  env.remotePathTemplate = modelUrl ? '.' : HUGGING_FACE_TEMPLATE
  translatorPromise ??= pipeline('translation', MODEL_ID, {
    dtype: 'q8',
    device: 'wasm',
    progress_callback,
  }) as unknown as Promise<NllbTranslator>
  return translatorPromise
}

worker.onmessage = async (event: MessageEvent<{ id: number; type: 'prepare' | 'translate'; texts?: string[]; sourceLanguage?: string; targetLanguage?: string; modelUrl?: string }>) => {
  const { id, type } = event.data
  try {
    const pipe = await translator((progress) => worker.postMessage({ id, type: 'progress', progress }), event.data.modelUrl)
    if (type === 'prepare') {
      worker.postMessage({ id, type: 'ready' })
      return
    }
    const output = await pipe(event.data.texts ?? [], {
      src_lang: event.data.sourceLanguage ?? 'jpn_Jpan',
      tgt_lang: event.data.targetLanguage ?? 'zho_Hans',
      max_new_tokens: 256,
    })
    const rows: unknown[] = Array.isArray(output) ? output : [output]
    const translations = rows.map((row) => {
      const item = Array.isArray(row) ? row[0] : row
      return typeof item === 'object' && item && 'translation_text' in item ? String(item.translation_text).trim() : ''
    })
    worker.postMessage({ id, type: 'result', translations })
  } catch (reason) {
    translatorPromise = undefined
    worker.postMessage({ id, type: 'error', error: reason instanceof Error ? reason.message : String(reason) })
  }
}
