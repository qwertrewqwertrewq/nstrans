import { describe, expect, it } from 'vitest'
import { buildQwenTranslationPrompt, parseQwenVisionResponse } from './qwenFlash'

describe('Qwen vision fallback response', () => {
  it('keeps both the noisy OCR spelling and canonical Japanese term', () => {
    expect(parseQwenVisionResponse(JSON.stringify({ correctedText: 'ゼルダ', translation: '塞尔达', entries: [{ observed: '世儿夕', canonical: 'ゼルダ', target: '塞尔达' }, { observed: 'ゼルダ', canonical: 'ゼルダ', target: '塞尔达' }] }), '世儿夕')).toEqual({
      correctedText: 'ゼルダ', translation: '塞尔达', entries: [
        { observed: '世儿夕', canonical: 'ゼルダ', target: '塞尔达' },
        { observed: 'ゼルダ', canonical: 'ゼルダ', target: '塞尔达' },
      ],
    })
  })

  it('includes custom game context and translation preferences while retaining the JSON contract', () => {
    const prompt = buildQwenTranslationPrompt({ texts: ['クラウド'], gameNames: ['最终幻想 VII 重制版'], translationInstruction: '优先官方译名' })
    expect(prompt).toContain('当前游戏或上下文关键词：最终幻想 VII 重制版')
    expect(prompt).toContain('用户附加翻译要求：优先官方译名')
    expect(prompt).toContain('只输出 JSON')
  })

  it('drops sentence-like or untranslated dictionary entries', () => {
    const result = parseQwenVisionResponse('{"correctedText":"テスト","translation":"测试","entries":[{"observed":"テスト。","canonical":"テスト","target":"测试"},{"observed":"テスト","canonical":"テスト","target":"テスト"}]}', 'テスト')
    expect(result?.entries).toEqual([])
  })
})
