import { describe, expect, it } from 'vitest'
import type { TextRegion } from '../types'
import { DialogueStabilizer } from './dialogueStabilizer'

const region = (source: string, x1 = 300): TextRegion => ({ id: source, source, translated: '', confidence: 95, box: { x0: 100, y0: 500, x1, y1: 540 } })

describe('DialogueStabilizer', () => {
  it('immediately emits every progressively loaded dialogue update', () => {
    const stabilizer = new DialogueStabilizer()
    const first = stabilizer.observe([region('この剣は', 190)])
    expect(first.ready.map(({ source }) => source)).toEqual(['この剣は'])
    stabilizer.commit(first.ready[0].id, first.ready[0].source)
    const grown = stabilizer.observe([region('この剣には古代の', 260)])
    expect(grown.ready.map(({ source }) => source)).toEqual(['この剣には古代の'])
    expect(grown.visible[0].box.x1 - grown.visible[0].box.x0).toBe(160)
  })

  it('immediately accepts unknown short text and exact game menu labels', () => {
    const stabilizer = new DialogueStabilizer()
    expect(stabilizer.observe([region('剣を')]).ready.map(({ source }) => source)).toEqual(['剣を'])
    stabilizer.reset()
    expect(stabilizer.observe([region('設定')]).ready.map(({ source }) => source)).toEqual(['設定'])
  })

  it('immediately invalidates a committed translation when the same box grows', () => {
    const stabilizer = new DialogueStabilizer()
    const first = stabilizer.observe([region('準備はいいですか？')])
    stabilizer.commit(first.ready[0].id, first.ready[0].source)
    expect(stabilizer.observe([region('準備はいいですか？それでは始めます。', 420)]).ready).toHaveLength(1)
  })

  it('keeps a missed region for one OCR frame to reduce overlay flicker', () => {
    const stabilizer = new DialogueStabilizer()
    stabilizer.observe([region('設定')])
    expect(stabilizer.observe([]).visible).toHaveLength(1)
    expect(stabilizer.observe([]).visible).toHaveLength(0)
  })

  it('smooths box movement and ignores a one-frame OCR text glitch after commit', () => {
    const stabilizer = new DialogueStabilizer()
    const first = stabilizer.observe([region('設定', 300)])
    stabilizer.commit(first.ready[0].id, first.ready[0].source)
    const moved = stabilizer.observe([{ ...region('設定', 320), box: { x0: 120, y0: 504, x1: 320, y1: 544 } }])
    expect(moved.visible[0].box.x0).toBe(111)
    expect(moved.visible[0].box.x1).toBe(311)
    const glitch = stabilizer.observe([region('設足', 320)])
    expect(glitch.visible[0].source).toBe('設定')
    expect(glitch.ready).toHaveLength(0)
  })

  it('accepts a genuine changed label after it appears in two frames', () => {
    const stabilizer = new DialogueStabilizer()
    const first = stabilizer.observe([region('設定')])
    stabilizer.commit(first.ready[0].id, first.ready[0].source)
    expect(stabilizer.observe([region('戻る')]).visible[0].source).toBe('設定')
    const changed = stabilizer.observe([region('戻る')])
    expect(changed.visible[0].source).toBe('戻る')
    expect(changed.ready[0].source).toBe('戻る')
  })
})
