import { describe, expect, it } from 'vitest'
import type { TextRegion } from '../types'
import { boxesAreApproximatelySame, needsTranslationMarquee, translationOverlayLayout, TranslationMarqueeLocks, translationMarqueeDurationMs } from './translationMarquee'

const region = (source: string, x0 = 100, x1 = 260): TextRegion => ({ id: source, source, translated: '', confidence: 90, box: { x0, y0: 400, x1, y1: 430 } })

describe('translation marquee', () => {
  it('scrolls only when the translated glyph count exceeds the source', () => {
    expect(needsTranslationMarquee('短文', '较长的译文')).toBe(true)
    expect(needsTranslationMarquee('同样长', '三个字')).toBe(false)
    expect(translationMarqueeDurationMs('短文', '较长的译文')).toBeGreaterThanOrEqual(3_200)
  })

  it('uses the actual line box to detect overflow and keeps the source type size', () => {
    const fitting = translationOverlayLayout('四文字です', '四个文字', 120, 30)
    const overflowing = translationOverlayLayout('短文', '这是一段明显放不下的译文', 55, 24)
    expect(fitting.scrolling).toBe(false)
    expect(overflowing.scrolling).toBe(true)
    expect(overflowing.scrollDistance).toBeGreaterThan(6)
  })

  it('matches a nearby moved OCR box and rejects a separate line', () => {
    expect(boxesAreApproximatelySame(region('一').box, region('二', 110, 275).box)).toBe(true)
    expect(boxesAreApproximatelySame(region('一').box, { x0: 100, y0: 520, x1: 260, y1: 550 })).toBe(false)
    expect(boxesAreApproximatelySame(region('一').box, { x0: 270, y0: 400, x1: 400, y1: 430 })).toBe(false)
  })

  it('blocks approximate regions only until the marquee finishes', () => {
    const locks = new TranslationMarqueeLocks()
    const original = region('地名')
    const lock = locks.start(original, '这是一个更长的地名', 'translategemma', 1_000)!
    expect(locks.find({ box: { x0: 108, y0: 402, x1: 268, y1: 432 } }, lock.until - 1)?.text).toBe('这是一个更长的地名')
    expect(locks.find(original, lock.until)).toBeUndefined()
  })
})
