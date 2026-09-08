import { describe, expect, it } from 'vitest'
import { parseQwenVisionResponse } from './qwenFlash'

describe('Qwen vision fallback response', () => {
  it('keeps both the noisy OCR spelling and canonical Japanese term', () => {
    expect(parseQwenVisionResponse(JSON.stringify({ correctedText: 'ゼルダ', translation: '塞尔达', entries: [{ observed: '世儿夕', canonical: 'ゼルダ', target: '塞尔达' }, { observed: 'ゼルダ', canonical: 'ゼルダ', target: '塞尔达' }] }), '世儿夕')).toEqual({
      correctedText: 'ゼルダ', translation: '塞尔达', entries: [
        { observed: '世儿夕', canonical: 'ゼルダ', target: '塞尔达' },
        { observed: 'ゼルダ', canonical: 'ゼルダ', target: '塞尔达' },
      ],
    })
  })

  it('drops sentence-like or untranslated dictionary entries', () => {
    const result = parseQwenVisionResponse('{"correctedText":"テスト","translation":"测试","entries":[{"observed":"テスト。","canonical":"テスト","target":"测试"},{"observed":"テスト","canonical":"テスト","target":"テスト"}]}', 'テスト')
    expect(result?.entries).toEqual([])
  })
})
