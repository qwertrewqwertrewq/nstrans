const normalizeText = (text: string) => text.normalize('NFKC').replace(/\s+/gu, '').trim()

function editDistanceWithin(left: string, right: string, maximum: number) {
  if (Math.abs(left.length - right.length) > maximum) return maximum + 1
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex++) {
    const current = [leftIndex]
    let rowMinimum = current[0]
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex++) {
      const value = left[leftIndex - 1] === right[rightIndex - 1]
        ? previous[rightIndex - 1]
        : 1 + Math.min(previous[rightIndex], current[rightIndex - 1], previous[rightIndex - 1])
      current.push(value)
      rowMinimum = Math.min(rowMinimum, value)
    }
    if (rowMinimum > maximum) return maximum + 1
    previous = current
  }
  return previous[right.length]
}

export function textDifferenceRatio(left: string, right: string) {
  const normalizedLeft = normalizeText(left), normalizedRight = normalizeText(right)
  const length = Math.max(normalizedLeft.length, normalizedRight.length)
  if (!length) return 0
  return editDistanceWithin(normalizedLeft, normalizedRight, length) / length
}

type ReuseFamily<T> = { aliases: string[]; value: T; updatedAt: number }
export type ReusedTranslation<T> = { value: T; matchedSource: string; differenceRatio: number; recursiveAlias: boolean }

export class RecursiveTranslationReuse<T> {
  private families: ReuseFamily<T>[] = []
  private readonly threshold: number
  private readonly maximumFamilies: number
  private readonly maximumAliases: number

  constructor(threshold = .1, maximumFamilies = 256, maximumAliases = 64) {
    this.threshold = threshold
    this.maximumFamilies = maximumFamilies
    this.maximumAliases = maximumAliases
  }

  clear() { this.families = [] }

  resolve(source: string): ReusedTranslation<T> | undefined {
    const normalized = normalizeText(source)
    if (!normalized) return undefined
    let best: { family: ReuseFamily<T>; alias: string; ratio: number } | undefined
    for (const family of this.families) for (const alias of family.aliases) {
      const maximum = Math.floor(Math.max(normalized.length, alias.length) * this.threshold)
      const distance = editDistanceWithin(normalized, alias, maximum)
      if (distance > maximum) continue
      const ratio = distance / Math.max(1, normalized.length, alias.length)
      if (!best || ratio < best.ratio) best = { family, alias, ratio }
    }
    if (!best) return undefined
    const recursiveAlias = !best.family.aliases.includes(normalized)
    if (recursiveAlias) {
      best.family.aliases.push(normalized)
      if (best.family.aliases.length > this.maximumAliases) best.family.aliases.splice(0, best.family.aliases.length - this.maximumAliases)
    }
    best.family.updatedAt = Date.now()
    return { value: best.family.value, matchedSource: best.alias, differenceRatio: best.ratio, recursiveAlias }
  }

  remember(source: string, value: T) {
    const normalized = normalizeText(source)
    if (!normalized) return
    const exact = this.families.find((family) => family.aliases.includes(normalized))
    if (exact) {
      exact.value = value
      exact.updatedAt = Date.now()
      return
    }
    this.families.push({ aliases: [normalized], value, updatedAt: Date.now() })
    if (this.families.length > this.maximumFamilies) {
      this.families.sort((left, right) => right.updatedAt - left.updatedAt)
      this.families.length = this.maximumFamilies
    }
  }
}
