import type { TextRegion } from '../types'

export function cropOcrRegionDataUrl(frame: HTMLCanvasElement, region: Pick<TextRegion, 'source' | 'box'>) {
  const { box } = region, height = Math.max(1, box.y1 - box.y0), width = Math.max(1, box.x1 - box.x0)
  const containsKatakana = /[\p{Script=Katakana}ー]/u.test(region.source)
  // OCR boxes normally cover the whole line. Extra horizontal context is
  // deliberately wider for katakana so prefixes/suffixes and nearby furigana
  // are visible to the remote correction model.
  const padX = containsKatakana ? Math.max(height * 3, width * .22) : Math.max(height, width * .12)
  const padY = height * .7
  const x = Math.max(0, Math.floor(box.x0 - padX)), y = Math.max(0, Math.floor(box.y0 - padY))
  const cropWidth = Math.max(1, Math.min(frame.width - x, Math.ceil(width + padX * 2)))
  const cropHeight = Math.max(1, Math.min(frame.height - y, Math.ceil(height + padY * 2)))
  const scale = Math.min(1, 1024 / cropWidth)
  const output = document.createElement('canvas')
  output.width = Math.max(1, Math.round(cropWidth * scale)); output.height = Math.max(1, Math.round(cropHeight * scale))
  output.getContext('2d', { alpha: false })?.drawImage(frame, x, y, cropWidth, cropHeight, 0, 0, output.width, output.height)
  return output.toDataURL('image/jpeg', .86)
}
