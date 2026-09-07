export type EntitySearchEngineId = 'wiki' | 'brave' | 'qianfan'

export type EntitySearchSettings = {
  primary: EntitySearchEngineId
  fallback: EntitySearchEngineId | 'none'
  braveApiKey: string
  qianfanApiKey: string
}

export const defaultEntitySearchSettings: EntitySearchSettings = {
  primary: 'wiki',
  fallback: 'none',
  braveApiKey: '',
  qianfanApiKey: '',
}

const STORAGE_KEY = 'yomilens.entity-search.v1'

export function loadEntitySearchSettings(): EntitySearchSettings {
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<EntitySearchSettings> | null
    if (!stored || !isEngine(stored.primary)) return defaultEntitySearchSettings
    return {
      primary: stored.primary,
      fallback: stored.fallback === 'none' || isEngine(stored.fallback) ? stored.fallback : 'none',
      braveApiKey: typeof stored.braveApiKey === 'string' ? stored.braveApiKey : '',
      qianfanApiKey: typeof stored.qianfanApiKey === 'string' ? stored.qianfanApiKey : '',
    }
  } catch { return defaultEntitySearchSettings }
}

export function saveEntitySearchSettings(settings: EntitySearchSettings) {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)) } catch { /* Search still works for this session. */ }
}

export function searchEngineKey(settings: EntitySearchSettings, engine: EntitySearchEngineId) {
  if (engine === 'brave') return settings.braveApiKey.trim()
  if (engine === 'qianfan') return settings.qianfanApiKey.trim()
  return ''
}

export const entitySearchEngineLabels: Record<EntitySearchEngineId, string> = {
  wiki: '免费 Wiki',
  brave: 'Brave Search',
  qianfan: '百度千帆',
}

function isEngine(value: unknown): value is EntitySearchEngineId {
  return value === 'wiki' || value === 'brave' || value === 'qianfan'
}
