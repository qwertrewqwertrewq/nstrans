import { invoke, isTauri } from '@tauri-apps/api/core'
import type { OverlaySettings, TextRegion } from '../types'
import { translationMarqueeDurationMs, translationOverlayLayout } from './translationMarquee'

export type TvCastMode = 'image' | 'text'
export type TvDevice = { id: string; name: string; address: string; port: number; lastSeenMs: number }
export type TvConnectionStatus = { connected: boolean; name?: string; address?: string }
export type TvTextRegion = { id: string; x0: number; y0: number; x1: number; y1: number; text: string; durationMs: number; fontFamily: 'serif' | 'sans' }
export type TvOverlayPayload = {
  mode: TvCastMode
  canvasWidth: number
  canvasHeight: number
  settings: OverlaySettings
  regions?: TvTextRegion[]
  imageData?: string
}

function visibleTranslations(regions: TextRegion[]) {
  return regions.filter((region) => region.translated.trim())
}

export function buildTvTextPayload(regions: TextRegion[], canvasWidth: number, canvasHeight: number, settings: OverlaySettings): TvOverlayPayload {
  return {
    mode: 'text',
    canvasWidth: Math.max(1, canvasWidth),
    canvasHeight: Math.max(1, canvasHeight),
    settings,
    regions: visibleTranslations(regions).map((region) => ({
      id: region.id,
      ...region.box,
      text: region.translated,
      durationMs: region.marqueeDurationMs ?? translationMarqueeDurationMs(region.translationSource ?? region.source, region.translated),
      fontFamily: region.fontFamily ?? 'sans',
    })),
  }
}

export function buildTvImagePayload(regions: TextRegion[], canvasWidth: number, canvasHeight: number, settings: OverlaySettings): TvOverlayPayload {
  const width = Math.max(1, canvasWidth),
    height = Math.max(1, canvasHeight),
    canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法创建电视字幕图层')
  for (const region of visibleTranslations(regions)) {
    const rawWidth = Math.max(1, region.box.x1 - region.box.x0),
      rawHeight = Math.max(1, region.box.y1 - region.box.y0),
      safetyX = Math.min(10, Math.max(3, rawHeight * 0.18)),
      safetyY = Math.min(6, Math.max(2, rawHeight * 0.12)),
      left = Math.max(0, region.box.x0 - safetyX),
      top = Math.max(0, region.box.y0 - safetyY),
      boxWidth = Math.min(width, region.box.x1 + safetyX) - left,
      boxHeight = Math.min(height, region.box.y1 + safetyY) - top,
      source = region.translationSource ?? region.source,
      layout = translationOverlayLayout(source, region.translated, rawWidth, rawHeight, settings.fontScale)
    context.fillStyle = `rgba(7, 10, 16, ${settings.opacity / 100})`
    context.fillRect(left, top, boxWidth, boxHeight)
    context.save()
    context.beginPath()
    context.rect(left, top, boxWidth, boxHeight)
    context.clip()
    context.fillStyle = '#fff'
    context.font = `600 ${layout.fontSize}px ${region.fontFamily === 'serif' ? 'serif' : 'sans-serif'}`
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.shadowColor = '#000'
    context.shadowBlur = Math.max(1, layout.fontSize * 0.16)
    context.fillText(region.translated, left + boxWidth / 2, top + boxHeight / 2)
    context.restore()
  }
  return { mode: 'image', canvasWidth: width, canvasHeight: height, settings, imageData: canvas.toDataURL('image/png').split(',', 2)[1] ?? '' }
}

export async function listTvDevices(): Promise<TvDevice[]> {
  if (!isTauri()) return []
  return invoke<TvDevice[]>('tv_cast_devices')
}

export async function connectTv(address: string): Promise<TvConnectionStatus> {
  if (!isTauri()) throw new Error('电视输出仅在 NSTrans 客户端中可用')
  return invoke<TvConnectionStatus>('tv_cast_connect', { address })
}

export async function tvConnectionStatus(): Promise<TvConnectionStatus> {
  if (!isTauri()) return { connected: false }
  return invoke<TvConnectionStatus>('tv_cast_status')
}

export async function pushTvOverlay(payload: TvOverlayPayload): Promise<TvConnectionStatus> {
  return invoke<TvConnectionStatus>('tv_cast_push', { payload })
}

export async function disconnectTv(): Promise<TvConnectionStatus> {
  if (!isTauri()) return { connected: false }
  return invoke<TvConnectionStatus>('tv_cast_disconnect')
}
