import type { GameId, GameProfile } from './types'

const generalProfile: GameProfile =
  { id: 'general', label: '通用游戏', description: '通用类别；词库将在服务器配置后按版本下载。', searchNames: [] }

const communityProfilesStorageKey = 'nstrans.community-game-catalog.v1'

export const gameOptions: readonly GameProfile[] = [
  { id: 'zelda-totk', label: '塞尔达传说：王国之泪', description: '仅提供游戏名称作为通用检索上下文，不内置词条或专有数据源。', searchNames: ['ゼルダの伝説 ティアーズ オブ ザ キングダム', '塞尔达传说 王国之泪'] },
]

function validCommunityProfile(value: unknown): value is GameProfile {
  return Boolean(
    value
      && typeof value === 'object'
      && typeof Reflect.get(value, 'id') === 'string'
      && typeof Reflect.get(value, 'label') === 'string'
      && typeof Reflect.get(value, 'description') === 'string'
      && Array.isArray(Reflect.get(value, 'searchNames'))
      && (Reflect.get(value, 'searchNames') as unknown[]).every((name) => typeof name === 'string'),
  )
}

export function loadCommunityGameProfiles(): GameProfile[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const stored = JSON.parse(localStorage.getItem(communityProfilesStorageKey) ?? '[]') as unknown
    return Array.isArray(stored) ? stored.filter(validCommunityProfile) : []
  } catch {
    return []
  }
}

export function saveCommunityGameProfiles(profiles: GameProfile[]) {
  localStorage.setItem(communityProfilesStorageKey, JSON.stringify(profiles))
  return profiles
}

export function getGameProfile(id: GameId) {
  return id === 'general'
    ? generalProfile
    : gameOptions.find((game) => game.id === id) ?? loadCommunityGameProfiles().find((game) => game.id === id) ?? generalProfile
}
