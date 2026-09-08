export type EntitySearchEngineId = 'wiki' | 'brave' | 'qianfan' | 'qwen'
export type RemoteModelCapability = 'multimodal-search' | 'search-only' | 'offline'
export type RemoteModelProfile = {
  id: string
  name: string
  model: string
  capability: RemoteModelCapability
  endpoint?: string
  apiKey?: string
  preset?: boolean
}

const multimodalModels = ['qwen3.8-flash', 'qwen3.8-max', 'qwen3.8-max-0902', 'qwen3.8-27b', 'qwen3.8-2.4t-a95b', 'qwen3.7-flash', 'qwen3.7-plus', 'qwen3.7-max', 'qwen3.6-flash', 'qwen3.6-plus', 'qwen3.5-flash', 'qwen3.5-plus', 'qwen-plus', 'qwen-max', 'qwen3-vl-flash', 'qwen3-vl-plus', 'qwen3-vl-8b-instruct', 'qwen3-vl-30b-a3b-instruct', 'qwen3-vl-32b-instruct', 'qwen3-vl-235b-a22b-instruct'] as const
const searchOnlyModels = ['qwen3-8b', 'qwen3-14b', 'qwen3-32b', 'qwen3-30b-a3b', 'qwen3-235b-a22b', 'qwen3.5-27b', 'qwen3.5-35b-a3b', 'qwen3.5-122b-a10b', 'qwen3.5-397b-a17b', 'qwen3.6-27b', 'qwen3.6-35b-a3b'] as const
export const remoteModelPresets: RemoteModelProfile[] = [
  ...multimodalModels.map((model) => ({
    id: `preset:${model}`,
    name: model,
    model,
    capability: 'multimodal-search' as const,
    preset: true,
  })),
  ...searchOnlyModels.map((model) => ({
    id: `preset:${model}`,
    name: model,
    model,
    capability: 'search-only' as const,
    preset: true,
  })),
]

export type EntitySearchSettings = {
  primary: EntitySearchEngineId
  fallback: EntitySearchEngineId | 'none'
  braveApiKey: string
  qianfanApiKey: string
  qwenApiKey: string
  qwenEndpoint: string
  remoteModels: RemoteModelProfile[]
  searchModelId: string
  coreModelId: string
  visionFallbackEnabled: boolean
  visionModelId: string
}

export const defaultEntitySearchSettings: EntitySearchSettings = {
  primary: 'wiki',
  fallback: 'none',
  braveApiKey: '',
  qianfanApiKey: '',
  qwenApiKey: '',
  qwenEndpoint: '',
  remoteModels: remoteModelPresets,
  searchModelId: 'preset:qwen3.7-flash',
  coreModelId: 'preset:qwen3.8-flash',
  visionFallbackEnabled: false,
  visionModelId: 'preset:qwen3.8-flash',
}

const STORAGE_KEY = 'yomilens.entity-search.v1'

export function loadEntitySearchSettings(): EntitySearchSettings {
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null') as Record<string, unknown> | null
    if (!stored) return defaultEntitySearchSettings
    const primary = stored.primary === 'qwen37' || stored.primary === 'qwen38' ? 'qwen' : stored.primary
    const fallback = stored.fallback === 'qwen37' || stored.fallback === 'qwen38' ? 'qwen' : stored.fallback
    const customModels = Array.isArray(stored.remoteModels) ? stored.remoteModels.filter(validProfile).filter((item) => !item.preset) : []
    const models = [...remoteModelPresets, ...customModels]
    const legacyVision = stored.visionFallbackModel === 'qwen3.7-flash' ? 'preset:qwen3.7-flash' : 'preset:qwen3.8-flash'
    return {
      primary: isEngine(primary) ? primary : 'wiki',
      fallback: fallback === 'none' || isEngine(fallback) ? fallback : 'none',
      braveApiKey: typeof stored.braveApiKey === 'string' ? stored.braveApiKey : '',
      qianfanApiKey: typeof stored.qianfanApiKey === 'string' ? stored.qianfanApiKey : '',
      qwenApiKey: typeof stored.qwenApiKey === 'string' ? stored.qwenApiKey : '',
      qwenEndpoint: typeof stored.qwenEndpoint === 'string' ? stored.qwenEndpoint : '',
      remoteModels: models,
      searchModelId: typeof stored.searchModelId === 'string' && models.some(({ id, capability }) => id === stored.searchModelId && capability !== 'offline') ? stored.searchModelId : 'preset:qwen3.7-flash',
      coreModelId: typeof stored.coreModelId === 'string' && models.some(({ id, capability }) => id === stored.coreModelId && capability !== 'offline') ? stored.coreModelId : 'preset:qwen3.8-flash',
      visionFallbackEnabled: stored.visionFallbackEnabled === true,
      visionModelId: typeof stored.visionModelId === 'string' && models.some(({ id, capability }) => id === stored.visionModelId && capability === 'multimodal-search') ? stored.visionModelId : legacyVision,
    }
  } catch {
    return defaultEntitySearchSettings
  }
}

export function saveEntitySearchSettings(settings: EntitySearchSettings) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    /* Search still works for this session. */
  }
}

export function searchEngineKey(settings: EntitySearchSettings, engine: EntitySearchEngineId) {
  if (engine === 'brave') return settings.braveApiKey.trim()
  if (engine === 'qianfan') return settings.qianfanApiKey.trim()
  if (engine === 'qwen') return remoteModelCredentials(settings, 'search')?.apiKey ?? ''
  return ''
}

export const entitySearchEngineLabels: Record<EntitySearchEngineId, string> = {
  wiki: '免费 Wiki',
  brave: 'Brave Search',
  qianfan: '百度千帆',
  qwen: '千问远程模型',
}

function isEngine(value: unknown): value is EntitySearchEngineId {
  return value === 'wiki' || value === 'brave' || value === 'qianfan' || value === 'qwen'
}

const validProfile = (value: unknown): value is RemoteModelProfile => Boolean(value && typeof value === 'object' && typeof Reflect.get(value, 'id') === 'string' && typeof Reflect.get(value, 'name') === 'string' && typeof Reflect.get(value, 'model') === 'string' && ['multimodal-search', 'search-only', 'offline'].includes(String(Reflect.get(value, 'capability'))))
export function remoteModel(settings: EntitySearchSettings, purpose: 'search' | 'vision' | 'core') {
  const id = purpose === 'vision' ? settings.visionModelId : purpose === 'core' ? settings.coreModelId : settings.searchModelId
  return settings.remoteModels.find((item) => item.id === id && (purpose === 'vision' ? item.capability === 'multimodal-search' : item.capability !== 'offline'))
}
export function remoteModelCredentials(settings: EntitySearchSettings, purpose: 'search' | 'vision' | 'core') {
  const profile = remoteModel(settings, purpose)
  return profile
    ? {
        ...profile,
        apiKey: profile.apiKey?.trim() || settings.qwenApiKey.trim(),
        endpoint: profile.endpoint?.trim() || settings.qwenEndpoint.trim(),
      }
    : undefined
}
