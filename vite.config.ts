import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildTranslateGemmaPrompt } from './src/services/translateGemmaPrompt.js'

const translationBinary = 'native/macos/bin/nstrans-translate'
const visionBinary = 'native/macos/bin/nstrans-vision-ocr'
let meikiWorker: ChildProcessWithoutNullStreams | null = null
let launchedOllama: ChildProcess | null = null
let ollamaStartup: Promise<boolean> | null = null
let meikiBuffer = ''
const meikiPending: Array<(result: string | null) => void> = []

function getMeikiCommand(): { binary: string; args: string[] } {
  if (process.platform === 'win32') {
    if (existsSync('native/runtime/windows/nstrans-meiki-ocr.exe')) {
      return { binary: resolve('native/runtime/windows/nstrans-meiki-ocr.exe'), args: [] }
    }
    if (existsSync('.build/windows/venv/Scripts/python.exe')) {
      return { binary: resolve('.build/windows/venv/Scripts/python.exe'), args: ['native/ocr/meiki_worker.py'] }
    }
  }
  return { binary: '.venv/bin/python', args: ['native/ocr/meiki_worker.py'] }
}

function runMeiki(image: Uint8Array): Promise<string | null> {
  if (!meikiWorker) {
    const { binary, args } = getMeikiCommand()
    meikiWorker = spawn(binary, args, { cwd: process.cwd(), env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' } })
    meikiWorker.stdout.on('data', (chunk) => {
      meikiBuffer += String(chunk)
      const lines = meikiBuffer.split('\n'); meikiBuffer = lines.pop() ?? ''
      for (const line of lines) if (line.startsWith('YOMI_RESULT:')) meikiPending.shift()?.(line.slice('YOMI_RESULT:'.length))
    })
    meikiWorker.on('error', () => { meikiWorker = null; while (meikiPending.length) meikiPending.shift()?.(null) })
    meikiWorker.on('close', () => { meikiWorker = null; while (meikiPending.length) meikiPending.shift()?.(null) })
  }
  return new Promise((resolve) => {
    meikiPending.push(resolve)
    meikiWorker!.stdin.write(`${JSON.stringify({ image: Buffer.from(image).toString('base64'), det_threshold: .45, rec_threshold: .15 })}\n`)
  })
}

function readBody(request: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve) => { let body = ''; request.on('data', (chunk) => { body += String(chunk) }); request.on('end', () => resolve(body)) })
}

async function ollamaAvailable() {
  try { const response = await fetch('http://127.0.0.1:11434/api/tags'); const data = await response.json() as { models?: Array<{ name: string }> }; return response.ok && Boolean(data.models?.some(({ name }) => name.startsWith('translategemma:4b'))) } catch { return false }
}

async function ollamaServerAvailable() {
  try { return (await fetch('http://127.0.0.1:11434/api/tags')).ok } catch { return false }
}

async function ensureOllama() {
  if (await ollamaAvailable()) return true
  if (await ollamaServerAvailable()) throw new Error('Ollama 已启动，但未安装 translategemma:4b；请运行 npm run models:setup')
  if (ollamaStartup) return await ollamaStartup
  ollamaStartup = new Promise<boolean>((resolve, reject) => {
    const child = spawn('ollama', ['serve'], { cwd: process.cwd(), stdio: 'ignore' })
    launchedOllama = child
    child.once('error', (error) => reject(new Error(`无法启动 Ollama：${error.message}`)))
    let attempts = 0
    const check = async () => {
      if (await ollamaAvailable()) { resolve(true); return }
      if (++attempts >= 40) { reject(new Error('Ollama 启动超时；请打开 Ollama 应用后重试')); return }
      setTimeout(() => { void check() }, 250)
    }
    void check()
  }).finally(() => { ollamaStartup = null })
  return await ollamaStartup
}

async function runTranslateGemma(body: string) {
  await ensureOllama()
  const payload = JSON.parse(body) as { texts?: string[]; history?: Array<{ sources: string[]; translations: string[] }>; glossary?: Array<{ source: string; target: string }>; research?: Array<{ term: string; query: string; evidence: string[]; sourceUrls: string[] }>; correction?: string }
  const texts = payload.texts ?? []
  const context: string[] = (payload.history ?? []).flatMap((turn) => turn.sources.map((source, index) => `${source} → ${turn.translations[index] ?? ''}`))
  const translations: string[] = []
  for (const source of texts) {
    const prompt = buildTranslateGemmaPrompt({ source, glossary: payload.glossary, research: payload.research, context, correction: payload.correction })
    const response = await fetch('http://127.0.0.1:11434/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      model: 'translategemma:4b', stream: false,
      // TranslateGemma supports a single User translation turn. Ollama maps a
      // system message to another user turn for this model, which makes the
      // terminology/research instructions unreliable.
      messages: [{ role: 'user', content: prompt }],
      options: { temperature: 0 }, keep_alive: '5m',
    }) })
    const result = await response.json() as { message?: { content?: string }; error?: string }
    if (!response.ok || !result.message?.content) throw new Error(result.error || 'TranslateGemma 没有返回结果')
    const translation = result.message.content.trim().replace(/^['"]|['"]$/g, '')
    translations.push(translation); context.push(`${source} → ${translation}`)
  }
  return JSON.stringify({ translations })
}

type SearchHit = { title: string; url: string; snippet: string }

async function runEntitySearch(body: string) {
  const payload = JSON.parse(body) as { engine?: string; query?: string; apiKey?: string }
  const query = payload.query?.trim() ?? '', apiKey = payload.apiKey?.trim() ?? ''
  if (!query || !apiKey) throw new Error('搜索查询或 API Key 为空')
  const startedAt = performance.now()
  let hits: SearchHit[] = []
  if (payload.engine === 'brave') {
    const url = new URL('https://api.search.brave.com/res/v1/web/search')
    url.search = new URLSearchParams({ q: query, count: '8', extra_snippets: 'true' }).toString()
    const searchResponse = await fetch(url, { headers: { accept: 'application/json', 'x-subscription-token': apiKey }, signal: AbortSignal.timeout(4_000) })
    const result = await searchResponse.json() as { web?: { results?: Array<{ title?: string; url?: string; description?: string; extra_snippets?: string[] }> }; message?: string }
    if (!searchResponse.ok) throw new Error(result.message || `Brave Search 请求失败 (${searchResponse.status})`)
    hits = (result.web?.results ?? []).map((item) => ({ title: item.title ?? '', url: item.url ?? '', snippet: [item.description, ...(item.extra_snippets ?? [])].filter(Boolean).join(' | ') })).filter(({ url }) => /^https:\/\//u.test(url))
  } else if (payload.engine === 'qianfan') {
    const searchResponse = await fetch('https://qianfan.baidubce.com/v2/ai_search/web_search', { method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: [...query].slice(0, 60).join('') }], search_source: 'baidu_search_v2', edition: 'lite', resource_type_filter: [{ type: 'web', top_k: 8 }] }), signal: AbortSignal.timeout(4_000) })
    const result = await searchResponse.json() as { references?: Array<{ title?: string; url?: string; content?: string; snippet?: string }>; message?: string }
    if (!searchResponse.ok) throw new Error(result.message || `百度千帆搜索请求失败 (${searchResponse.status})`)
    hits = (result.references ?? []).map((item) => ({ title: item.title ?? '', url: item.url ?? '', snippet: item.content ?? item.snippet ?? '' })).filter(({ url }) => /^https:\/\//u.test(url))
  } else throw new Error('不支持的搜索引擎')
  console.info('[entity-search-proxy]', { engine: payload.engine, query, durationMs: Math.round(performance.now() - startedAt), hitCount: hits.length })
  return JSON.stringify({ hits: hits.slice(0, 8) })
}

function runNative(binary: string, args: string[], input: string | Uint8Array = ''): Promise<{ output: string; status: number }> {
  return new Promise((resolve) => {
    const child = spawn(binary, args, { cwd: process.cwd() })
    let output = ''
    child.stdout.on('data', (chunk) => { output += String(chunk) })
    child.stderr.on('data', (chunk) => { output += String(chunk) })
    child.on('error', (error) => resolve({ output: JSON.stringify({ available: false, error: error.message }), status: 1 }))
    child.on('close', (status) => resolve({ output, status: status ?? 1 }))
    child.stdin.end(input)
  })
}
const runNativeTranslation = (args: string[], input = '') => runNative(translationBinary, args, input)

function macTranslationPlugin(): Plugin {
  return { name: 'nstrans-macos-translation', configureServer(server) {
    server.middlewares.use('/api/macos-translation/status', async (_request, response) => {
      const result = process.platform === 'darwin' ? await runNativeTranslation(['--status']) : { output: JSON.stringify({ available: false, error: '仅 macOS 支持系统翻译。' }), status: 1 }
      response.statusCode = result.status === 0 ? 200 : 503; response.setHeader('Content-Type', 'application/json; charset=utf-8'); response.end(result.output)
    })
    server.middlewares.use('/api/macos-translation', (request, response, next) => {
      if (request.method !== 'POST') { next(); return }
      let body = ''; request.on('data', (chunk) => { body += String(chunk) }); request.on('end', async () => {
        const result = await runNativeTranslation([], body)
        response.statusCode = result.status === 0 ? 200 : 503; response.setHeader('Content-Type', 'application/json; charset=utf-8'); response.end(result.output)
      })
    })
    server.middlewares.use('/api/macos-ocr', (request, response, next) => {
      if (request.method !== 'POST' || process.platform !== 'darwin') { next(); return }
      const chunks: Uint8Array[] = []
      request.on('data', (chunk: Uint8Array) => chunks.push(chunk)); request.on('end', async () => {
        const result = await runNative(visionBinary, [], Buffer.concat(chunks))
        response.statusCode = result.status === 0 ? 200 : 500; response.setHeader('Content-Type', 'application/json; charset=utf-8'); response.end(result.output)
      })
    })
    server.middlewares.use('/api/meiki-ocr', (request, response, next) => {
      if (request.method !== 'POST') { next(); return }
      const chunks: Uint8Array[] = []
      request.on('data', (chunk: Uint8Array) => chunks.push(chunk)); request.on('end', async () => {
        const output = await runMeiki(Buffer.concat(chunks))
        response.statusCode = output ? 200 : 503; response.setHeader('Content-Type', 'application/json; charset=utf-8'); response.end(output ?? JSON.stringify({ regions: [], error: 'meikiocr 服务不可用' }))
      })
    })
    server.middlewares.use('/api/translategemma/status', async (_request, response) => {
      try { const available = await ensureOllama(); response.statusCode = available ? 200 : 503; response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ available })) }
      catch (error) { response.statusCode = 503; response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ available: false, error: error instanceof Error ? error.message : 'Ollama 启动失败' })) }
    })
    server.middlewares.use('/api/entity-search', (request, response, next) => {
      if (request.method !== 'POST') { next(); return }
      void readBody(request).then(runEntitySearch).then((output) => {
        response.statusCode = 200; response.setHeader('Content-Type', 'application/json; charset=utf-8'); response.end(output)
      }).catch((error: unknown) => {
        console.warn('[entity-search-proxy]', { status: 'error', error: error instanceof Error ? error.message : '搜索服务不可用' })
        response.statusCode = 502; response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ error: error instanceof Error ? error.message : '搜索服务不可用' }))
      })
    })
    server.middlewares.use('/api/translategemma', (request, response, next) => {
      if (request.method !== 'POST') { next(); return }
      void readBody(request).then(runTranslateGemma).then((output) => {
        response.statusCode = 200; response.setHeader('Content-Type', 'application/json; charset=utf-8'); response.end(output)
      }).catch((error: unknown) => { response.statusCode = 503; response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ error: error instanceof Error ? error.message : 'TranslateGemma 服务不可用' })) })
    })
    server.httpServer?.once('close', () => { meikiWorker?.kill(); launchedOllama?.kill() })
  } }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), macTranslationPlugin()],
})
