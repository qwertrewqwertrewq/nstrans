import { describe, expect, it } from 'vitest'
import { buildTranslateGemmaPrompt, isLikelyStandaloneLabel, TRANSLATEGEMMA_SYSTEM_PROMPT } from './translateGemmaPrompt'

describe('TranslateGemma prompt', () => {
  it('classifies compact place names and labels separately from dialogue', () => {
    expect(isLikelyStandaloneLabel('西ハイラル平原')).toBe(true)
    expect(isLikelyStandaloneLabel('始まりの空島')).toBe(true)
    expect(isLikelyStandaloneLabel('ここから先へ進んでください。')).toBe(false)
  })

  it('forbids narrative expansion and marks a place name as a standalone label', () => {
    const prompt = buildTranslateGemmaPrompt({ source: '西ハイラル平原', context: ['リンク → 林克'] })
    expect(prompt).toContain('Input mode: STANDALONE_NAME_OR_LABEL')
    expect(prompt).toContain('Input mode: STANDALONE_NAME_OR_LABEL')
    expect(TRANSLATEGEMMA_SYSTEM_PROMPT).toContain('Never expand a name or fragment into a narrative sentence')
    expect(TRANSLATEGEMMA_SYSTEM_PROMPT).toContain('“现在”')
    expect(TRANSLATEGEMMA_SYSTEM_PROMPT).toContain('must not contain Japanese hiragana or katakana')
  })

  it('keeps game glossary targets mandatory without hard-coding a game name', () => {
    const prompt = buildTranslateGemmaPrompt({ source: 'ハイラル', glossary: [{ source: 'ハイラル', target: '海拉鲁' }] })
    expect(prompt).toContain('Mandatory game glossary')
    expect(prompt).toContain('ハイラル → 海拉鲁')
    expect(prompt).not.toContain('Tears of the Kingdom')
  })

  it('adds a strict correction instruction after a mixed-script result', () => {
    const prompt = buildTranslateGemmaPrompt({ source: 'ジオシニオの祠', correction: 'output still contains Japanese katakana' })
    expect(prompt).toContain('previous attempt was rejected')
    expect(prompt).toContain('entirely Simplified Chinese with no Japanese kana')
  })

  it('passes game-scoped free search evidence as non-mandatory terminology research', () => {
    const prompt = buildTranslateGemmaPrompt({ source: 'ジオシニオの祠', research: [{ term: 'ジオシニオ', query: '王国之泪 ジオシニオ', evidence: ['神庙名称资料'], sourceUrls: ['https://zh.wikipedia.org/wiki/example'] }] })
    expect(prompt).toContain('game terminology evidence')
    expect(prompt).toContain('神庙名称资料')
  })
})
