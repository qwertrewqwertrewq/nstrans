import { describe, expect, it } from 'vitest'
import type { GlossaryEntry } from './types'
import { composeKnownTerms } from './termComposition'

const glossary: readonly GlossaryEntry[] = [
  { source: 'ハイラル', target: '海拉鲁', category: 'location' },
  { source: 'ハイラル平原', target: '海拉鲁平原', category: 'location' },
  { source: 'リンク', target: '林克', category: 'character' },
  { source: 'ゼルダ', target: '塞尔达', category: 'character' },
]

describe('composeKnownTerms', () => {
  it('uses longest internal terms and preserves safe kanji modifiers', () => {
    expect(composeKnownTerms('西ハイラル平原', glossary)?.target).toBe('西海拉鲁平原')
    expect(composeKnownTerms('ハイラル平原西部', glossary)?.target).toBe('海拉鲁平原西部')
  })

  it('can compose multiple known names separated by label punctuation', () => {
    expect(composeKnownTerms('リンク・ゼルダ', glossary)?.target).toBe('林克・塞尔达')
  })

  it('rejects Japanese grammar and unknown katakana to avoid mixed output', () => {
    expect(composeKnownTerms('リンクはハイラル平原へ向かった', glossary)).toBeUndefined()
    expect(composeKnownTerms('ニュー・ハイラル平原', glossary)).toBeUndefined()
  })
})
