const JAPANESE_KANA = /[\p{Script=Hiragana}\p{Script=Katakana}ー]/u

export type TranslationValidation = { valid: true } | { valid: false; reason: string }

export function containsJapaneseKana(text: string) {
  return JAPANESE_KANA.test(text)
}

export function validateTranslation(source: string, target: string, targetLanguage: string): TranslationValidation {
  const normalizedTarget = target.trim()
  if (!normalizedTarget) return { valid: false, reason: 'translation is empty' }
  if (targetLanguage !== 'zh-Hans') return { valid: true }
  if (containsJapaneseKana(normalizedTarget)) {
    return { valid: false, reason: 'Simplified Chinese output still contains Japanese hiragana or katakana' }
  }
  if (containsJapaneseKana(source) && normalizedTarget === source.trim()) {
    return { valid: false, reason: 'Japanese source was copied without translation' }
  }
  return { valid: true }
}
