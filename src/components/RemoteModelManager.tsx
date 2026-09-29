import { useMemo, useState } from 'react'
import { ChevronDown, Plus, Trash2 } from 'lucide-react'
import type { EntitySearchSettings, RemoteModelCapability, RemoteModelProfile } from '../services/entitySearchSettings'

const capabilityLabels: Record<RemoteModelCapability, string> = {
  'multimodal-search': '多模态 + 搜索',
  'search-only': '仅搜索',
  offline: '离线模型（未来）',
}

type RemoteModelManagerMode = 'full' | 'models' | 'credentials'

export function RemoteModelManager({ settings, onChange, mode = 'full' }: { settings: EntitySearchSettings; onChange(next: Partial<EntitySearchSettings>): void; mode?: RemoteModelManagerMode }) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({
    name: '',
    model: '',
    endpoint: '',
    apiKey: '',
    capability: 'multimodal-search' as RemoteModelCapability,
  })
  const searchModels = useMemo(() => settings.remoteModels.filter(({ capability }) => capability !== 'offline'), [settings.remoteModels])
  const visionModels = useMemo(() => settings.remoteModels.filter(({ capability }) => capability === 'multimodal-search'), [settings.remoteModels])
  const showCredentials = mode !== 'models'
  const showModels = mode !== 'credentials'
  const addModel = () => {
    const model = draft.model.trim(),
      name = draft.name.trim() || model
    if (!model) return
    const profile: RemoteModelProfile = {
      id: `custom:${Date.now()}`,
      name,
      model,
      capability: draft.capability,
      endpoint: draft.endpoint.trim(),
      apiKey: draft.apiKey.trim(),
    }
    onChange({ remoteModels: [...settings.remoteModels, profile] })
    setDraft({
      name: '',
      model: '',
      endpoint: '',
      apiKey: '',
      capability: 'multimodal-search',
    })
    setAdding(false)
  }
  const removeModel = (id: string) => {
    const remoteModels = settings.remoteModels.filter((item) => item.id !== id)
    onChange({
      remoteModels,
      searchModelId: settings.searchModelId === id ? 'preset:qwen3.7-flash' : settings.searchModelId,
      coreModelId: settings.coreModelId === id ? 'preset:qwen3.8-flash' : settings.coreModelId,
      visionModelId: settings.visionModelId === id ? 'preset:qwen3.8-flash' : settings.visionModelId,
    })
  }
  return (
    <div className="remote-model-manager">
      {showCredentials && <div className="remote-defaults">
        <label>阿里百炼（千问）通用 API Key</label>
        <input type="password" value={settings.qwenApiKey} onChange={(event) => onChange({ qwenApiKey: event.target.value })} placeholder="DashScope API Key" autoComplete="off" />
        <label>自定义 API 端点（可选）</label>
        <input type="url" value={settings.qwenEndpoint} onChange={(event) => onChange({ qwenEndpoint: event.target.value })} placeholder="留空使用 DashScope 默认端点" />
      </div>}
      {showModels && <><div className="inline-select">
        <label>术语搜索模型</label>
        <div className="select-wrap">
          <select value={settings.searchModelId} onChange={(event) => onChange({ searchModelId: event.target.value })}>
            {searchModels.map((item) => (
              <option value={item.id} key={item.id}>
                {item.name} · {capabilityLabels[item.capability]}
              </option>
            ))}
          </select>
          <ChevronDown size={13} />
        </div>
      </div>
      <div className="inline-select">
        <label>远程视觉模型</label>
        <div className="select-wrap">
          <select value={settings.visionModelId} onChange={(event) => onChange({ visionModelId: event.target.value })}>
            {visionModels.map((item) => (
              <option value={item.id} key={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <ChevronDown size={13} />
        </div>
      </div>
      <div className="remote-model-summary">
        <span>{visionModels.length} 个多模态预设</span>
        <span>{searchModels.length - visionModels.length} 个仅搜索预设</span>
        <span>{settings.remoteModels.filter(({ capability }) => capability === 'offline').length} 个离线配置</span>
      </div>
      <button className="secondary model-add-button" onClick={() => setAdding((value) => !value)}>
        <Plus size={14} />
        添加自定义模型
      </button>
      {adding && (
        <div className="custom-model-form">
          <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="显示名称（可选）" />
          <input value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })} placeholder="模型 ID" />
          <div className="select-wrap">
            <select
              value={draft.capability}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  capability: event.target.value as RemoteModelCapability,
                })
              }
            >
              {Object.entries(capabilityLabels).map(([id, label]) => (
                <option value={id} key={id}>
                  {label}
                </option>
              ))}
            </select>
            <ChevronDown size={13} />
          </div>
          {mode === 'full' && <input type="url" value={draft.endpoint} onChange={(event) => setDraft({ ...draft, endpoint: event.target.value })} placeholder="API 端点（可继承通用端点）" />}
          {mode === 'full' && <input type="password" value={draft.apiKey} onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })} placeholder="API Key（可继承通用 Key）" autoComplete="off" />}
          <button className="primary" disabled={!draft.model.trim()} onClick={addModel}>
            保存模型
          </button>
        </div>
      )}
      {settings.remoteModels.some((item) => !item.preset) && (
        <div className="custom-model-list">
          {settings.remoteModels
            .filter((item) => !item.preset)
            .map((item) => (
              <div key={item.id}>
                <span>
                  <strong>{item.name}</strong>
                  <small>
                    {item.model} · {capabilityLabels[item.capability]}
                  </small>
                </span>
                <button title="删除自定义模型" onClick={() => removeModel(item.id)}>
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
        </div>
      )}
      <small className="muted">多模态 + 搜索模型可同时用于术语查询和远程视觉识别；仅搜索模型不会接收截图；离线模型当前只保存配置，不参与自动路由。核心翻译模型请在“翻译与词库”中选择。</small>
      </>}
      {mode === 'credentials' && settings.remoteModels.some((item) => !item.preset) && (
        <div className="custom-model-credentials">
          <label>自定义模型凭据覆盖</label>
          {settings.remoteModels.filter((item) => !item.preset).map((item) => (
            <div key={item.id}>
              <strong>{item.name}</strong>
              <input type="url" value={item.endpoint ?? ''} onChange={(event) => onChange({ remoteModels: settings.remoteModels.map((model) => model.id === item.id ? { ...model, endpoint: event.target.value } : model) })} placeholder="继承通用 API 端点" />
              <input type="password" value={item.apiKey ?? ''} onChange={(event) => onChange({ remoteModels: settings.remoteModels.map((model) => model.id === item.id ? { ...model, apiKey: event.target.value } : model) })} placeholder="继承阿里百炼（千问）通用 API Key" autoComplete="off" />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
