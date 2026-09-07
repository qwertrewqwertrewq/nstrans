import { describe, expect, it } from 'vitest'
import { containsJapaneseKana, validateTranslation } from './translationQuality'

describe('translation quality', () => {
  it('rejects mixed Japanese and Chinese output', () => {
    expect(containsJapaneseKana('ジニオ的神殿')).toBe(true)
    expect(validateTranslation('ジオシニオの祠', 'ジニオ的神殿', 'zh-Hans').valid).toBe(false)
  })

  it('accepts a fully translated Chinese proper noun', () => {
    expect(validateTranslation('ジオシニオの祠', '吉欧希尼欧神庙', 'zh-Hans').valid).toBe(true)
  })

  it('rejects copying the Japanese source unchanged', () => {
    expect(validateTranslation('ハイラル平原', 'ハイラル平原', 'zh-Hans').valid).toBe(false)
  })
})
