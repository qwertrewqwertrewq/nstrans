export type Box = { x0: number; y0: number; x1: number; y1: number }
export type TranslationEngineId = 'translategemma'
export type TextRegion = { id: string; source: string; translated: string; confidence: number; box: Box; fontFamily?: 'serif' | 'sans'; translationEngine?: TranslationEngineId; translationSource?: string; marqueeDurationMs?: number }
export type LatencySample = { capture: number; ocr: number; translate: number; render: number; total: number }
export type TranslationProvider = 'macos' | 'llm' | 'preview'
export type TranslationRoutingSettings = {
  gameId: GameId
  contextResetSeconds: number
  contextMaxTurns: number
  entityLookupEnabled: boolean
  entitySearch: import('./services/entitySearchSettings').EntitySearchSettings
}
export type ScanMode = 'switch' | 'subtitles' | 'full'
export type OcrEngine = 'meiki' | 'apple-vision'
export type OcrSettings = { intervalMs: number; confidence: number; language: 'jpn' | 'jpn+eng'; scanMode: ScanMode; engine: OcrEngine }
export type OverlaySettings = { enabled: boolean; blur: number; opacity: number; fontScale: number }
import type { GameId } from './gameAdapters/types'
