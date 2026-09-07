import type { Box, TextRegion } from '../types'

export type StabilizerSettings = {
  missingGraceFrames: number
}
export const defaultStabilizerSettings: StabilizerSettings = {
  missingGraceFrames: 1,
}
export type StabilizedObservation = { visible: TextRegion[]; ready: TextRegion[] }

type Track = {
  id: string
  region: TextRegion
  displayBox: Box
  normalized: string
  missingFrames: number
  committedText: string
  candidateText: string
  candidateFrames: number
}

const normalize = (text: string) => text.replace(/\s/gu, '').trim()
const area = (box: Box) => Math.max(1, box.x1 - box.x0) * Math.max(1, box.y1 - box.y0)
const intersection = (a: Box, b: Box) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0))
const iou = (a: Box, b: Box) => { const overlap = intersection(a, b); return overlap / Math.max(1, area(a) + area(b) - overlap) }
const verticalOverlap = (a: Box, b: Box) => Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)) / Math.max(1, Math.min(a.y1 - a.y0, b.y1 - b.y0))
const smoothCoordinate = (current: number, next: number) => Math.abs(current - next) <= 2 ? current : current + (next - current) * .55
const smoothBox = (current: Box, next: Box): Box => ({
  x0: smoothCoordinate(current.x0, next.x0), y0: smoothCoordinate(current.y0, next.y0),
  x1: smoothCoordinate(current.x1, next.x1), y1: smoothCoordinate(current.y1, next.y1),
})
const followStableDisplayBox = (current: Box, next: Box): Box => {
  const currentWidth = Math.max(1, current.x1 - current.x0), currentHeight = Math.max(1, current.y1 - current.y0)
  const nextWidth = Math.max(1, next.x1 - next.x0), nextHeight = Math.max(1, next.y1 - next.y0)
  // A real layout change should snap immediately. Small OCR jitter is smoothed,
  // including width/height: freezing the old size caused growing dialogue and
  // menu labels to be clipped or visibly offset from the current video frame.
  if (Math.abs(nextWidth - currentWidth) > currentWidth * .35 || Math.abs(nextHeight - currentHeight) > currentHeight * .35) return { ...next }
  return smoothBox(current, next)
}

function continuation(previous: string, next: string) {
  if (!previous || !next) return false
  if (next.startsWith(previous) || previous.startsWith(next)) return true
  const limit = Math.min(previous.length, next.length)
  let prefix = 0
  while (prefix < limit && previous[prefix] === next[prefix]) prefix++
  return prefix / Math.max(1, limit) >= .7
}

function matchScore(track: Track, region: TextRegion) {
  const boxIou = iou(track.region.box, region.box)
  const height = Math.max(1, track.region.box.y1 - track.region.box.y0, region.box.y1 - region.box.y0)
  const leftAnchored = Math.abs(track.region.box.x0 - region.box.x0) <= height * 2 && verticalOverlap(track.region.box, region.box) >= .6
  if (boxIou < .2 && !leftAnchored) return -1
  const textBonus = continuation(track.normalized, normalize(region.source)) ? .6 : 0
  return boxIou + textBonus + (leftAnchored ? .25 : 0)
}

export class DialogueStabilizer {
  private tracks: Track[] = []
  private nextId = 1

  reset() { this.tracks = []; this.nextId = 1 }

  commit(id: string, source: string) {
    const track = this.tracks.find((candidate) => candidate.id === id)
    if (track && track.region.source === source) track.committedText = source
  }

  isCurrent(id: string, source: string) { return this.tracks.some((track) => track.id === id && track.region.source === source) }

  observe(regions: TextRegion[], overrides: Partial<StabilizerSettings> = {}): StabilizedObservation {
    const settings = { ...defaultStabilizerSettings, ...overrides }
    const unmatched = new Set(this.tracks)
    const visible: TextRegion[] = []

    for (const region of regions) {
      let match: Track | undefined
      let bestScore = -1
      for (const candidate of unmatched) {
        const score = matchScore(candidate, region)
        if (score > bestScore) { bestScore = score; match = candidate }
      }
      if (!match || bestScore < 0) {
        match = { id: `dialogue-${this.nextId++}`, region: { ...region }, displayBox: { ...region.box }, normalized: normalize(region.source), missingFrames: 0, committedText: '', candidateText: '', candidateFrames: 0 }
        this.tracks.push(match)
      } else {
        unmatched.delete(match)
        const nextNormalized = normalize(region.source)
        if (nextNormalized === match.normalized) {
          match.candidateText = ''; match.candidateFrames = 0
          match.region = { ...region, box: smoothBox(match.region.box, region.box) }
          match.displayBox = followStableDisplayBox(match.displayBox, region.box)
        }
        else {
          const progressiveGrowth = continuation(match.normalized, nextNormalized) && nextNormalized.length > match.normalized.length
          // Once translated, require the changed OCR text twice before replacing
          // it. Prefix growth is real typewriter text and remains immediate.
          if (match.committedText === match.region.source && !progressiveGrowth) {
            if (match.candidateText === nextNormalized) match.candidateFrames++
            else { match.candidateText = nextNormalized; match.candidateFrames = 1 }
            if (match.candidateFrames < 2) {
              match.region = { ...match.region, box: smoothBox(match.region.box, region.box) }
              match.displayBox = followStableDisplayBox(match.displayBox, region.box); match.missingFrames = 0
              visible.push({ ...match.region, box: { ...match.displayBox }, id: match.id, translated: '' }); continue
            }
            match.candidateText = ''; match.candidateFrames = 0
          }
          match.normalized = nextNormalized
          match.region = { ...region }
          match.displayBox = progressiveGrowth ? followStableDisplayBox(match.displayBox, region.box) : { ...region.box }
        }
        match.missingFrames = 0
      }
      visible.push({ ...match.region, box: { ...match.displayBox }, id: match.id, translated: '' })
    }

    for (const track of unmatched) track.missingFrames++
    for (const track of unmatched) if (track.missingFrames <= settings.missingGraceFrames) visible.push({ ...track.region, box: { ...track.displayBox }, id: track.id, translated: '' })
    this.tracks = this.tracks.filter((track) => track.missingFrames <= settings.missingGraceFrames)

    const ready = visible.filter((region) => {
      const track = this.tracks.find((candidate) => candidate.id === region.id)!
      return !track.missingFrames && track.committedText !== track.region.source
    })
    return { visible, ready }
  }
}
