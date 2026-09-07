import type { Box, TextRegion, TranslationEngineId } from '../types'

export type TranslationMarqueeLock = {
  box: Box
  source: string
  text: string
  engine: TranslationEngineId
  startedAt: number
  until: number
  durationMs: number
}

const glyphCount = (text: string) => [...text.replace(/\s/gu, '')].length
const area = (box: Box) => Math.max(1, box.x1 - box.x0) * Math.max(1, box.y1 - box.y0)
const intersection = (a: Box, b: Box) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0))
const iou = (a: Box, b: Box) => { const overlap = intersection(a, b); return overlap / Math.max(1, area(a) + area(b) - overlap) }

export function needsTranslationMarquee(source: string, translated: string) {
  return glyphCount(translated) > glyphCount(source)
}

export function translationOverlayLayout(source: string, translated: string, boxWidth: number, boxHeight: number, fontScale = 1) {
  const sourceGlyphs = Math.max(1, glyphCount(source)), translatedGlyphs = Math.max(1, glyphCount(translated))
  const paddingX = Math.min(6, Math.max(1.5, boxHeight * .1))
  const availableWidth = Math.max(1, boxWidth - paddingX * 2)
  // Preserve the source line's apparent type size. A long translation scrolls
  // instead of being repeatedly shrunk as typewriter dialogue grows.
  const fontSize = Math.max(7, Math.min(boxHeight * .8, availableWidth / (sourceGlyphs * 1.03))) * fontScale
  const estimatedTextWidth = translatedGlyphs * fontSize * 1.04
  const scrolling = estimatedTextWidth > availableWidth + 1
  return { fontSize, paddingX, scrolling, scrollDistance: Math.max(6, estimatedTextWidth - availableWidth + paddingX) }
}

export function translationMarqueeDurationMs(source: string, translated: string) {
  const overflow = Math.max(1, glyphCount(translated) - glyphCount(source))
  return Math.min(12_000, Math.max(3_200, 2_400 + overflow * 420 + glyphCount(translated) * 90))
}

export function boxesAreApproximatelySame(a: Box, b: Box) {
  if (iou(a, b) >= .25) return true
  const height = Math.max(1, a.y1 - a.y0, b.y1 - b.y0)
  const centerAY = (a.y0 + a.y1) / 2, centerBY = (b.y0 + b.y1) / 2
  const horizontalOverlap = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0))
  const minimumWidth = Math.max(1, Math.min(a.x1 - a.x0, b.x1 - b.x0))
  return Math.abs(centerAY - centerBY) <= height * .65 && horizontalOverlap / minimumWidth >= .35
}

export class TranslationMarqueeLocks {
  private locks: TranslationMarqueeLock[] = []

  clear() { this.locks = [] }

  prune(now: number) { this.locks = this.locks.filter(({ until }) => until > now) }

  find(region: Pick<TextRegion, 'box'>, now: number) {
    this.prune(now)
    return this.locks.find((lock) => boxesAreApproximatelySame(lock.box, region.box))
  }

  start(region: Pick<TextRegion, 'source' | 'box'>, text: string, engine: TranslationEngineId, now: number, scrolling = needsTranslationMarquee(region.source, text)) {
    if (!scrolling) return undefined
    const durationMs = translationMarqueeDurationMs(region.source, text)
    const lock = { box: { ...region.box }, source: region.source, text, engine, startedAt: now, until: now + durationMs, durationMs }
    this.locks = this.locks.filter((candidate) => !boxesAreApproximatelySame(candidate.box, region.box))
    this.locks.push(lock)
    return lock
  }
}
