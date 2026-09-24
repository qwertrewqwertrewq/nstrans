type NllbProgress = { status?: string; file?: string; progress?: number; loaded?: number; total?: number }
type Pending = { resolve(value: string[]): void; reject(reason: Error): void; onProgress?: (progress: NllbProgress) => void }

let worker: Worker | undefined
let sequence = 0
const pending = new Map<number, Pending>()

function getWorker() {
  if (worker) return worker
  worker = new Worker(new URL('../workers/nllb.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent<{ id: number; type: string; translations?: string[]; error?: string; progress?: NllbProgress }>) => {
    const task = pending.get(event.data.id)
    if (!task) return
    if (event.data.type === 'progress') {
      task.onProgress?.(event.data.progress ?? {})
      return
    }
    pending.delete(event.data.id)
    if (event.data.type === 'error') task.reject(new Error(event.data.error || 'NLLB 推理失败'))
    else task.resolve(event.data.translations ?? [])
  }
  worker.onerror = (event) => {
    const error = new Error(event.message || 'NLLB Worker 启动失败')
    for (const task of pending.values()) task.reject(error)
    pending.clear()
    worker?.terminate()
    worker = undefined
  }
  return worker
}

function request(message: Record<string, unknown>, onProgress?: Pending['onProgress']) {
  const id = ++sequence
  return new Promise<string[]>((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress })
    getWorker().postMessage({ id, ...message })
  })
}

export async function prepareNllb(onProgress?: Pending['onProgress'], modelUrl?: string) {
  await request({ type: 'prepare', modelUrl }, onProgress)
}

const languageCode = (language: string, fallback: string) => {
  if (/^ja|jpn/iu.test(language)) return 'jpn_Jpan'
  if (/^zh|zho/iu.test(language)) return 'zho_Hans'
  if (/^en|eng/iu.test(language)) return 'eng_Latn'
  if (/^ko|kor/iu.test(language)) return 'kor_Hang'
  return fallback
}

export function translateWithNllb(requests: readonly { text: string; sourceLanguage: string; targetLanguage: string }[], onProgress?: Pending['onProgress'], modelUrl?: string) {
  const first = requests[0]
  if (!first) return Promise.resolve([])
  return request({
    type: 'translate',
    texts: requests.map(({ text }) => text),
    sourceLanguage: languageCode(first.sourceLanguage, 'jpn_Jpan'),
    targetLanguage: languageCode(first.targetLanguage, 'zho_Hans'),
    modelUrl,
  }, onProgress)
}
