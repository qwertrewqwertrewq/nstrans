import { describe, expect, it } from 'vitest'
import { buildTvTextPayload } from './tvCast'
import type { TextRegion } from '../types'

describe('TV subtitle transport', () => {
  it('sends translated regions with source-canvas coordinates and overlay settings', () => {
    const regions: TextRegion[] = [
      { id: 'a', source: 'ハイラル', translated: '海拉鲁', confidence: 95, box: { x0: 10, y0: 20, x1: 100, y1: 50 }, fontFamily: 'serif' },
      { id: 'b', source: '未翻訳', translated: '', confidence: 80, box: { x0: 0, y0: 0, x1: 10, y1: 10 } },
    ]
    const payload = buildTvTextPayload(regions, 1280, 720, { enabled: true, blur: 14, opacity: 88, fontScale: 1.2 })
    expect(payload).toMatchObject({ mode: 'text', canvasWidth: 1280, canvasHeight: 720, settings: { opacity: 88, fontScale: 1.2 } })
    expect(payload.regions).toHaveLength(1)
    expect(payload.regions?.[0]).toMatchObject({ id: 'a', text: '海拉鲁', x0: 10, y0: 20, x1: 100, y1: 50, fontFamily: 'serif' })
  })
})
