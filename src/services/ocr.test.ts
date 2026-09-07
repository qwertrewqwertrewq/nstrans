import { describe, expect, it } from 'vitest'
import { filterSceneText, fitCaptureSize, mergeContinuousRegions } from './ocr'
import type { TextRegion } from '../types'

describe('fitCaptureSize', () => {
  it('keeps a small source at its native resolution', () => {
    expect(fitCaptureSize(640, 480)).toEqual({ width: 640, height: 480 })
  })

  it('scales a 16:9 source down without changing its aspect ratio', () => {
    expect(fitCaptureSize(1920, 1080)).toEqual({ width: 1280, height: 720 })
  })

  it('handles an input that has not reported metadata yet', () => {
    expect(fitCaptureSize(0, 0)).toEqual({ width: 0, height: 0 })
  })
})

describe('filterSceneText for Switch', () => {
  const region = (source: string, x0: number, y0: number, x1: number, y1: number, confidence = 90): TextRegion => ({ id: source, source, translated: '', confidence, box: { x0, y0, x1, y1 } })
  it('keeps multiple adjacent dialogue lines and rejects controller prompts and HUD noise', () => {
    const result = filterSceneText([
      region('このまま進もう', 300, 650, 720, 690),
      region('洞窟の奥まで', 340, 700, 680, 740),
      region('会話ログを見る Y', 820, 810, 1010, 828),
      region('A', 930, 760, 945, 775),
      region('4', 400, 4, 410, 16),
      region('短いUI', 20, 800, 90, 818),
      region('A 調べる', 440, 760, 580, 785),
    ], 1024, 900, 'switch')
    expect(result.map((item) => item.source)).toEqual(['このまま進もう', '洞窟の奥まで'])
  })

  it('keeps separated instructions, dialogue and answer options at the same time', () => {
    const result = filterSceneText([region('使いたいコントローラーの', 230, 270, 445, 289), region('を押してください。', 570, 270, 722, 289), region('リンク様は種をお持ちですか', 310, 437, 650, 456), region('持っていない', 730, 402, 850, 423), region('持っている', 730, 440, 850, 461)], 960, 660, 'switch')
    expect(result).toHaveLength(5)
  })

  it('keeps coherent small equipment descriptions but still rejects bottom controls and HUD fragments', () => {
    const result = filterSceneText([
      region('ダイビング機動力アップ', 548, 186, 675, 199, 86),
      region('寒さガード', 548, 228, 605, 240, 89),
      region('スクラビルド攻撃力', 547, 417, 666, 429, 89),
      region('鋭利な突起が複数ある角', 542, 444, 666, 456, 74),
      region('武器に付けると攻撃力が上がる', 543, 461, 701, 474, 89),
      region('また虫と煮込んで薬の材料にもできる', 543, 479, 738, 492, 92),
      region('手に持つ', 466, 530, 511, 540, 80),
      region('回転モード', 562, 530, 618, 541, 89),
      region('並べかえる', 672, 530, 728, 540, 91),
      region('選ぶ', 790, 530, 814, 540, 80),
      region('戻る', 853, 530, 876, 540, 89),
      region('A', 815, 530, 825, 540, 95),
      region('素材', 244, 39, 267, 50, 69),
      region('x13', 64, 481, 94, 492, 82),
    ], 946, 562, 'switch')
    expect(result.map((item) => item.source)).toEqual([
      'ダイビング機動力アップ', '寒さガード', 'スクラビルド攻撃力',
      '鋭利な突起が複数ある角', '武器に付けると攻撃力が上がる',
      'また虫と煮込んで薬の材料にもできる',
      '手に持つ', '回転モード', '並べかえる', '選ぶ', '戻る',
    ])
  })
})

describe('mergeContinuousRegions', () => {
  const region = (source: string, x0: number, y0: number, x1: number, y1: number): TextRegion => ({ id: source, source, translated: '', confidence: 90, box: { x0, y0, x1, y1 } })

  it('merges adjacent fragments belonging to one continuous Japanese line', () => {
    const result = mergeContinuousRegions([region('今日は', 10, 30, 80, 55), region('晴れです', 86, 31, 170, 55)])
    expect(result).toHaveLength(1)
    expect(result[0].source).toBe('今日は晴れです')
    expect(result[0].box).toEqual({ x0: 10, y0: 30, x1: 170, y1: 55 })
  })

  it('suppresses small furigana immediately above its kanji line', () => {
    const result = mergeContinuousRegions([region('かんじ', 30, 10, 70, 20), region('漢字を読む', 10, 25, 120, 55)])
    expect(result.map((item) => item.source)).toEqual(['漢字を読む'])
  })
})
