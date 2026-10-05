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
