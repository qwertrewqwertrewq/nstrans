import type { Box, TextRegion } from '../types'

export type NormalizedSelection = Box
export type DockEdge = 'left' | 'right' | 'top' | 'bottom'

export function normalizeSelection(startX: number, startY: number, endX: number, endY: number, width: number, height: number): NormalizedSelection | null {
  if (width <= 0 || height <= 0) return null
  const x0 = Math.max(0, Math.min(1, Math.min(startX, endX) / width))
  const y0 = Math.max(0, Math.min(1, Math.min(startY, endY) / height))
  const x1 = Math.max(0, Math.min(1, Math.max(startX, endX) / width))
  const y1 = Math.max(0, Math.min(1, Math.max(startY, endY) / height))
  return (x1 - x0) * width >= 8 && (y1 - y0) * height >= 8 ? { x0, y0, x1, y1 } : null
}

export function selectionCanvasRect(selection: NormalizedSelection, width: number, height: number) {
  const x = Math.max(0, Math.floor(selection.x0 * width)), y = Math.max(0, Math.floor(selection.y0 * height))
  const x1 = Math.min(width, Math.ceil(selection.x1 * width)), y1 = Math.min(height, Math.ceil(selection.y1 * height))
  return { x, y, width: Math.max(1, x1 - x), height: Math.max(1, y1 - y) }
}

export function offsetTextRegions(regions: TextRegion[], x: number, y: number): TextRegion[] {
  return regions.map((region) => ({ ...region, box: { x0: region.box.x0 + x, y0: region.box.y0 + y, x1: region.box.x1 + x, y1: region.box.y1 + y } }))
}

export function nearestDockEdge(x: number, y: number, width: number, height: number, containerWidth: number, containerHeight: number): DockEdge {
  const distances: Array<[DockEdge, number]> = [
    ['left', x], ['right', containerWidth - x - width], ['top', y], ['bottom', containerHeight - y - height],
  ]
  return distances.sort((a, b) => a[1] - b[1])[0][0]
}
