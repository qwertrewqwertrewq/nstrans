import type { GameId, GameProfile } from './types'

const generalProfile: GameProfile =
  { id: 'general', label: '通用游戏', description: '通用类别；词库将在服务器配置后按版本下载。', searchNames: [] }

export const gameOptions: readonly GameProfile[] = [
  { id: 'zelda-totk', label: '塞尔达传说：王国之泪', description: '仅提供游戏名称作为通用检索上下文，不内置词条或专有数据源。', searchNames: ['ゼルダの伝説 ティアーズ オブ ザ キングダム', '塞尔达传说 王国之泪'] },
]

export function getGameProfile(id: GameId) { return id === 'general' ? generalProfile : gameOptions.find((game) => game.id === id) ?? generalProfile }
