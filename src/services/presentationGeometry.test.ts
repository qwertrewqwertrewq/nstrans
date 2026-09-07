import { describe, expect, it } from 'vitest'
import { nearestDockEdge, normalizeSelection, offsetTextRegions, selectionCanvasRect } from './presentationGeometry'

describe('presentation geometry', () => {
  it('normalizes reverse drag selections and maps them into capture pixels', () => {
    const selection = normalizeSelection(800, 450, 200, 100, 1000, 500)!
    expect(selection).toEqual({ x0: .2, y0: .2, x1: .8, y1: .9 })
    expect(selectionCanvasRect(selection, 1280, 720)).toEqual({ x: 256, y: 144, width: 768, height: 504 })
  })

  it('rejects accidental clicks and offsets cropped OCR boxes', () => {
    expect(normalizeSelection(10, 10, 14, 14, 1000, 500)).toBeNull()
    const shifted = offsetTextRegions([{ id: 'a', source: '文字', translated: '', confidence: 90, box: { x0: 1, y0: 2, x1: 30, y1: 20 } }], 100, 200)
    expect(shifted[0].box).toEqual({ x0: 101, y0: 202, x1: 130, y1: 220 })
  })

  it('chooses all four nearest docking edges', () => {
    expect(nearestDockEdge(2, 200, 100, 40, 1000, 600)).toBe('left')
    expect(nearestDockEdge(898, 200, 100, 40, 1000, 600)).toBe('right')
    expect(nearestDockEdge(400, 2, 100, 40, 1000, 600)).toBe('top')
    expect(nearestDockEdge(400, 558, 100, 40, 1000, 600)).toBe('bottom')
  })
})
