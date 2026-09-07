export type GlossaryCategory = 'character' | 'location' | 'race' | 'system' | 'monster' | 'ui' | 'learned'
export type GlossaryEntry = { source: string; target: string; category: GlossaryCategory }

// Kept open so a future server catalog can add games without changing routing.
export type GameId = string

export interface GameProfile {
  id: GameId
  label: string
  description: string
  searchNames: string[]
}

export type GameDictionaryPack = {
  schemaVersion: 1
  gameId: GameId
  version: string
  entries: GlossaryEntry[]
  searchExclusions?: string[]
}
