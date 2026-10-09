// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { TextRegion } from './types'

const recognize = vi.hoisted(() => vi.fn())
vi.mock('./services/ocr', async (original) => ({ ...await original<typeof import('./services/ocr')>(), recognizeJapanese: recognize }))
import App from './App'
import { TranslationRouter } from './services/translationRouter'
import { HttpDictionaryDistributionProvider } from './services/dictionaryPacks'

beforeEach(() => {
  recognize.mockReset().mockResolvedValue([])
  localStorage.clear()
  localStorage.setItem('nstrans.capture-audio-enabled.v1', '0')
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
  vi.spyOn(HttpDictionaryDistributionProvider.prototype, 'fetchPack').mockRejectedValue(new Error('offline test'))
  vi.spyOn(TranslationRouter.prototype, 'translate').mockResolvedValue([{ text: '测试字幕', engine: 'translategemma' }])
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D)
  Object.defineProperties(HTMLVideoElement.prototype, {
    videoWidth: { configurable: true, get: () => 1920 },
    videoHeight: { configurable: true, get: () => 1080 },
    readyState: { configurable: true, get: () => 4 },
  })
})

it('does not stop video or revive audio when its permission request completes after disabling audio', async () => {
  const videoStop = vi.fn(), audioStop = vi.fn(), permissionStop = vi.fn()
  const videoTrack = { stop: videoStop, label: 'USB Video', getSettings: () => ({ deviceId: 'card', width: 1920, height: 1080 }) }
  const video = { getTracks: () => [videoTrack], getVideoTracks: () => [videoTrack] }
  const audio = { getTracks: () => [{ stop: audioStop }] }
  let finishAudio: ((stream: unknown) => void) | undefined
  const getUserMedia = vi.fn(async (constraints: MediaStreamConstraints) => {
    if (constraints.video) return video
    if (constraints.audio === true) return { getTracks: () => [{ stop: permissionStop }] }
    return new Promise((resolve) => { finishAudio = resolve })
  })
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
    enumerateDevices: vi.fn(async () => [
      { kind: 'videoinput', deviceId: 'card', groupId: 'capture', label: 'USB Video' },
      { kind: 'audioinput', deviceId: 'card-audio', groupId: 'capture', label: 'USB Audio' },
    ]), getUserMedia, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  } })
  render(<App />)
  const start = screen.getByRole('button', { name: '启动预览' })
  await waitFor(() => expect(start).toBeEnabled())
  fireEvent.click(start)
  await screen.findByRole('button', { name: '暂停识别' })
  const toggle = screen.getByRole('button', { name: '启用采集卡音频输出' })
  fireEvent.click(toggle)
  await waitFor(() => expect(finishAudio).toBeDefined())
  fireEvent.click(toggle)
  await act(async () => { finishAudio?.(audio) })
  expect(audioStop).toHaveBeenCalledOnce()
  expect(videoStop).not.toHaveBeenCalled()
  expect(screen.getByText('采集卡音频已关闭')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '暂停识别' })).toBeEnabled()
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

const makeAudioTrack = () => Object.assign(new EventTarget(), { stop: vi.fn(), readyState: 'live' })

async function startPreviewWithAudio(tracks: ReturnType<typeof makeAudioTrack>[]) {
  localStorage.setItem('nstrans.capture-audio-enabled.v1', '1')
  const videoStop = vi.fn()
  const videoTrack = { stop: videoStop, label: 'USB Video', getSettings: () => ({ deviceId: 'card', width: 1920, height: 1080 }) }
  const video = { getTracks: () => [videoTrack], getVideoTracks: () => [videoTrack] }
  const audioStreams = tracks.map((track) => ({ getTracks: () => [track], getAudioTracks: () => [track] }))
  let nextAudio = 0
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
    enumerateDevices: vi.fn(async () => [
      { kind: 'videoinput', deviceId: 'card', groupId: 'capture', label: 'USB Video' },
      { kind: 'audioinput', deviceId: 'card-audio', groupId: 'capture', label: 'USB Audio' },
      { kind: 'audioinput', deviceId: 'other-audio', groupId: 'other', label: 'Other USB Audio' },
    ]),
    getUserMedia: vi.fn(async (constraints: MediaStreamConstraints) => {
      if (constraints.video) return video
      if (constraints.audio === true) return { getTracks: () => [{ stop: vi.fn() }] }
      return audioStreams[nextAudio++]
    }),
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
  } })
  const view = render(<App />)
  const start = screen.getByRole('button', { name: '启动预览' })
  await waitFor(() => expect(start).toBeEnabled())
  fireEvent.click(start)
  await waitFor(() => expect(nextAudio).toBe(1))
  return { view, videoStop, audioStreams }
}

it('clears ended capture audio without stopping the video preview', async () => {
  const track = makeAudioTrack()
  const { view, videoStop } = await startPreviewWithAudio([track])
  await screen.findByText('正在输出 · USB Audio')
  act(() => { track.readyState = 'ended'; track.dispatchEvent(new Event('ended')) })
  expect(screen.getByText('采集卡音频已断开，请重新开启音频或选择设备')).toBeInTheDocument()
  expect(view.container.querySelector('audio')?.srcObject).toBeNull()
  expect(track.stop).toHaveBeenCalled()
  expect(videoStop).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: '暂停识别' })).toBeEnabled()
})

it('ignores an ended event from a replaced audio stream', async () => {
  const previous = makeAudioTrack(), current = makeAudioTrack()
  const { view, videoStop, audioStreams } = await startPreviewWithAudio([previous, current])
  await screen.findByText('正在输出 · USB Audio')
  fireEvent.change(screen.getByRole('combobox', { name: '采集卡音频输入设备' }), { target: { value: 'other-audio' } })
  await screen.findByText('正在输出 · Other USB Audio')
  act(() => { previous.dispatchEvent(new Event('ended')) })
  expect(screen.getByText('正在输出 · Other USB Audio')).toBeInTheDocument()
  expect(view.container.querySelector('audio')?.srcObject).toBe(audioStreams[1])
  expect(current.stop).not.toHaveBeenCalled()
  expect(videoStop).not.toHaveBeenCalled()
})

it('does not report playback success when the audio track ends while play is pending', async () => {
  let finishPlay: (() => void) | undefined
  vi.mocked(HTMLMediaElement.prototype.play).mockImplementation(function (this: HTMLMediaElement) {
    return this instanceof HTMLAudioElement ? new Promise<void>((resolve) => { finishPlay = resolve }) : Promise.resolve()
  })
  const track = makeAudioTrack()
  const { view, videoStop } = await startPreviewWithAudio([track])
  await waitFor(() => expect(finishPlay).toBeDefined())
  act(() => { track.readyState = 'ended'; track.dispatchEvent(new Event('ended')) })
  await act(async () => { finishPlay?.() })
  expect(screen.queryByText('正在输出 · USB Audio')).not.toBeInTheDocument()
  expect(screen.getByText('采集卡音频已断开，请重新开启音频或选择设备')).toBeInTheDocument()
  expect(view.container.querySelector('audio')?.srcObject).toBeNull()
  expect(videoStop).not.toHaveBeenCalled()
})

it('rejects an already ended audio track and releases it without stopping video', async () => {
  const track = makeAudioTrack()
  track.readyState = 'ended'
  const { view, videoStop } = await startPreviewWithAudio([track])
  await screen.findByText('所选设备没有可用的音频轨道')
  expect(track.stop).toHaveBeenCalled()
  expect(view.container.querySelector('audio')?.srcObject).toBeNull()
  expect(videoStop).not.toHaveBeenCalled()
})

it('clears visible results on pause and rejects an OCR result that finishes after pause', async () => {
  const track = { stop: vi.fn(), label: 'USB Video', getSettings: () => ({ deviceId: 'card', width: 1920, height: 1080, frameRate: 60 }) }
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] }
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
    enumerateDevices: vi.fn(async () => [{ kind: 'videoinput', deviceId: 'card', label: 'USB Video' }]),
    getUserMedia: vi.fn(async () => stream), addEventListener: vi.fn(), removeEventListener: vi.fn(),
  } })
  const region = { id: 'test', source: 'テスト文字', translated: '测试字幕', confidence: 0.99, box: { x0: 10, y0: 10, x1: 200, y1: 50 } } as TextRegion
  let finish: ((regions: TextRegion[]) => void) | undefined
  recognize.mockResolvedValueOnce([region]).mockImplementation(() => new Promise<TextRegion[]>((resolve) => { finish = resolve }))
  const view = render(<App />)
  const start = screen.getByRole('button', { name: '启动预览' })
  await waitFor(() => expect(start).toBeEnabled())
  fireEvent.click(start)
  await waitFor(() => expect(view.container.querySelector('.translation-overlay')).not.toBeNull())
  await waitFor(() => expect(finish).toBeDefined())
  fireEvent.click(screen.getByRole('button', { name: '暂停识别' }))
  expect(view.container.querySelector('.translation-overlay')).toBeNull()
  await act(async () => { finish?.([region]) })
  expect(view.container.querySelector('.translation-overlay')).toBeNull()
  expect(track.stop).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: '继续识别' })).toBeEnabled()
})
