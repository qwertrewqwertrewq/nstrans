import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Activity, Camera, ChevronDown, Expand, Gauge, Languages, LoaderCircle, Maximize, Pause, Play, RefreshCw, ScanText, Settings2, Sparkles, Video } from 'lucide-react'
import './App.css'
import { DialogueStabilizer } from './services/dialogueStabilizer'
import { disposeOcr, fitCaptureSize, recognizeJapanese, type OcrProgress } from './services/ocr'
import { TranslationRouter, defaultRoutingSettings } from './services/translationRouter'
import { getTranslateGemmaBackend, installTranslateGemma, installTranslateGemmaFromUrl, pickAndImportTranslateGemmaFile, setTranslateGemmaBackend, translationRuntimes, translationRuntimeStatus, unloadTranslateGemma, type LlamaBackend } from './services/translationRuntime'
import { ConfigurableEntityLookup, EntityLearningQueue } from './services/entityLookup'
import { browserTranslationMemory } from './services/translationMemory'
import { browserDictionaryPacks, HttpDictionaryDistributionProvider } from './services/dictionaryPacks'
import { browserContributionQueue, HttpContributionUploader, loadCommunityApiKey, saveCommunityApiKey } from './services/knowledgeSharing'
import { translationOverlayLayout, TranslationMarqueeLocks, translationMarqueeDurationMs } from './services/translationMarquee'
import { gameOptions, getGameProfile } from './gameAdapters/registry'
import type { GameId } from './gameAdapters/types'
import { PresentationToolbar } from './components/PresentationToolbar'
import { SelectionOverlay } from './components/SelectionOverlay'
import { offsetTextRegions, selectionCanvasRect, type NormalizedSelection } from './services/presentationGeometry'
import type { LatencySample, OcrSettings, OverlaySettings, TextRegion, TranslationEngineId, TranslationRoutingSettings } from './types'
import { entitySearchEngineLabels, loadEntitySearchSettings, saveEntitySearchSettings, type EntitySearchEngineId } from './services/entitySearchSettings'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { clearDiagnosticLog, diagnosticLogEntries, subscribeDiagnosticLog, writeDiagnosticLog, type DiagnosticLogEntry } from './services/diagnosticLog'
import { detectClientPlatform, type ClientPlatform } from './services/clientPlatform'
import { closeUsbVideoDevice, listUsbVideoDevices, openUsbVideoDevice, readUsbVideoFrame } from './services/usbCamera'

const emptyLatency: LatencySample = { capture: 0, ocr: 0, translate: 0, render: 0, total: 0 }
const communityOrigin = 'https://nstrans.221129.xyz'
const ocrEngineStorageKey = 'nstrans.ocr-engine'
type FrameProcessOptions = { force?: boolean; fullFrame?: boolean; selectionOverride?: NormalizedSelection | null; resetContext?: boolean }
type VideoInputDevice = { id: string; label: string; source: 'media' | 'usb' }
function errorMessage(reason: unknown, fallback: string) {
  if (reason instanceof Error && reason.message) return reason.message
  if (typeof reason === 'string' && reason.trim()) return reason
  if (reason && typeof reason === 'object') {
    const message = Reflect.get(reason, 'message')
    if (typeof message === 'string' && message.trim()) return message
    try { return JSON.stringify(reason) } catch { /* use fallback */ }
  }
  return fallback
}

function TranslationOverlay({ region, frameSize, videoRect, overlay }: { region: TextRegion; frameSize: { captureWidth: number; captureHeight: number }; videoRect: { left: number; top: number; width: number; height: number }; overlay: OverlaySettings }) {
  const scaleX = videoRect.width / frameSize.captureWidth, scaleY = videoRect.height / frameSize.captureHeight
  const rawLeft = videoRect.left + region.box.x0 * scaleX, rawTop = videoRect.top + region.box.y0 * scaleY
  const rawWidth = Math.max(1, (region.box.x1 - region.box.x0) * scaleX), rawHeight = Math.max(1, (region.box.y1 - region.box.y0) * scaleY)
  const safetyX = Math.min(10, Math.max(3, rawHeight * .18)), safetyY = Math.min(6, Math.max(2, rawHeight * .12))
  const left = Math.max(videoRect.left, rawLeft - safetyX), top = Math.max(videoRect.top, rawTop - safetyY)
  const right = Math.min(videoRect.left + videoRect.width, rawLeft + rawWidth + safetyX), bottom = Math.min(videoRect.top + videoRect.height, rawTop + rawHeight + safetyY)
  const width = Math.max(1, right - left), height = Math.max(1, bottom - top)
  const sourceText = region.translationSource ?? region.source
  const layout = translationOverlayLayout(sourceText, region.translated, rawWidth, rawHeight, overlay.fontScale)
  const marqueeDurationMs = region.marqueeDurationMs ?? translationMarqueeDurationMs(sourceText, region.translated)
  const style = { left, top, width, height, fontSize: layout.fontSize, fontFamily: region.fontFamily === 'serif' ? '"Noto Serif JP", serif' : '"Noto Sans JP", sans-serif', '--blur': `${overlay.blur}px`, '--opacity': overlay.opacity / 100, '--overlay-pad-x': `${layout.paddingX}px`, '--marquee-distance': `${layout.scrollDistance}px`, '--marquee-duration': `${marqueeDurationMs}ms` } as CSSProperties
  return <div className={`translation-overlay ${layout.scrolling ? 'scrolling' : ''}`} style={style}><span>{region.translated}</span></div>
}

function App() {
  const [clientPlatform, setClientPlatform] = useState(() => detectClientPlatform())
  const mobileClient = clientPlatform === 'android' || clientPlatform === 'ios'
  const videoRef = useRef<HTMLVideoElement>(null), usbDisplayRef = useRef<HTMLCanvasElement>(null), canvasRef = useRef<HTMLCanvasElement>(null), selectionCanvasRef = useRef<HTMLCanvasElement>(null), stageRef = useRef<HTMLDivElement>(null)
  const busyRef = useRef(false)
  const pendingFrameRef = useRef<FrameProcessOptions | null>(null)
  const processFrameRef = useRef<(options?: FrameProcessOptions) => Promise<void>>(async () => {})
  const nativeFullscreenOwnedRef = useRef(false)
  const stabilizerRef = useRef(new DialogueStabilizer())
  const marqueeLocksRef = useRef(new TranslationMarqueeLocks())
  const trackedTranslationsRef = useRef(new Map<string, { source: string; text: string; engine: TranslationEngineId }>())
  const translationRetryRef = useRef(new Map<string, { source: string; retryAt: number }>())
  const translationBusyRef = useRef(false)
  const translationEpochRef = useRef(0)
  const latestVisibleRegionsRef = useRef<TextRegion[]>([])
  const [devices, setDevices] = useState<VideoInputDevice[]>([]), [deviceId, setDeviceId] = useState('')
  const [devicePermission, setDevicePermission] = useState<'unknown' | 'granted' | 'denied'>('unknown'), [scanning, setScanning] = useState(false)
  const [stream, setStream] = useState<MediaStream | null>(null), [running, setRunning] = useState(false), [error, setError] = useState('')
  const [usbInput, setUsbInput] = useState<{ active: boolean; label: string }>({ active: false, label: '' })
  const [regions, setRegions] = useState<TextRegion[]>([]), [latency, setLatency] = useState<LatencySample>(emptyLatency)
  const [frameSize, setFrameSize] = useState({ sourceWidth: 0, sourceHeight: 0, captureWidth: 1, captureHeight: 1 })
  const [videoRect, setVideoRect] = useState({ left: 0, top: 0, width: 1, height: 1 })
  const [progress, setProgress] = useState<OcrProgress>({ status: '等待输入', progress: 0 })
  const [knowledgeServices] = useState(() => {
    const contributions = browserContributionQueue(), memory = browserTranslationMemory(contributions), dictionaries = browserDictionaryPacks()
    const router = new TranslationRouter(translationRuntimes, memory, new EntityLearningQueue(memory, new ConfigurableEntityLookup()), dictionaries)
    return { router, contributions, dictionaries, distribution: new HttpDictionaryDistributionProvider(communityOrigin) }
  })
  const routerRef = useRef(knowledgeServices.router)
  const [routing, setRouting] = useState<TranslationRoutingSettings>(() => ({ ...defaultRoutingSettings, entitySearch: loadEntitySearchSettings() }))
  const [runtimeStatus, setRuntimeStatus] = useState<Record<TranslationEngineId, boolean>>({ translategemma: false })
  const [llamaBackend, setLlamaBackend] = useState<LlamaBackend>('cpu')
  const [knowledgeStats, setKnowledgeStats] = useState({ translations: 0, learnedTerms: 0, pendingTerms: 0 })
  const [sharingEnabled, setSharingEnabled] = useState(knowledgeServices.contributions.isEnabled()), [sharingPending, setSharingPending] = useState(knowledgeServices.contributions.pendingCount())
  const [communityApiKey, setCommunityApiKey] = useState(loadCommunityApiKey()), [dictionaryStatus, setDictionaryStatus] = useState(() => knowledgeServices.dictionaries.status(defaultRoutingSettings.gameId))
  const [dictionaryReady, setDictionaryReady] = useState(false)
  const [communityStatus, setCommunityStatus] = useState('')
  const [contextTurns, setContextTurns] = useState(0)
  const [installingModel, setInstallingModel] = useState(false)
  const [modelUrl, setModelUrl] = useState('')
  const [modelStatusMessage, setModelStatusMessage] = useState('')
  // Mobile CPUs need a short idle window between ONNX passes so preview and
  // llama.cpp remain responsive. Desktop keeps the lower-latency default.
  const [ocr, setOcr] = useState<OcrSettings>(() => {
    const savedEngine = typeof localStorage !== 'undefined' ? localStorage.getItem(ocrEngineStorageKey) : null
    return { intervalMs: mobileClient ? 1250 : 500, confidence: 25, language: 'jpn', scanMode: 'switch', engine: clientPlatform === 'ios' ? 'apple-vision' : clientPlatform === 'macos' && savedEngine === 'apple-vision' ? 'apple-vision' : 'meiki' }
  })
  const [overlay, setOverlay] = useState<OverlaySettings>({ enabled: true, blur: 14, opacity: 92, fontScale: 1 })
  const [expandedPreview, setExpandedPreview] = useState(false), [fullscreenPreview, setFullscreenPreview] = useState(mobileClient), [playbackPaused, setPlaybackPaused] = useState(false)
  const [selectingRegion, setSelectingRegion] = useState(false), [captureSelection, setCaptureSelection] = useState<NormalizedSelection | null>(null)
  const [diagnosticLogs, setDiagnosticLogs] = useState<DiagnosticLogEntry[]>(diagnosticLogEntries)
  const diagnosticLogRef = useRef<HTMLDivElement>(null)
  const inputActive = Boolean(stream) || usbInput.active

  useEffect(() => {
    if (!isTauri()) return
    void invoke<ClientPlatform>('client_platform').then(setClientPlatform).catch(() => undefined)
  }, [])

  const refreshDevices = useCallback(async () => {
    const mediaInputs = navigator.mediaDevices ? (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'videoinput').map((device, index) => ({ id: device.deviceId, label: device.label || `未授权视频设备 ${index + 1}`, source: 'media' as const })) : []
    const usbInputs = mobileClient ? await listUsbVideoDevices().catch((reason) => { writeDiagnosticLog('系统', 'USB UVC 枚举失败', errorMessage(reason, '无法读取 USB 视频设备'), 'warning'); return [] }) : []
    const nativeLabels = new Set(usbInputs.map((device) => device.label.trim().toLocaleLowerCase()).filter(Boolean))
    const inputs: VideoInputDevice[] = [...usbInputs.map((device) => ({ id: `usb:${device.id}`, label: `${device.label} · USB UVC`, source: 'usb' as const })), ...mediaInputs.filter((device) => !nativeLabels.has(device.label.trim().toLocaleLowerCase()))]
    setDevices(inputs)
      // USB enumeration does not mean the mobile camera permission is granted.
      // Android requires a separate UVC grant; iPadOS uses AVFoundation access.
      // can receive its separate per-device USB authorization.
      if (mediaInputs.some((device) => device.label)) setDevicePermission('granted')
    setDeviceId((current) => inputs.some((device) => device.id === current) ? current : inputs[0]?.id || '')
  }, [mobileClient])
  // Device enumeration is an external media-system subscription.
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { void refreshDevices(); navigator.mediaDevices?.addEventListener('devicechange', refreshDevices); return () => navigator.mediaDevices?.removeEventListener('devicechange', refreshDevices) }, [refreshDevices])
  useEffect(() => {
    if (!mobileClient || inputActive) return
    const timer = window.setInterval(() => { if (!document.hidden) void refreshDevices() }, 10_000)
    return () => window.clearInterval(timer)
  }, [mobileClient, inputActive, refreshDevices])
  useEffect(() => subscribeDiagnosticLog((entry) => setDiagnosticLogs((current) => [...current, entry].slice(-300))), [])
  useEffect(() => { const element = diagnosticLogRef.current; if (element) element.scrollTop = element.scrollHeight }, [diagnosticLogs])
  useEffect(() => {
    if (!mobileClient) return
    writeDiagnosticLog('系统', `${clientPlatform === 'ios' ? 'iPad' : 'Android'} 展示模式`, '启动时默认进入画面全屏并显示悬浮工具条', 'success')
    // Native platform detection may finish after the first React render.
    // oxlint-disable-next-line react/set-state-in-effect
    setFullscreenPreview(true)
    // oxlint-disable-next-line react/set-state-in-effect
    setOcr((current) => ({ ...current, intervalMs: current.intervalMs === 500 ? 1250 : current.intervalMs, engine: clientPlatform === 'ios' ? 'apple-vision' : current.engine }))
    if (!isTauri()) return
    nativeFullscreenOwnedRef.current = true
    void getCurrentWindow().setFullscreen(true).catch((reason) => writeDiagnosticLog('系统', '移动端原生全屏失败', errorMessage(reason, '继续使用应用内全屏'), 'warning'))
  }, [clientPlatform, mobileClient])
  useEffect(() => {
    if (clientPlatform !== 'macos') return
    localStorage.setItem(ocrEngineStorageKey, ocr.engine)
    if (ocr.engine === 'apple-vision') void disposeOcr()
  }, [clientPlatform, ocr.engine])
  useEffect(() => { void translationRuntimeStatus().then(setRuntimeStatus); setKnowledgeStats(routerRef.current.getKnowledgeState()); setSharingPending(knowledgeServices.contributions.pendingCount()) }, [knowledgeServices])
  useEffect(() => {
    if (clientPlatform !== 'windows') return
    void getTranslateGemmaBackend().then(({ backend }) => setLlamaBackend(backend)).catch((reason) => writeDiagnosticLog('LLM', '读取推理后端失败', errorMessage(reason, '继续使用 CPU'), 'warning'))
  }, [clientPlatform])
  useEffect(() => {
    let active = true
    // Remote dictionary synchronization is an external system subscription.
    // oxlint-disable-next-line react/set-state-in-effect
    setDictionaryReady(false)
    setCommunityStatus('正在同步远程词库…')
    const gameIds = [...new Set(['general', routing.gameId])]
    void Promise.all(gameIds.map((gameId) => knowledgeServices.dictionaries.sync(gameId, knowledgeServices.distribution))).then(() => { if (active) { setDictionaryStatus(knowledgeServices.dictionaries.status(routing.gameId)); setCommunityStatus('远程词库已同步'); setDictionaryReady(true); writeDiagnosticLog('词库', '远程词库同步完成', gameIds.join('、'), 'success') } }).catch((reason) => { if (active) { setDictionaryStatus(knowledgeServices.dictionaries.status(routing.gameId)); setCommunityStatus('远程词库暂时不可用，继续使用本地缓存'); setDictionaryReady(true); writeDiagnosticLog('词库', '远程词库同步失败', errorMessage(reason, '继续使用本地缓存'), 'warning') } })
    return () => { active = false }
  }, [knowledgeServices, routing.gameId])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage || !frameSize.sourceWidth || !frameSize.sourceHeight) return
    const update = () => {
      const stageWidth = stage.clientWidth, stageHeight = stage.clientHeight, sourceRatio = frameSize.sourceWidth / frameSize.sourceHeight
      let width = stageWidth, height = width / sourceRatio, left = 0, top = (stageHeight - height) / 2
      if (height > stageHeight) { height = stageHeight; width = height * sourceRatio; top = 0; left = (stageWidth - width) / 2 }
      setVideoRect({ left, top, width, height })
    }
    update(); const observer = new ResizeObserver(update); observer.observe(stage); return () => observer.disconnect()
  }, [frameSize.sourceHeight, frameSize.sourceWidth])

  const authorizeAndScan = useCallback(async () => {
    if (!navigator.mediaDevices) { setError('当前环境不支持摄像头或采集卡访问。'); return }
    setScanning(true); setError('')
    try {
      // Device labels are intentionally hidden by macOS/browser privacy rules until
      // the user grants camera access at least once for this origin/application.
      const permissionStream = stream ?? await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      await refreshDevices()
      if (!stream) permissionStream.getTracks().forEach((track) => track.stop())
      setDevicePermission('granted')
    } catch (reason) {
      setDevicePermission('denied')
      setError(`无法读取视频设备：${errorMessage(reason, '摄像头权限被拒绝，请在系统设置中允许 NSTrans 访问摄像头。')}`)
    } finally { setScanning(false) }
  }, [refreshDevices, stream])

  const stopInput = useCallback(async () => { if (stream || usbInput.active) writeDiagnosticLog('OCR', '输入源已断开', stream?.getVideoTracks()[0]?.label || usbInput.label || '视频设备', 'warning'); stream?.getTracks().forEach((track) => track.stop()); if (usbInput.active) await closeUsbVideoDevice().catch(() => undefined); const usbDisplay = usbDisplayRef.current; if (usbDisplay) usbDisplay.getContext('2d')?.clearRect(0, 0, usbDisplay.width, usbDisplay.height); translationEpochRef.current++; stabilizerRef.current.reset(); marqueeLocksRef.current.clear(); trackedTranslationsRef.current.clear(); translationRetryRef.current.clear(); setStream(null); setUsbInput({ active: false, label: '' }); setRunning(false); setPlaybackPaused(false); setSelectingRegion(false); setCaptureSelection(null); setRegions([]) }, [stream, usbInput])
  const startInput = useCallback(async (requestedDeviceId = deviceId) => {
    setError(''); await stopInput()
    try {
      if (requestedDeviceId.startsWith('usb:')) {
        const result = await openUsbVideoDevice(requestedDeviceId.slice(4))
        if (!result.available) throw new Error(result.error || '无法打开 USB 采集卡')
        setUsbInput({ active: true, label: result.label })
        setFrameSize({ sourceWidth: result.width, sourceHeight: result.height, captureWidth: result.width, captureHeight: result.height })
        setRunning(true); setDevicePermission('granted')
        writeDiagnosticLog('OCR', 'USB UVC 输入已打开', `${result.label} · ${result.width} × ${result.height}`, 'success')
        return
      }
      const next = await navigator.mediaDevices.getUserMedia({ video: requestedDeviceId ? { deviceId: { exact: requestedDeviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } } : true, audio: false })
      setStream(next)
      const activeDeviceId = next.getVideoTracks()[0]?.getSettings().deviceId
      if (activeDeviceId) setDeviceId(activeDeviceId)
      if (videoRef.current) { videoRef.current.srcObject = next; await videoRef.current.play() }
      setRunning(true); setDevicePermission('granted'); await refreshDevices()
      writeDiagnosticLog('OCR', 'OCR 启动', `${next.getVideoTracks()[0]?.label || '视频设备'} · ${ocr.scanMode} · ${ocr.language}`, 'success')
    } catch (reason) { const message = errorMessage(reason, '无法打开输入源'); setError(message); writeDiagnosticLog('系统', '输入源打开失败', message, 'error') }
  }, [deviceId, ocr.language, ocr.scanMode, refreshDevices, stopInput])
  useEffect(() => () => { stream?.getTracks().forEach((track) => track.stop()) }, [stream])
  useEffect(() => () => { if (usbInput.active) void closeUsbVideoDevice() }, [usbInput.active])
  useEffect(() => {
    if (!usbInput.active || !running || playbackPaused) return
    let active = true, timer = 0
    const next = async () => {
      try {
        const frame = await readUsbVideoFrame()
        const decodedFrame = new Image()
        decodedFrame.src = `data:image/jpeg;base64,${frame.imageBase64}`
        // Keep the previous frame visible while WebKit decodes the next JPEG.
        // Replacing a visible <img src> first can briefly paint an empty/recycled
        // image buffer on iPadOS, which looks like capture-card flicker.
        await decodedFrame.decode()
        const display = usbDisplayRef.current
        if (active && display) {
          if (display.width !== frame.width) display.width = frame.width
          if (display.height !== frame.height) display.height = frame.height
          const context = display.getContext('2d', { alpha: false })
          context?.drawImage(decodedFrame, 0, 0, frame.width, frame.height)
          setFrameSize((current) => current.sourceWidth === frame.width && current.sourceHeight === frame.height ? current : { sourceWidth: frame.width, sourceHeight: frame.height, captureWidth: frame.width, captureHeight: frame.height })
        }
      } catch (reason) {
        if (active && !String(reason).includes('正在等待')) writeDiagnosticLog('系统', 'USB UVC 取帧失败', errorMessage(reason, '无法读取采集卡画面'), 'warning', 5_000)
      } finally { if (active) timer = window.setTimeout(next, 120) }
    }
    void next()
    return () => { active = false; window.clearTimeout(timer) }
  }, [playbackPaused, running, usbInput.active])
  useEffect(() => () => { void disposeOcr() }, [])
  useEffect(() => {
    if (!mobileClient || !isTauri()) return
    const releaseHeavyModel = () => {
      if (!document.hidden) return
      void unloadTranslateGemma().then(() => writeDiagnosticLog('LLM', '后台资源已释放', '返回应用后将在需要翻译时重新载入模型', 'info')).catch(() => undefined)
      void disposeOcr().then(() => writeDiagnosticLog('OCR', '后台资源已释放', '返回应用后将在下一次识别时重新载入模型', 'info')).catch(() => undefined)
    }
    document.addEventListener('visibilitychange', releaseHeavyModel)
    window.addEventListener('pagehide', releaseHeavyModel)
    return () => {
      document.removeEventListener('visibilitychange', releaseHeavyModel)
      window.removeEventListener('pagehide', releaseHeavyModel)
    }
  }, [mobileClient])
  useEffect(() => {
    if (!isTauri() || !fullscreenPreview) return
    const window = getCurrentWindow()
    let unlisten: (() => void) | undefined
    void window.onResized(async () => {
      if (nativeFullscreenOwnedRef.current && !await window.isFullscreen()) {
        nativeFullscreenOwnedRef.current = false
        setFullscreenPreview(false)
      }
    }).then((value) => { unlisten = value })
    return () => unlisten?.()
  }, [fullscreenPreview])
  const processFrame = useCallback(async (options: FrameProcessOptions = {}) => {
    const video = videoRef.current, usbDisplay = usbDisplayRef.current, canvas = canvasRef.current
    const source: CanvasImageSource | null = usbInput.active ? usbDisplay : video
    const sourceWidth = usbInput.active ? usbDisplay?.width ?? 0 : video?.videoWidth ?? 0
    const sourceHeight = usbInput.active ? usbDisplay?.height ?? 0 : video?.videoHeight ?? 0
    const sourceReady = usbInput.active ? Boolean(usbDisplay && sourceWidth > 1 && sourceHeight > 1) : Boolean(video && video.readyState >= 2)
    if (!source || !canvas || !sourceReady || playbackPaused && !options.force) return
    if (busyRef.current) { if (options.force) pendingFrameRef.current = options; return }
    busyRef.current = true; const totalStart = performance.now()
    try {
      if (options.resetContext) { translationEpochRef.current++; routerRef.current.resetContext(); setContextTurns(0) }
      if (options.force) { translationEpochRef.current++; stabilizerRef.current.reset(); marqueeLocksRef.current.clear(); trackedTranslationsRef.current.clear(); translationRetryRef.current.clear(); setRegions([]) }
      const captureStart = performance.now(), size = fitCaptureSize(sourceWidth, sourceHeight)
      canvas.width = size.width; canvas.height = size.height; canvas.getContext('2d', { willReadFrequently: true })?.drawImage(source, 0, 0, size.width, size.height)
      setFrameSize({ sourceWidth, sourceHeight, captureWidth: size.width, captureHeight: size.height })
      const capture = performance.now() - captureStart, ocrStart = performance.now()
      const selection = options.fullFrame ? null : options.selectionOverride !== undefined ? options.selectionOverride : captureSelection
      let ocrCanvas = canvas, crop: ReturnType<typeof selectionCanvasRect> | null = null
      if (selection && selectionCanvasRef.current) {
        crop = selectionCanvasRect(selection, canvas.width, canvas.height)
        selectionCanvasRef.current.width = crop.width; selectionCanvasRef.current.height = crop.height
        selectionCanvasRef.current.getContext('2d', { willReadFrequently: true })?.drawImage(canvas, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height)
        ocrCanvas = selectionCanvasRef.current
      }
      const detectedRegions = await recognizeJapanese(ocrCanvas, ocr.language, ocr.confidence, options.fullFrame || selection ? 'full' : ocr.scanMode, setProgress, ocr.engine)
      const nextRegions = crop ? offsetTextRegions(detectedRegions, crop.x, crop.y) : detectedRegions
      const ocrTime = performance.now() - ocrStart
      const observation = stabilizerRef.current.observe(nextRegions)
      latestVisibleRegionsRef.current = observation.visible
      const lockTime = performance.now()
      marqueeLocksRef.current.prune(lockTime)
      const activeIds = new Set(observation.visible.map(({ id }) => id))
      for (const id of trackedTranslationsRef.current.keys()) if (!activeIds.has(id)) trackedTranslationsRef.current.delete(id)
      for (const id of translationRetryRef.current.keys()) if (!activeIds.has(id)) translationRetryRef.current.delete(id)
      const ready = observation.ready.filter((region) => {
        if (marqueeLocksRef.current.find(region, lockTime)) return false
        const retry = translationRetryRef.current.get(region.id)
        return !retry || retry.source !== region.source || retry.retryAt <= lockTime
      })
      // Move existing translations to the newest OCR boxes before waiting for
      // terminology lookup/LLM. Previously the whole overlay remained attached
      // to an older frame throughout inference, which looked like OCR offset.
      setRegions(observation.visible.map((region) => {
        const lock = marqueeLocksRef.current.find(region, lockTime)
        if (lock) return { ...region, translated: lock.text, translationEngine: lock.engine, translationSource: lock.source, marqueeDurationMs: lock.durationMs }
        const saved = trackedTranslationsRef.current.get(region.id)
        return saved?.source === region.source ? { ...region, translated: saved.text, translationEngine: saved.engine, translationSource: saved.source } : region
      }))
      if (ready.length && dictionaryReady && !translationBusyRef.current) {
        translationBusyRef.current = true
        const translationEpoch = translationEpochRef.current
        const translationStartedAt = performance.now()
        const requests = ready.map((region) => ({ text: region.source, sourceLanguage: 'ja', targetLanguage: 'zh-Hans' }))
        void routerRef.current.translate(requests, routing).then((translations) => {
          if (translationEpoch !== translationEpochRef.current) { routerRef.current.resetContext(); setContextTurns(0); return }
          ready.forEach((region, index) => {
            if (!stabilizerRef.current.isCurrent(region.id, region.source)) return
            const result = translations[index]
            if (!result?.text) {
              translationRetryRef.current.set(region.id, { source: region.source, retryAt: performance.now() + 5_000 })
              return
            }
            translationRetryRef.current.delete(region.id)
            trackedTranslationsRef.current.set(region.id, { source: region.source, text: result.text, engine: result.engine ?? 'translategemma' })
            const layout = translationOverlayLayout(region.source, result.text, region.box.x1 - region.box.x0, region.box.y1 - region.box.y0, overlay.fontScale)
            marqueeLocksRef.current.start(region, result.text, result.engine ?? 'translategemma', performance.now(), layout.scrolling)
            stabilizerRef.current.commit(region.id, region.source)
          })
          const completedAt = performance.now()
          setRegions(latestVisibleRegionsRef.current.map((region) => {
            const lock = marqueeLocksRef.current.find(region, completedAt)
            if (lock) return { ...region, translated: lock.text, translationEngine: lock.engine, translationSource: lock.source, marqueeDurationMs: lock.durationMs }
            const saved = trackedTranslationsRef.current.get(region.id)
            return saved?.source === region.source ? { ...region, translated: saved.text, translationEngine: saved.engine, translationSource: saved.source } : region
          }))
          setContextTurns(routerRef.current.getContextState().turns)
          setKnowledgeStats(routerRef.current.getKnowledgeState())
          setLatency((current) => ({ ...current, translate: completedAt - translationStartedAt }))
        }).catch((reason) => {
          const message = errorMessage(reason, '翻译请求失败')
          ready.forEach((region) => translationRetryRef.current.set(region.id, { source: region.source, retryAt: performance.now() + 5_000 }))
          writeDiagnosticLog('LLM', '异步翻译失败', message, 'error', 2_000)
        }).finally(() => { translationBusyRef.current = false })
      }
      const renderTime = performance.now()
      const translated = observation.visible.map((region) => {
        const lock = marqueeLocksRef.current.find(region, renderTime)
        if (lock) return { ...region, translated: lock.text, translationEngine: lock.engine, translationSource: lock.source, marqueeDurationMs: lock.durationMs }
        const saved = trackedTranslationsRef.current.get(region.id)
        return saved?.source === region.source ? { ...region, translated: saved.text, translationEngine: saved.engine, translationSource: saved.source } : region
      })
      setContextTurns(routerRef.current.getContextState().turns)
      setKnowledgeStats(routerRef.current.getKnowledgeState())
      const pendingContributions = knowledgeServices.contributions.pendingCount(); setSharingPending(pendingContributions)
      if (sharingEnabled && communityApiKey && pendingContributions) void knowledgeServices.contributions.flush(new HttpContributionUploader(communityOrigin, communityApiKey)).then(() => { setSharingPending(knowledgeServices.contributions.pendingCount()); setCommunityStatus('社区贡献已上传') }).catch(() => setCommunityStatus('贡献上传失败，请检查 API Key 或网络'))
      const renderStart = performance.now(); setRegions(translated)
      requestAnimationFrame(() => { const render = performance.now() - renderStart; setLatency((current) => ({ capture, ocr: ocrTime, translate: current.translate, render, total: performance.now() - totalStart })) })
    } catch (reason) { const message = errorMessage(reason, '处理画面时发生错误'); setError(message); writeDiagnosticLog('系统', '画面处理失败', message, 'error', 2_000) } finally { busyRef.current = false; const pending = pendingFrameRef.current; pendingFrameRef.current = null; if (pending) queueMicrotask(() => void processFrameRef.current(pending)) }
  }, [captureSelection, communityApiKey, dictionaryReady, knowledgeServices, ocr.confidence, ocr.engine, ocr.language, ocr.scanMode, overlay.fontScale, playbackPaused, routing, sharingEnabled, usbInput.active])
  useEffect(() => { processFrameRef.current = processFrame }, [processFrame])
  // Wait one full interval *after* a recognition pass. setInterval immediately
  // restarted expensive ONNX work whenever a slow pass crossed several ticks,
  // leaving mobile devices permanently CPU-saturated.
  useEffect(() => {
    if (!running || playbackPaused) return
    let active = true, timer = 0
    const next = async () => {
      await processFrame()
      if (active) timer = window.setTimeout(next, ocr.intervalMs)
    }
    void next()
    return () => { active = false; window.clearTimeout(timer) }
  }, [running, playbackPaused, ocr.intervalMs, processFrame])

  const retranslateFrame = async (options: FrameProcessOptions = {}) => { await processFrame({ ...options, force: true }) }
  const toggleFullscreen = async () => {
    if (fullscreenPreview) {
      setFullscreenPreview(false)
      if (isTauri() && nativeFullscreenOwnedRef.current) await getCurrentWindow().setFullscreen(false)
      nativeFullscreenOwnedRef.current = false
      return
    }
    setExpandedPreview(false)
    if (isTauri()) {
      const window = getCurrentWindow(), alreadyFullscreen = await window.isFullscreen()
      nativeFullscreenOwnedRef.current = !alreadyFullscreen
      if (!alreadyFullscreen) await window.setFullscreen(true)
    }
    setFullscreenPreview(true)
  }
  const toggleExpandedPreview = () => { if (expandedPreview && playbackPaused) { setPlaybackPaused(false); if (!usbInput.active) void videoRef.current?.play() }; setExpandedPreview((current) => !current) }
  const exitPresentation = async () => {
    if (playbackPaused) { setPlaybackPaused(false); if (!usbInput.active) await videoRef.current?.play() }
    setExpandedPreview(false); setFullscreenPreview(false)
    if (isTauri() && nativeFullscreenOwnedRef.current) await getCurrentWindow().setFullscreen(false)
    nativeFullscreenOwnedRef.current = false
  }
  const togglePlaybackPause = async () => {
    const video = videoRef.current
    if (playbackPaused) { setPlaybackPaused(false); if (!usbInput.active) await video?.play(); await retranslateFrame({ selectionOverride: captureSelection }); return }
    if (!usbInput.active) video?.pause(); setPlaybackPaused(true); await retranslateFrame({ fullFrame: true })
  }
  const completeSelection = async (selection: NormalizedSelection) => { setCaptureSelection(selection); setSelectingRegion(false); await retranslateFrame({ selectionOverride: selection }) }
  const clearSelection = async () => { setCaptureSelection(null); setSelectingRegion(false); await retranslateFrame({ selectionOverride: null }) }
  const toggleRegionSelection = async () => {
    if (selectingRegion || captureSelection) { await clearSelection(); return }
    setSelectingRegion(true)
  }
  const resetContextAndRetranslate = async () => { await retranslateFrame({ selectionOverride: captureSelection, fullFrame: playbackPaused && !captureSelection, resetContext: true }) }
  const averageConfidence = useMemo(() => regions.length ? Math.round(regions.reduce((sum, item) => sum + item.confidence, 0) / regions.length) : 0, [regions])
  const selectedGame = getGameProfile(routing.gameId)
  const presentationMode = expandedPreview || fullscreenPreview
  const selectGame = (gameId: GameId) => {
    setDictionaryReady(false)
    routerRef.current.resetContext()
    stabilizerRef.current.reset()
    marqueeLocksRef.current.clear()
    trackedTranslationsRef.current.clear()
    translationRetryRef.current.clear()
    setRegions([])
    setContextTurns(0)
    setRouting((current) => ({ ...current, gameId }))
  }
  const toggleKnowledgeSharing = () => { const enabled = !sharingEnabled; knowledgeServices.contributions.setEnabled(enabled); setSharingEnabled(enabled); setSharingPending(knowledgeServices.contributions.pendingCount()) }
  const updateEntitySearch = (patch: Partial<TranslationRoutingSettings['entitySearch']>) => setRouting((current) => {
    const entitySearch = { ...current.entitySearch, ...patch }
    if (entitySearch.fallback === entitySearch.primary) entitySearch.fallback = 'none'
    saveEntitySearchSettings(entitySearch)
    return { ...current, entitySearch }
  })
  const saveApiKeyAndUpload = async () => {
    const key = communityApiKey.trim(); saveCommunityApiKey(key); setCommunityApiKey(key)
    if (!key) { setCommunityStatus('客户端 API Key 已清除'); return }
    try { const uploaded = await knowledgeServices.contributions.flush(new HttpContributionUploader(communityOrigin, key)); setSharingPending(knowledgeServices.contributions.pendingCount()); setCommunityStatus(uploaded ? `已上传 ${uploaded} 条贡献` : 'API Key 已保存') } catch { setCommunityStatus('Key 无效或服务器暂时不可用') }
  }
  const runModelAction = async (action: () => Promise<void>, working: string, completed: string) => {
    setInstallingModel(true); setError(''); setModelStatusMessage(working)
    try { await action(); setRuntimeStatus(await translationRuntimeStatus()); setModelStatusMessage(completed) }
    catch (reason) { const message = errorMessage(reason, '模型处理失败'); setError(message); setModelStatusMessage(message) }
    finally { setInstallingModel(false) }
  }
  const downloadTranslateGemma = () => runModelAction(installTranslateGemma, `正在下载 TranslateGemma 4B ${clientPlatform === 'ios' ? 'IQ4_XS（约 2.4GB）' : 'Q4_K_M（约 3.3GB）'}…`, 'TranslateGemma 4B 已启用')
  const downloadModelUrl = () => {
    const url = modelUrl.trim()
    if (!url) { setError('请先输入 GGUF 模型 URL'); return }
    void runModelAction(() => installTranslateGemmaFromUrl(url), '正在下载并校验指定 URL…', 'URL 模型已导入并启用')
  }
  const selectLocalModel = async () => {
    setInstallingModel(true); setError(''); setModelStatusMessage('请选择本地 GGUF 模型…')
    try {
      const imported = await pickAndImportTranslateGemmaFile()
      if (!imported) { setModelStatusMessage('已取消选择'); return }
      setRuntimeStatus(await translationRuntimeStatus()); setModelStatusMessage('本地模型已导入并启用')
    } catch (reason) {
      const message = errorMessage(reason, '模型处理失败'); setError(message); setModelStatusMessage(message)
    } finally { setInstallingModel(false) }
  }
  const selectLlamaBackend = async (backend: LlamaBackend) => {
    setInstallingModel(true); setError('')
    try {
      const selected = await setTranslateGemmaBackend(backend)
      setLlamaBackend(selected.backend)
      writeDiagnosticLog('LLM', 'Windows 推理后端已切换', selected.backend.toUpperCase(), 'success')
      setRuntimeStatus(await translationRuntimeStatus())
    } catch (reason) {
      const message = errorMessage(reason, '无法切换推理后端'); setError(message); writeDiagnosticLog('LLM', '推理后端切换失败', message, 'error')
    } finally { setInstallingModel(false) }
  }

  return <main className={`app-shell ${mobileClient ? 'android-client' : ''} ${clientPlatform === 'ios' ? 'ios-client' : ''} ${expandedPreview ? 'preview-expanded' : ''} ${fullscreenPreview ? 'preview-fullscreen' : ''}`}>
    <header className="topbar"><div className="brand"><span className="brand-mark"><ScanText size={19} /></span><span>NSTrans</span><small>LIVE OCR</small></div><div className="top-status"><span className={`status-dot ${running ? 'live' : ''}`} />{running ? '实时处理中' : '待机'}<span className="divider" />日本語 → 简体中文</div><button className="icon-button" title="设置"><Settings2 size={18} /></button></header>
    <section className="workspace">
      <div className="preview-card panel"><div className="panel-heading"><div><Video size={16} /><strong>画面预览</strong><span className="chip">{inputActive ? 'LIVE' : 'NO SIGNAL'}</span></div><div className="window-actions"><button onClick={toggleExpandedPreview} title="全窗口显示"><Expand size={16} /></button><button onClick={() => void toggleFullscreen()} title="整屏全屏显示"><Maximize size={16} /></button></div></div>
        <div className={`video-stage ${expandedPreview ? 'expanded' : ''} ${fullscreenPreview ? 'window-fullscreen' : ''}`} ref={stageRef}><video ref={videoRef} muted playsInline style={{ display: usbInput.active ? 'none' : undefined }} />{usbInput.active && <canvas ref={usbDisplayRef} className="usb-video-frame" role="img" aria-label="USB 采集卡实时画面" />}<canvas ref={canvasRef} hidden /><canvas ref={selectionCanvasRef} hidden />
          {!inputActive && <div className="empty-video"><Camera size={34} /><span>选择输入源并启动预览</span><small>支持 USB 采集卡与摄像头</small></div>}
          {clientPlatform !== 'ios' && inputActive && progress.status === 'meikiocr-loading' && <div className="ocr-loading-banner"><LoaderCircle className="spin" size={16} /><div><strong>正在加载 MeikiOCR</strong><small>{progress.detail}</small></div></div>}
          {inputActive && overlay.enabled && regions.filter((region) => region.translated).map((region) => <TranslationOverlay region={region} frameSize={frameSize} videoRect={videoRect} overlay={overlay} key={region.id} />)}
          {captureSelection && <div className="active-capture-selection" style={{ left: videoRect.left + captureSelection.x0 * videoRect.width, top: videoRect.top + captureSelection.y0 * videoRect.height, width: (captureSelection.x1 - captureSelection.x0) * videoRect.width, height: (captureSelection.y1 - captureSelection.y0) * videoRect.height }} />}
          {presentationMode && <PresentationToolbar paused={playbackPaused} selecting={selectingRegion} hasSelection={Boolean(captureSelection)} mediaAvailable={inputActive} onTogglePause={() => void togglePlaybackPause()} onSelect={() => void toggleRegionSelection()} onReset={() => void resetContextAndRetranslate()} onClearSelection={() => void clearSelection()} onExit={() => void exitPresentation()} />}
          {presentationMode && selectingRegion && <div className="selection-layer" style={{ left: videoRect.left, top: videoRect.top, width: videoRect.width, height: videoRect.height }}><SelectionOverlay width={videoRect.width} height={videoRect.height} onComplete={(selection) => void completeSelection(selection)} onCancel={() => setSelectingRegion(false)} /></div>}
          <div className="stage-footer"><span>{frameSize.sourceWidth} × {frameSize.sourceHeight}</span><span>{regions.length} 个文本区域</span></div>
        </div>
      </div>
      <div className="control-grid">
        <ControlPanel title="输入源" icon={<Video size={16} />}><div className="label-row"><label>系统与 USB 视频设备</label><span>{devices.length ? `已发现 ${devices.length} 个` : '等待设备'}</span></div><div className="select-wrap"><select value={deviceId} disabled={!devices.length} onChange={(event) => { const nextId = event.target.value; setDeviceId(nextId); if (inputActive) void startInput(nextId) }}>{devices.length ? devices.map((device) => <option value={device.id} key={device.id}>{device.label}</option>) : <option value="">未发现摄像头或采集卡</option>}</select><ChevronDown size={15} /></div>{devicePermission !== 'granted' && !devices.some((device) => device.source === 'usb') && <button className="scan-button" onClick={() => void authorizeAndScan()} disabled={scanning}>{scanning ? <LoaderCircle className="spin" size={15} /> : <Camera size={15} />}{scanning ? '正在读取系统设备…' : '授权并扫描摄像头'}</button>}<div className="button-row"><button className="primary" disabled={!devices.length} onClick={running ? () => { setRunning(false); writeDiagnosticLog('OCR', 'OCR 已暂停', undefined, 'warning') } : () => void startInput()}>{running ? <Pause size={15} /> : <Play size={15} />}{running ? '暂停识别' : '启动预览'}</button><button className="secondary" onClick={() => void refreshDevices()} disabled={scanning}><RefreshCw size={15} />重新扫描</button></div>{devicePermission === 'denied' && <div className="notice">相机权限被拒绝；Android 也需要此权限才能授权 USB 视频采集卡，请在系统设置中允许 NSTrans 使用相机。</div>}{inputActive && <button className="text-button" onClick={() => void stopInput()}>断开当前输入源</button>}</ControlPanel>
        <ControlPanel title="OCR 识别" icon={<ScanText size={16} />}>{clientPlatform === 'windows' && <div className="engine-status"><EngineState label="MeikiOCR · Windows 离线引擎" ready /></div>}{clientPlatform === 'macos' && <><label>OCR 引擎</label><div className="segmented"><button className={ocr.engine === 'meiki' ? 'active' : ''} onClick={() => setOcr({ ...ocr, engine: 'meiki' })}>MeikiOCR（默认）</button><button className={ocr.engine === 'apple-vision' ? 'active' : ''} onClick={() => setOcr({ ...ocr, engine: 'apple-vision' })}>Apple Vision</button></div><small className="muted">切换后从下一次扫描生效；所选引擎不可用时会自动回退。</small></>}<label>场景策略</label><div className="segmented three"><button className={ocr.scanMode === 'switch' ? 'active' : ''} onClick={() => setOcr({ ...ocr, scanMode: 'switch' })}>Switch 游戏</button><button className={ocr.scanMode === 'subtitles' ? 'active' : ''} onClick={() => setOcr({ ...ocr, scanMode: 'subtitles' })}>通用字幕</button><button className={ocr.scanMode === 'full' ? 'active' : ''} onClick={() => setOcr({ ...ocr, scanMode: 'full' })}>全画面</button></div><label>识别语言</label><div className="segmented"><button className={ocr.language === 'jpn' ? 'active' : ''} onClick={() => setOcr({ ...ocr, language: 'jpn' })}>日文</button><button className={ocr.language === 'jpn+eng' ? 'active' : ''} onClick={() => setOcr({ ...ocr, language: 'jpn+eng' })}>日文 + 英文</button></div><Range label="最低置信度" value={ocr.confidence} min={0} max={100} suffix="%" onChange={(value) => setOcr({ ...ocr, confidence: value })} /><Range label="扫描间隔" value={ocr.intervalMs} min={250} max={5000} step={250} display={`${(ocr.intervalMs / 1000).toFixed(2)} s`} onChange={(value) => setOcr({ ...ocr, intervalMs: value })} /><div className="progress-line"><span style={{ width: `${progress.progress * 100}%` }} /></div><small className="muted">{progress.detail ?? translateStatus(progress.status)}</small></ControlPanel>
        <ControlPanel title="翻译与词库" icon={<Languages size={16} />}>
          <div className="inline-select"><label>游戏类别</label><div className="select-wrap"><select value={routing.gameId} onChange={(event) => selectGame(event.target.value as GameId)}>{gameOptions.map((game) => <option value={game.id} key={game.id}>{game.label}</option>)}</select><ChevronDown size={13} /></div></div>
          <div className="notice success">{selectedGame.description}</div>
          <div className="notice">远程词库：{dictionaryStatus.version ? `${dictionaryStatus.version} · ${dictionaryStatus.entries} 条` : '尚未配置服务器/未下载'}</div>
          <div className="engine-status"><EngineState label={`TranslateGemma 4B ${clientPlatform === 'ios' ? 'IQ4_XS · Metal' : clientPlatform === 'windows' ? `· llama.cpp · ${llamaBackend.toUpperCase()}` : '· 内置 llama 运行时'}`} ready={runtimeStatus.translategemma} /></div>
          {clientPlatform === 'windows' && <div className="windows-backend"><label>llama.cpp 推理后端</label><div className="segmented three"><button disabled={installingModel} className={llamaBackend === 'cuda' ? 'active' : ''} onClick={() => void selectLlamaBackend('cuda')}>CUDA</button><button disabled={installingModel} className={llamaBackend === 'vulkan' ? 'active' : ''} onClick={() => void selectLlamaBackend('vulkan')}>Vulkan</button><button disabled={installingModel} className={llamaBackend === 'cpu' ? 'active' : ''} onClick={() => void selectLlamaBackend('cpu')}>CPU</button></div><small className="muted">CUDA 适用于 NVIDIA；Vulkan 适用于支持 Vulkan 的 NVIDIA、AMD 或 Intel；CPU 兼容性最高。切换会重新启动模型运行时。</small></div>}
          {!runtimeStatus.translategemma && <div className="model-manager">
            <button className="scan-button" disabled={installingModel} onClick={() => void downloadTranslateGemma()}>{installingModel ? <LoaderCircle className="spin" size={15} /> : <Sparkles size={15} />}官方远程下载</button>
            <div className="model-url-row"><input type="url" value={modelUrl} disabled={installingModel} onChange={(event) => setModelUrl(event.target.value)} placeholder="https://…/model.gguf" aria-label="GGUF 模型 URL" /><button className="secondary" disabled={installingModel} onClick={downloadModelUrl}>下载 URL</button></div>
            <button className="secondary model-file-button" disabled={installingModel} onClick={() => void selectLocalModel()}>选择本地 GGUF 模型</button>
            <small className="muted">{clientPlatform === 'ios' ? 'iPad 默认使用 IQ4_XS；也可通过 URL 下载兼容的 TranslateGemma GGUF。' : '指定 URL 或本地模型会替换当前翻译模型；请使用兼容 TranslateGemma 提示格式的 GGUF。'}</small>
            {modelStatusMessage && <small className="muted">{modelStatusMessage}</small>}
          </div>}
          <div className="toggle-row"><div><strong>在线学习专有名词</strong><small>精确跨语言词条自动入库，相似结果仅候选</small></div><button className={`toggle ${routing.entityLookupEnabled ? 'on' : ''}`} aria-label="在线学习专有名词" onClick={() => setRouting({ ...routing, entityLookupEnabled: !routing.entityLookupEnabled })}><span /></button></div>
          {routing.entityLookupEnabled && <div className="search-config">
            <div className="inline-select"><label>主搜索引擎</label><div className="select-wrap"><select value={routing.entitySearch.primary} onChange={(event) => updateEntitySearch({ primary: event.target.value as EntitySearchEngineId })}>{Object.entries(entitySearchEngineLabels).map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select><ChevronDown size={13} /></div></div>
            <div className="inline-select"><label>无结果时回退</label><div className="select-wrap"><select value={routing.entitySearch.fallback} onChange={(event) => updateEntitySearch({ fallback: event.target.value as EntitySearchEngineId | 'none' })}><option value="none">不使用第二引擎</option>{Object.entries(entitySearchEngineLabels).filter(([id]) => id !== routing.entitySearch.primary).map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select><ChevronDown size={13} /></div></div>
            {(routing.entitySearch.primary === 'brave' || routing.entitySearch.fallback === 'brave') && <input type="password" value={routing.entitySearch.braveApiKey} onChange={(event) => updateEntitySearch({ braveApiKey: event.target.value })} placeholder="Brave Search API Key" aria-label="Brave Search API Key" autoComplete="off" />}
            {(routing.entitySearch.primary === 'qianfan' || routing.entitySearch.fallback === 'qianfan') && <input type="password" value={routing.entitySearch.qianfanApiKey} onChange={(event) => updateEntitySearch({ qianfanApiKey: event.target.value })} placeholder="百度千帆 API Key" aria-label="百度千帆 API Key" autoComplete="off" />}
            <small className="muted">外部查询只包含当前游戏名称与抽取出的片假名候选，不发送完整 OCR 文本；API Key 只保存在本机。</small>
          </div>}
          <div className="toggle-row"><div><strong>共享本地词库贡献</strong><small>仅专名、单词和菜单短标签；不会上传对白或描述文本</small></div><button className={`toggle ${sharingEnabled ? 'on' : ''}`} aria-label="共享本地词库贡献" onClick={toggleKnowledgeSharing}><span /></button></div>
          {sharingEnabled && <div className="community-key-row"><input type="password" value={communityApiKey} onChange={(event) => setCommunityApiKey(event.target.value)} placeholder="粘贴 nst_live_… API Key" aria-label="社区 API Key" /><button className="secondary" onClick={() => void saveApiKeyAndUpload()}>保存并上传</button></div>}
          <Range label="长文上下文超时" value={routing.contextResetSeconds} min={5} max={300} step={5} suffix=" s" onChange={(contextResetSeconds) => setRouting({ ...routing, contextResetSeconds })} />
          <div className="context-row"><span>当前上下文 {contextTurns} / {routing.contextMaxTurns} 轮</span><button className="text-button" onClick={() => { routerRef.current.resetContext(); setContextTurns(0) }}>新建对话</button></div>
          <div className="notice success">翻译记忆 {knowledgeStats.translations} 条 · 自动术语 {knowledgeStats.learnedTerms} 条 · 待确认 {knowledgeStats.pendingTerms} 条 · 待共享 {sharingPending} 条</div>
          {communityStatus && <small className="muted">{communityStatus}</small>}
          <div className="notice">远程词库包优先；未命中新文本由 TranslateGemma 翻译并记忆，专名检索在后台进行。</div>
        </ControlPanel>
        <ControlPanel title="画面替换" icon={<Sparkles size={16} />}><div className="toggle-row"><div><strong>模糊原文并覆盖译文</strong><small>按 OCR 文本区域实时渲染</small></div><button className={`toggle ${overlay.enabled ? 'on' : ''}`} aria-label="启用画面替换" onClick={() => setOverlay({ ...overlay, enabled: !overlay.enabled })}><span /></button></div><Range label="背景模糊" value={overlay.blur} min={0} max={30} suffix=" px" onChange={(value) => setOverlay({ ...overlay, blur: value })} /><Range label="背景不透明度" value={overlay.opacity} min={40} max={100} suffix="%" onChange={(value) => setOverlay({ ...overlay, opacity: value })} /><Range label="译文字号" value={overlay.fontScale} min={0.7} max={1.6} step={0.1} display={`${overlay.fontScale.toFixed(1)}×`} onChange={(value) => setOverlay({ ...overlay, fontScale: value })} /></ControlPanel>
        <ControlPanel className="wide" title="实时结果" icon={<Languages size={16} />} action={<span className="subtle-stat">平均置信度 {averageConfidence}%</span>}><div className="result-list">{regions.length ? regions.slice(0, 5).map((region) => <div className="result-row" key={region.id}><span className="confidence">{Math.round(region.confidence)}%</span><div><p lang="ja">{region.source}</p><p>{region.translated || '等待翻译…'}</p></div></div>) : <div className="empty-results">识别结果将在这里显示</div>}</div></ControlPanel>
        <ControlPanel className="wide diagnostic-panel" title="运行日志" icon={<Activity size={16} />} action={<div className="log-actions"><span>{diagnosticLogs.length} / 300</span><button onClick={() => { clearDiagnosticLog(); setDiagnosticLogs([]) }}>清空</button></div>}>
          <div className="diagnostic-log" ref={diagnosticLogRef} role="log" aria-live="polite">
            {diagnosticLogs.length ? diagnosticLogs.map((entry) => <div className={`diagnostic-row ${entry.level}`} key={entry.id}><time>{formatLogTime(entry.timestamp)}</time><span className="diagnostic-category">{entry.category}</span><strong>{entry.event}</strong>{entry.detail && <span className="diagnostic-detail">{entry.detail}</span>}</div>) : <div className="empty-results">OCR 启动后，诊断事件将在这里显示</div>}
          </div>
        </ControlPanel>
      </div>
    </section>
    <section className="latency-bar"><div className="latency-title"><Gauge size={16} /><strong>处理延迟</strong></div><Metric label="采集" value={latency.capture} color="cyan" /><Metric label="OCR" value={latency.ocr} color="violet" /><Metric label="翻译" value={latency.translate} color="amber" /><Metric label="渲染" value={latency.render} color="green" /><div className="total-latency"><Activity size={16} /><span>总延迟</span><strong>{formatMs(latency.total)}</strong></div></section>
    {error && <div className="error-toast" role="alert">{error}<button onClick={() => setError('')}>×</button></div>}
  </main>
}

function ControlPanel({ title, icon, children, className = '', action }: { title: string; icon: ReactNode; children: ReactNode; className?: string; action?: ReactNode }) { return <section className={`control-panel panel ${className}`}><div className="control-title"><div>{icon}<strong>{title}</strong></div>{action}</div><div className="control-body">{children}</div></section> }
function Range({ label, value, min, max, step = 1, suffix = '', display, onChange }: { label: string; value: number; min: number; max: number; step?: number; suffix?: string; display?: string; onChange(value: number): void }) { return <div className="range-control"><div><label>{label}</label><output>{display ?? `${value}${suffix}`}</output></div><input type="range" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} style={{ '--value': `${(value - min) / (max - min) * 100}%` } as CSSProperties} /></div> }
function EngineState({ label, ready }: { label: string; ready: boolean }) { return <span className={ready ? 'ready' : ''}><i />{label}</span> }
function Metric({ label, value, color }: { label: string; value: number; color: string }) { return <div className="metric"><span>{label}</span><strong>{formatMs(value)}</strong><div><i className={color} style={{ width: `${Math.min(100, value / 12)}%` }} /></div></div> }
function formatMs(value: number) { return value < 1 ? '—' : value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${Math.round(value)} ms` }
function formatLogTime(timestamp: number) { const date = new Date(timestamp), pad = (value: number, length = 2) => String(value).padStart(length, '0'); return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}` }
function translateStatus(status: string) { return ({ meikiocr: 'MeikiOCR 游戏日文模型已启用', 'meikiocr-loading': '正在加载 MeikiOCR', 'meikiocr-recognizing': 'MeikiOCR 正在识别', loading: '加载识别引擎', 'loading tesseract core': '加载 OCR 核心', 'initializing tesseract': '初始化 OCR', 'loading language traineddata': '加载日文模型', 'initializing api': '初始化接口', 'recognizing text': '正在识别文字' } as Record<string, string>)[status] ?? status }
export default App
