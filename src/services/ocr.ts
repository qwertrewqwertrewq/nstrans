import { createWorker, PSM, type Worker } from 'tesseract.js'
import { invoke, isTauri } from '@tauri-apps/api/core'
import type { OcrEngine, ScanMode, TextRegion } from '../types'
import { writeDiagnosticLog } from './diagnosticLog'
import { detectClientPlatform } from './clientPlatform'

let worker: Worker | null = null
let workerLanguage = ''
let meikiReady = false
const controllerToken = /^(?:A|B|X|Y|L|R|ZL|ZR|SL|SR|\+|-|＋|−)$/i
export type OcrProgress = { status: string; progress: number; detail?: string }

export async function recognizeJapanese(canvas: HTMLCanvasElement, language: string, minimumConfidence: number, scanMode: ScanMode, onProgress: (event: OcrProgress) => void, preferredEngine: OcrEngine = 'meiki'): Promise<TextRegion[]> {
  const platform = detectClientPlatform()
  if (isTauri() && (platform === 'ios' || platform === 'macos' && preferredEngine === 'apple-vision')) {
    const startedAt = performance.now()
    onProgress({ status: 'apple-vision-recognizing', progress: .55, detail: 'Apple Vision 正在识别日文' })
    const native = await recognizeWithAppleVision(canvas, minimumConfidence).catch((reason) => {
      if (platform === 'ios') throw reason
      writeDiagnosticLog('OCR', 'Apple Vision 不可用，切换 MeikiOCR', messageOf(reason), 'warning', 10_000)
      return null
    })
    if (native) {
      const regions = filterSceneText(native, canvas.width, canvas.height, scanMode)
      onProgress({ status: 'apple-vision', progress: 1 })
      reportRecognition(`Apple Vision (${platform === 'ios' ? 'iPadOS' : 'macOS'})`, regions, performance.now() - startedAt)
      return regions
    }
    if (platform === 'ios') throw new Error('Apple Vision 没有返回识别结果')
  }
  const meikiStartedAt = performance.now(), coldStart = !meikiReady
  if (coldStart) {
    onProgress({ status: 'meikiocr-loading', progress: .05, detail: '首次加载模型可能需要 30–60 秒，请稍候' })
    writeDiagnosticLog('OCR', '正在启动识别模型', 'MeikiOCR · 首次加载可能需要 30–60 秒', 'info', 60_000)
  } else onProgress({ status: 'meikiocr-recognizing', progress: .55 })
  const loadingTimer = coldStart ? setInterval(() => {
    const seconds = Math.max(1, Math.round((performance.now() - meikiStartedAt) / 1_000))
    onProgress({ status: 'meikiocr-loading', progress: Math.min(.9, .05 + seconds / 75), detail: `已等待 ${seconds} 秒 · 首次加载模型可能需要 30–60 秒` })
  }, 1_000) : undefined
  const meiki = await recognizeWithMeiki(canvas, minimumConfidence).then((result) => {
    meikiReady = Boolean(result)
    return result
  }).catch((reason) => {
    meikiReady = false
    writeDiagnosticLog('OCR', 'MeikiOCR 不可用，切换备选', messageOf(reason), 'warning', 10_000)
    return null
  }).finally(() => { if (loadingTimer) clearInterval(loadingTimer) })
  if (meiki) {
    onProgress({ status: 'meikiocr', progress: 1 })
    const regions = filterSceneText(meiki, canvas.width, canvas.height, scanMode)
    reportRecognition('MeikiOCR', regions, performance.now() - meikiStartedAt, coldStart)
    return regions
  }
  if (platform === 'windows') throw new Error('MeikiOCR 无法使用，请重新安装 Windows OCR 运行时或查看运行日志')
  const native = await recognizeWithAppleVision(canvas, minimumConfidence).catch((reason) => {
    writeDiagnosticLog('OCR', 'Apple Vision 不可用，切换备选', messageOf(reason), 'warning', 10_000)
    return null
  })
  if (native) {
    const regions = filterSceneText(native, canvas.width, canvas.height, scanMode)
    reportRecognition('Apple Vision', regions)
    return regions
  }
  if (!worker || workerLanguage !== language) {
    writeDiagnosticLog('OCR', '加载识别模型', `Tesseract · ${language}`, 'info')
    await worker?.terminate()
    worker = await createWorker(language, undefined, { logger: ({ status, progress }) => onProgress({ status, progress }) })
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT })
    workerLanguage = language
  }
  const result = await worker.recognize(canvas, {}, { blocks: true })
  const lines = result.data.blocks?.flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines)) ?? []
  const regions = lines.filter((line) => line.text.trim() && line.confidence >= minimumConfidence).map((line, index) => ({
    id: `${Date.now()}-${index}`, source: line.text.trim(), translated: '', confidence: line.confidence, box: line.bbox,
    fontFamily: line.words.some((word) => /serif|mincho|明朝/i.test(word.font_name)) ? 'serif' as const : 'sans' as const,
  }))
  const filtered = filterSceneText(regions, canvas.width, canvas.height, scanMode)
  reportRecognition(`Tesseract (${language})`, filtered)
  return filtered
}

function reportRecognition(engine: string, regions: readonly TextRegion[], durationMs?: number, coldStart = false) {
  writeDiagnosticLog('OCR', '识别模型', engine, 'info', 5_000)
  const duration = durationMs === undefined ? '' : ` · ${Math.round(durationMs)} ms${coldStart ? '（含首次加载）' : ''}`
  writeDiagnosticLog('OCR', '识别完成', `成功 ${regions.length} 条${duration}`, regions.length ? 'success' : 'info', 1_500)
  if (coldStart && durationMs !== undefined && durationMs > 15_000) writeDiagnosticLog('OCR', '首次模型加载较慢', `${Math.round(durationMs / 1_000)} 秒 · 后续识别将复用已加载模型`, 'warning')
}

function messageOf(reason: unknown) { return reason instanceof Error ? reason.message : String(reason) }

async function recognizeWithMeiki(canvas: HTMLCanvasElement, minimumConfidence: number): Promise<TextRegion[] | null> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', .92))
  if (!blob) return null
  if (isTauri()) {
    const imageBase64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onerror = () => reject(reader.error ?? new Error('无法编码 OCR 图像'))
      reader.onload = () => resolve(String(reader.result).split(',', 2)[1] ?? '')
      reader.readAsDataURL(blob)
    })
    // Passing a Uint8Array through Tauri turns every byte into a JSON number.
    // Keep JPEG as base64 through JS → Rust → JNI to avoid two large copies and
    // one native re-encode on every OCR cycle.
    const result = await invoke<{ regions: TextRegion[]; error?: string }>('meiki_ocr', { imageBase64, minimumConfidence })
    if (result.error) throw new Error(result.error)
    return result.regions.filter((region) => region.confidence >= minimumConfidence)
  }
  const response = await fetch('/api/meiki-ocr', { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob })
  if (!response.ok) return null
  const result = await response.json() as { regions: TextRegion[] }
  return result.regions.filter((region) => region.confidence >= minimumConfidence)
}

async function recognizeWithAppleVision(canvas: HTMLCanvasElement, minimumConfidence: number): Promise<TextRegion[] | null> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', .9))
  if (!blob) return null
  if (isTauri()) {
    const result = await invoke<{ regions: TextRegion[] }>('mac_vision_ocr', { image: Array.from(new Uint8Array(await blob.arrayBuffer())) })
    return result.regions.filter((region) => region.confidence >= minimumConfidence)
  }
  const response = await fetch('/api/macos-ocr', { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob })
  if (!response.ok) return null
  const result = await response.json() as { regions: TextRegion[] }
  return result.regions.filter((region) => region.confidence >= minimumConfidence)
}
export async function disposeOcr() {
  await worker?.terminate(); worker = null; workerLanguage = ''; meikiReady = false
  if (isTauri()) await invoke('meiki_ocr_unload').catch(() => undefined)
}
export function fitCaptureSize(width: number, height: number, maxWidth = 1280) {
  if (!width || !height) return { width: 0, height: 0 }
  const scale = Math.min(1, maxWidth / width)
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

export function mergeContinuousRegions(input: TextRegion[]): TextRegion[] {
  const height = (region: TextRegion) => region.box.y1 - region.box.y0
  const width = (region: TextRegion) => region.box.x1 - region.box.x0
  const overlapX = (a: TextRegion, b: TextRegion) => Math.max(0, Math.min(a.box.x1, b.box.x1) - Math.max(a.box.x0, b.box.x0))

  // Furigana is commonly detected as a separate, much smaller line above the
  // actual kanji. Do not translate and cover it as an independent sentence.
  const withoutRuby = input.filter((candidate) => !input.some((main) => {
    if (candidate === main || height(candidate) >= height(main) * .68) return false
    const horizontallyContained = overlapX(candidate, main) / Math.max(1, width(candidate)) > .7
    const closeAbove = candidate.box.y1 <= main.box.y0 + height(main) * .35 && main.box.y0 - candidate.box.y1 < height(main) * .55
    return horizontallyContained && closeAbove
  }))

  const sorted = [...withoutRuby].sort((a, b) => a.box.y0 - b.box.y0 || a.box.x0 - b.box.x0)
  const merged: TextRegion[] = []
  for (const region of sorted) {
    const previous = merged.at(-1)
    if (!previous) { merged.push({ ...region }); continue }
    const verticalOverlap = Math.max(0, Math.min(previous.box.y1, region.box.y1) - Math.max(previous.box.y0, region.box.y0))
    const sameLine = verticalOverlap / Math.max(1, Math.min(height(previous), height(region))) > .62
    const gap = region.box.x0 - previous.box.x1
    const touchesControllerToken = controllerToken.test(previous.source.trim()) || controllerToken.test(region.source.trim())
    if (sameLine && !touchesControllerToken && gap >= -Math.min(height(previous), height(region)) * .2 && gap < Math.max(height(previous), height(region)) * 1.25) {
      const leftFirst = previous.box.x0 <= region.box.x0
      previous.source = leftFirst ? previous.source + region.source : region.source + previous.source
      previous.confidence = (previous.confidence + region.confidence) / 2
      previous.box = { x0: Math.min(previous.box.x0, region.box.x0), y0: Math.min(previous.box.y0, region.box.y0), x1: Math.max(previous.box.x1, region.box.x1), y1: Math.max(previous.box.y1, region.box.y1) }
    } else merged.push({ ...region })
  }
  return merged
}

export function filterSceneText(input: TextRegion[], frameWidth: number, frameHeight: number, mode: ScanMode): TextRegion[] {
  if (mode === 'full') return mergeContinuousRegions(input)
  const merged = mergeContinuousRegions(input)
  const japanese = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}々〆ヵヶー]/gu
  const containsButtonPrompt = /(?:^|\s)(?:A|B|X|Y|L|R|ZL|ZR|SL|SR)(?:$|\s)|[ⒶⒷⓍⓎ●○]/i
  const candidates = merged.filter((region) => {
    const text = region.source.replace(/\s/g, '')
    const boxWidth = region.box.x1 - region.box.x0, boxHeight = region.box.y1 - region.box.y0
    const centerX = (region.box.x0 + region.box.x1) / 2 / frameWidth, centerY = (region.box.y0 + region.box.y1) / 2 / frameHeight
    const jpCount = text.match(japanese)?.length ?? 0
    const readableCount = text.match(/[\p{L}\p{N}]/gu)?.length ?? 0
    if (controllerToken.test(text) || jpCount < 2 || jpCount / Math.max(1, readableCount) < .58) return false
    // Dense game UI descriptions are often only 1.6–2.3% of the frame height.
    // Keep coherent, confident Japanese lines while retaining the stricter
    // threshold for short HUD fragments, counters and isolated false positives.
    const bottomPromptText = centerY > .9 && jpCount >= 2 && region.confidence >= 65 && !containsButtonPrompt.test(region.source)
    const coherentSmallText = jpCount >= 4 && region.confidence >= 55
    const minimumHeightRatio = bottomPromptText ? .014 : coherentSmallText ? .016 : .024
    const minimumWidthRatio = bottomPromptText ? .012 : .025
    if (boxHeight < frameHeight * minimumHeightRatio || boxWidth < frameWidth * minimumWidthRatio) return false
    if (containsButtonPrompt.test(region.source) && boxHeight < frameHeight * .05) return false
    if (mode === 'subtitles') return centerY > .48 && centerX > .08 && centerX < .92
    // Nintendo Switch HUD prompts typically sit in a bottom corner and use a
    // much smaller font than dialogue. Keep the central 74% as the dialogue lane.
    const cornerPrompt = centerY > .78 && (centerX < .16 || centerX > .84) && !bottomPromptText
    const bottomHud = centerY > .9 && boxHeight < frameHeight * .045 && !bottomPromptText
    return !cornerPrompt && !bottomHud && (bottomPromptText || centerX > .13 && centerX < .87)
  })
  return candidates
}
