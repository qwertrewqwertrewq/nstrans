export type User = {
  id: number
  login: string
  role: 'admin' | 'user'
  avatar_url?: string
  github_bound: boolean
}
export type Stats = { games: number; terms: number; translations: number; contributors: number }
export type Game = {
  id: string
  chinese_name: string
  japanese_name: string
  poster_url: string
  status: string
}
export type Key = {
  id: number
  key_prefix: string
  origin?: string
  device_name?: string
  created_at: string
  last_used_at?: string
}
export type Translation = { id: number; target: string; score: number }
export type Term = {
  id: number
  source: string
  kind: 'term' | 'phrase'
  translations: Translation[]
}
export type Exclusion = { source_text: string; source_name: string; source_url: string }
export type TermsResponse = {
  terms: Term[]
  searchExclusions?: Exclusion[]
  searchExclusionCount?: number
}
export type Policy = {
  target_version: string
  download_url: string
  popup_enabled: number
  force_update: number
  content: string
}
