import { env, pipeline } from '@huggingface/transformers'
import { performance } from 'node:perf_hooks'
import { resolve } from 'node:path'
import { JSDOM } from 'jsdom'

const endpoint = process.env.NSTRANS_BENCH_ENDPOINT || 'http://127.0.0.1:5173/api/machine-translation-page'
const providers = ['youdao-web', 'google-web', 'bing-web', 'deepl-web']
const single = '今日はハイラル平原を探索します。'
const parallel = ['ゼルダ姫を探してください。', 'この扉は内側から開きます。', 'ゾナウエネルギーが足りません。', '準備ができたらAボタンを押してください。']
const long = '空島から地上へ降りたリンクは、ハイラル各地で起きている異変を調べながら、行方不明になったゼルダ姫の手掛かりを追っている。旅の途中では、村人から話を聞き、祠の仕掛けを解き、集めた素材で料理や装備を整える必要がある。目的地までの道は一つではなく、天候や地形、持っている道具に応じて安全な進み方を選ぶことが大切だ。'

const strip = (text) => text.replace(/<[^>]+>/gu, '').replace(/&quot;/gu, '"').replace(/&#39;/gu, "'").replace(/&amp;/gu, '&').trim()
function parse(provider, payload) {
  if (payload.trimStart().startsWith('{')) return JSON.parse(payload).translation
  const document = new JSDOM(payload).window.document
  const match = provider === 'youdao-web'
    ? [...document.querySelectorAll('#translateResult li')].map((item) => item.textContent?.trim() ?? '').filter(Boolean).join('\n')
    : strip(document.querySelector('.result-container')?.textContent ?? '')
  if (!match) throw new Error('未解析到译文')
  return match
}

async function webTranslate(provider, text) {
  const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider, text, sourceLanguage: 'jpn', targetLanguage: 'zho' }) })
  const body = await response.json()
  if (!response.ok || !body.html) throw new Error(body.error || `HTTP ${response.status}`)
  return parse(provider, body.html)
}

async function timedOutput(task) {
  const started = performance.now()
  try { const output = await task(); return { ok: true, ms: Math.round(performance.now() - started), output } }
  catch (error) { return { ok: false, ms: Math.round(performance.now() - started), error: error instanceof Error ? error.message : String(error) } }
}

const rows = []
for (const provider of providers) {
  rows.push({ provider, scenario: '单句', ...(await timedOutput(() => webTranslate(provider, single))) })
  rows.push({ provider, scenario: '4 句并行', ...(await timedOutput(() => Promise.all(parallel.map((text) => webTranslate(provider, text))))) })
  rows.push({ provider, scenario: '长句', ...(await timedOutput(() => webTranslate(provider, long))) })
}

const modelRoot = resolve('.build/models')
env.allowRemoteModels = false
env.allowLocalModels = true
env.localModelPath = `${modelRoot}/`
const loadStarted = performance.now()
try {
  const translator = await pipeline('translation', 'nstrans-nllb-200-distilled-600M-q8-v1', { dtype: 'q8', device: 'cpu' })
  rows.push({ provider: 'nllb-600m', scenario: '模型冷加载', ok: true, ms: Math.round(performance.now() - loadStarted), output: 'ready' })
  const run = async (texts) => {
    const result = await translator(texts, { src_lang: 'jpn_Jpan', tgt_lang: 'zho_Hans', max_new_tokens: 256 })
    return result.map((item) => (Array.isArray(item) ? item[0] : item).translation_text.trim())
  }
  rows.push({ provider: 'nllb-600m', scenario: '单句（热）', ...(await timedOutput(async () => (await run([single]))[0])) })
  rows.push({ provider: 'nllb-600m', scenario: '4 句批处理（热）', ...(await timedOutput(() => run(parallel))) })
  rows.push({ provider: 'nllb-600m', scenario: '长句（热）', ...(await timedOutput(async () => (await run([long]))[0])) })
} catch (error) {
  rows.push({ provider: 'nllb-600m', scenario: '模型冷加载', ok: false, ms: Math.round(performance.now() - loadStarted), error: error instanceof Error ? error.message : String(error) })
}

console.table(rows.map(({ provider, scenario, ok, ms, error }) => ({ provider, scenario, ok, ms, error: error ?? '' })))
console.log(JSON.stringify({ generatedAt: new Date().toISOString(), endpoint, samples: { single, parallel, long }, rows }, null, 2))
