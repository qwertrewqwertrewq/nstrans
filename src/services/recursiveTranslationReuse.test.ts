import { describe, expect, it } from 'vitest'
import { RecursiveTranslationReuse, textDifferenceRatio } from './recursiveTranslationReuse'

describe('RecursiveTranslationReuse', () => {
  it('reuses translations when normalized edit difference is at most ten percent', () => {
    const cache = new RecursiveTranslationReuse<string>()
    cache.remember('ハイラル平原へ向かいます', '前往海拉鲁平原')
    expect(cache.resolve('ハイラル平原に向かいます')?.value).toBe('前往海拉鲁平原')
    expect(textDifferenceRatio('ハイラル平原へ向かいます', 'ハイラル平原に向かいます')).toBeLessThanOrEqual(.1)
  })

  it('chains aliases recursively instead of comparing only with the original', () => {
    const cache = new RecursiveTranslationReuse<string>()
    cache.remember('1234567890', '译文')
    expect(cache.resolve('123456789A')?.value).toBe('译文')
    expect(cache.resolve('12345678BA')?.value).toBe('译文')
    expect(textDifferenceRatio('1234567890', '12345678BA')).toBeGreaterThan(.1)
  })

  it('does not reuse text outside the recursive family threshold', () => {
    const cache = new RecursiveTranslationReuse<string>()
    cache.remember('ゼルダ姫を探してください', '请寻找塞尔达公主')
    expect(cache.resolve('扉を開けてください')).toBeUndefined()
  })
})
