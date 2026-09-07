import type { GlossaryEntry } from './types'

const normalize = (text: string) => text.normalize('NFKC').replace(/\s/gu, '').trim()
// Safe residuals for compact game labels: direction/modifier kanji, counters,
// coordinates and separators. Hiragana and unmatched katakana deliberately
// fail, preventing mixed-language output for ordinary Japanese sentences.
const safeResidual = /^[\p{Script=Han}\p{N}々〆ヵヶ・･…—+＋\-/／:：()[\]（）【】「」『』]*$/u

/**
 * Rebuilds compact labels from known terms without asking a translation model.
 * Longest terms win, and every unmatched character must be safe label syntax.
 */
export function composeKnownTerms(text: string, glossary: readonly GlossaryEntry[]): GlossaryEntry | undefined {
  const source = normalize(text)
  if (!source) return undefined
  const terms = [...glossary]
    .map((entry) => ({ entry, normalized: normalize(entry.source) }))
    .filter(({ normalized }) => normalized && source.includes(normalized))
    .sort((a, b) => b.normalized.length - a.normalized.length)
  if (!terms.length) return undefined

  let translated = '', residual = '', matched = false, category = terms[0].entry.category
  for (let index = 0; index < source.length;) {
    const term = terms.find(({ normalized }) => source.startsWith(normalized, index))
    if (term) {
      translated += term.entry.target
      category = term.entry.category
      matched = true
      index += term.normalized.length
    } else {
      translated += source[index]
      residual += source[index]
      index += 1
    }
  }
  if (!matched || !safeResidual.test(residual)) return undefined
  return { source: text, target: translated, category }
}
