import { useMemo, useState, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, Check, ChevronDown, Download, ExternalLink, Moon, Sun, WandSparkles } from 'lucide-react'
import { isTauri } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'
import type { ClientPlatform } from '../services/clientPlatform'
import { entitySearchEngineLabels, remoteModelCredentials, type EntitySearchEngineId, type EntitySearchSettings } from '../services/entitySearchSettings'
import type { GameProfile } from '../gameAdapters/types'
import type { LlamaBackend, ModelDownloadProgress } from '../services/translationRuntime'
import type { MachineTranslationProvider, TranslationRoutingSettings } from '../types'
import { CommunityAccountAccess } from './CommunityAccountAccess'
import type { OfficialBuildInfo } from '../services/communityAccount'

type LocalTranslationChoice = 'llm' | 'machine'
type TranslationChoice = 'local' | 'remote' | 'web'

type SetupWizardProps = {
  theme: 'dark' | 'light'
  platform: ClientPlatform
  localRuntimeBundled: boolean
  routing: TranslationRoutingSettings
  runtimeStatus: { translategemma: boolean; 'nllb-600m': boolean }
  llamaBackend: LlamaBackend
  installingModel: boolean
  nllbPreparing: boolean
  modelProgress: ModelDownloadProgress | null
  modelStatus: string
  nllbStatus: string
  sharingEnabled: boolean
  communityApiKey: string
  officialBuild: OfficialBuildInfo
  games: readonly GameProfile[]
  onThemeChange(theme: 'dark' | 'light'): void
  onRoutingChange(patch: Partial<Pick<TranslationRoutingSettings, 'coreTranslationEngine' | 'machineTranslationProvider'>>): void
  onEntityLookupChange(enabled: boolean): void
  onEntitySearchChange(patch: Partial<EntitySearchSettings>): void
  onBackendChange(backend: LlamaBackend): void
  onDownloadTranslateGemma(): void
  onDownloadNllb(): void
  onCommunityKeyChange(value: string): void
  onSharingChange(enabled: boolean): void
  onGameChange(gameId: string): void
  onCreateGame(input: { chineseName: string; japaneseName?: string; posterUrl?: string }): Promise<void>
  onComplete(): void
  onExit(): void
}

const qwenKeyUrl = 'https://bailian.console.aliyun.com/cn-beijing/model/settings/api-key'
const braveKeyUrl = 'https://api-dashboard.search.brave.com/app/keys'
const qianfanKeyUrl = 'https://console.bce.baidu.com/qianfan/ais/console/apiKey'
const communityOrigin = 'https://nstrans.221129.xyz'

function KeyLink({ href, children }: { href: string; children: string }) {
  return <a className="wizard-link" href={href} target="_blank" rel="noreferrer" onClick={(event) => {
    if (!isTauri()) return
    event.preventDefault()
    void openUrl(href)
  }}>{children}<ExternalLink size={13} /></a>
}

function Select({ value, onChange, children, label }: { value: string; onChange(value: string): void; children: ReactNode; label: string }) {
  return <div className="select-wrap"><select value={value} onChange={(event) => onChange(event.target.value)} aria-label={label}>{children}</select><ChevronDown size={14} /></div>
}

function EngineHelp({ engine, settings, onChange }: { engine: EntitySearchEngineId; settings: EntitySearchSettings; onChange(patch: Partial<EntitySearchSettings>): void }) {
  if (engine === 'wiki') return <div className="wizard-help"><strong>免费 Wiki</strong><span>无需 API Key，需要可访问 Wikipedia / Wikidata 的网络环境。</span></div>
  if (engine === 'wiki-mirror') return <div className="wizard-help"><strong>wiki镜像</strong><span>通过 NSTrans 社区转发 Wiki 查询，使用登录后自动保存的社区密钥。需要能够连接社区服务。</span></div>
  if (engine === 'qwen') return <div className="wizard-key-block"><div className="wizard-help"><strong>阿里百炼（千问）</strong><span>无需访问公开搜索网页，但设备仍需连接阿里百炼 API。</span></div><input type="password" value={settings.qwenApiKey} onChange={(event) => onChange({ qwenApiKey: event.target.value })} placeholder="DashScope API Key" autoComplete="off" /><KeyLink href={qwenKeyUrl}>前往获取 API Key</KeyLink></div>
  if (engine === 'brave') return <div className="wizard-key-block"><div className="wizard-help"><strong>Brave Search</strong><span>需要互联网连接和 Brave Search API Key。</span></div><input type="password" value={settings.braveApiKey} onChange={(event) => onChange({ braveApiKey: event.target.value })} placeholder="Brave Search API Key" autoComplete="off" /><KeyLink href={braveKeyUrl}>前往获取 API Key</KeyLink></div>
  return <div className="wizard-key-block"><div className="wizard-help"><strong>百度千帆</strong><span>无需访问公开搜索网页，但设备仍需连接百度千帆 API。</span></div><input type="password" value={settings.qianfanApiKey} onChange={(event) => onChange({ qianfanApiKey: event.target.value })} placeholder="百度千帆 API Key" autoComplete="off" /><KeyLink href={qianfanKeyUrl}>前往获取 API Key</KeyLink></div>
}

function engineReady(engine: EntitySearchEngineId | 'none', settings: EntitySearchSettings, communityKey: string) {
  if (engine === 'none' || engine === 'wiki') return true
  if (engine === 'wiki-mirror') return Boolean(communityKey.trim())
  if (engine === 'brave') return Boolean(settings.braveApiKey.trim())
  if (engine === 'qianfan') return Boolean(settings.qianfanApiKey.trim())
  return Boolean(settings.qwenApiKey.trim())
}

export function SetupWizard(props: SetupWizardProps) {
  const [step, setStep] = useState(0)
  const [translationChoice, setTranslationChoice] = useState<TranslationChoice>(() => props.routing.coreTranslationEngine === 'remote' ? 'remote' : props.routing.coreTranslationEngine === 'machine' && props.routing.machineTranslationProvider !== 'nllb-600m' ? 'web' : 'local')
  const [localChoice, setLocalChoice] = useState<LocalTranslationChoice>(() => props.routing.coreTranslationEngine === 'machine' ? 'machine' : 'llm')
  const downloadStarted = localChoice === 'llm' ? props.installingModel : props.nllbPreparing
  const [shareChoice, setShareChoice] = useState<'yes' | 'no' | null>(() => props.sharingEnabled || props.communityApiKey.trim() ? 'yes' : null)
  const [newGameOpen, setNewGameOpen] = useState(false)
  const [newGameChineseName, setNewGameChineseName] = useState('')
  const [newGameJapaneseName, setNewGameJapaneseName] = useState('')
  const [newGamePosterUrl, setNewGamePosterUrl] = useState('')
  const [creatingGame, setCreatingGame] = useState(false)
  const [createGameError, setCreateGameError] = useState('')
  const [completed, setCompleted] = useState(false)
  const searchModels = useMemo(() => props.routing.entitySearch.remoteModels.filter((item) => item.capability !== 'offline'), [props.routing.entitySearch.remoteModels])
  const visionModels = useMemo(() => props.routing.entitySearch.remoteModels.filter((item) => item.capability === 'multimodal-search'), [props.routing.entitySearch.remoteModels])
  const steps = ['主题设置', '社区登录与共享', '核心翻译', '专有名词学习', '适配词库', '完成配置']
  const localDownloadReady = localChoice === 'llm' ? props.runtimeStatus.translategemma : props.runtimeStatus['nllb-600m']
  const stepValid = step === 3
    ? translationChoice === 'web'
      || translationChoice === 'remote' && Boolean(props.routing.entitySearch.qwenApiKey.trim() && remoteModelCredentials(props.routing.entitySearch, 'core'))
      || translationChoice === 'local' && props.localRuntimeBundled && (localDownloadReady || downloadStarted)
    : step === 4
      ? !props.routing.entityLookupEnabled || engineReady(props.routing.entitySearch.primary, props.routing.entitySearch, props.communityApiKey) && engineReady(props.routing.entitySearch.fallback, props.routing.entitySearch, props.communityApiKey) && (!props.routing.entitySearch.visionFallbackEnabled || Boolean(props.routing.entitySearch.qwenApiKey.trim() && visionModels.some((model) => model.id === props.routing.entitySearch.visionModelId)))
      : step === 2
        ? shareChoice === 'no' || shareChoice === 'yes' && Boolean(props.communityApiKey.trim())
        : true

  const chooseTranslation = (choice: TranslationChoice) => {
    setTranslationChoice(choice)
    if (choice === 'local') props.onRoutingChange(localChoice === 'llm' ? { coreTranslationEngine: 'local' } : { coreTranslationEngine: 'machine', machineTranslationProvider: 'nllb-600m' })
    if (choice === 'remote') props.onRoutingChange({ coreTranslationEngine: 'remote' })
    if (choice === 'web') props.onRoutingChange({ coreTranslationEngine: 'machine', machineTranslationProvider: props.routing.machineTranslationProvider === 'nllb-600m' ? 'youdao-web' : props.routing.machineTranslationProvider })
  }
  const chooseLocal = (choice: LocalTranslationChoice) => {
    setLocalChoice(choice)
    props.onRoutingChange(choice === 'llm' ? { coreTranslationEngine: 'local' } : { coreTranslationEngine: 'machine', machineTranslationProvider: 'nllb-600m' })
  }
  const startDownload = () => {
    if (localChoice === 'llm') props.onDownloadTranslateGemma()
    else props.onDownloadNllb()
  }
  const next = () => {
    if (!stepValid) return
    if (step === 2) {
      if (shareChoice === 'yes' && !props.communityApiKey.trim()) return
      if (shareChoice === 'no') props.onSharingChange(false)
    }
    if (step < 6) setStep((value) => value + 1)
  }
  const createGame = async () => {
    const chineseName = newGameChineseName.trim(), japaneseName = newGameJapaneseName.trim(), posterUrl = newGamePosterUrl.trim()
    if (!chineseName || !props.communityApiKey.trim()) return
    if (posterUrl && !/^https:\/\//iu.test(posterUrl)) {
      setCreateGameError('封面 URL 必须留空或使用 HTTPS 地址')
      return
    }
    setCreatingGame(true)
    setCreateGameError('')
    try {
      await props.onCreateGame({ chineseName, japaneseName: japaneseName || undefined, posterUrl: posterUrl || undefined })
      setNewGameChineseName('')
      setNewGameJapaneseName('')
      setNewGamePosterUrl('')
      setNewGameOpen(false)
    } catch (reason) {
      setCreateGameError(reason instanceof Error ? reason.message : '社区游戏创建失败')
    } finally {
      setCreatingGame(false)
    }
  }

  if (step === 0) return <div className="setup-wizard wizard-welcome"><div className="wizard-hero-icon"><WandSparkles size={30} /></div><span className="wizard-kicker">NSTrans 初始设置</span><h2>几分钟完成翻译环境配置</h2><p>向导会连接现有的翻译、名词搜索、共享词库与游戏配置。所有密钥只保存在当前设备。</p><button className="primary wizard-start" onClick={() => setStep(1)}>开始配置<ArrowRight size={16} /></button></div>

  return <div className="setup-wizard">
    <div className="wizard-progress" aria-label={`设置向导第 ${step} 步，共 6 步`}><div className="wizard-progress-copy"><span>设置向导</span><strong>{step} / 6 · {steps[step - 1]}</strong></div><div className="wizard-progress-track"><span style={{ width: `${step / 6 * 100}%` }} /></div></div>
    <div className="wizard-content">
      {step === 4 && props.routing.entityLookupEnabled && !props.communityApiKey.trim() && [props.routing.entitySearch.primary, props.routing.entitySearch.fallback].includes('wiki-mirror') && <div className="notice">使用 wiki镜像需要先登录社区账号。<button className="secondary" onClick={() => { setShareChoice('yes'); setStep(2) }}>返回第二步登录</button></div>}
      {step === 1 && <div className="wizard-step wizard-theme-step"><span className="wizard-step-number">01</span><h2>选择界面主题</h2><p>可以随时在控制模块右上角再次切换。</p><div className="wizard-theme-pointer"><ArrowRight size={22} /><strong>点此切换黑 / 白主题</strong></div><div className="wizard-choice-grid two"><button className={props.theme === 'light' ? 'selected' : ''} onClick={() => props.onThemeChange('light')}><Sun size={22} /><strong>日间主题</strong><span>明亮、清晰的浅色控制台</span></button><button className={props.theme === 'dark' ? 'selected' : ''} onClick={() => props.onThemeChange('dark')}><Moon size={22} /><strong>夜间主题</strong><span>适合暗光环境与游戏画面</span></button></div></div>}
      {step === 3 && <div className="wizard-step"><span className="wizard-step-number">03</span><h2>选择核心翻译方式</h2><p>之后仍可在“翻译与词库”中修改。</p><div className="wizard-choice-grid three">{props.localRuntimeBundled && <button className={translationChoice === 'local' ? 'selected' : ''} onClick={() => chooseTranslation('local')}><strong>本地翻译</strong><span>模型在设备上运行，支持离线使用</span></button>}<button className={translationChoice === 'remote' ? 'selected' : ''} onClick={() => chooseTranslation('remote')}><strong>远程 LLM（千问）</strong><span>使用阿里百炼模型完成翻译</span></button><button className={translationChoice === 'web' ? 'selected' : ''} onClick={() => chooseTranslation('web')}><strong>在线机器翻译</strong><span>无需配置 API Key</span></button></div>
        {translationChoice === 'local' && props.localRuntimeBundled && <div className="wizard-subsection"><label>本地翻译类型</label><div className="segmented"><button className={localChoice === 'machine' ? 'active' : ''} onClick={() => chooseLocal('machine')}>机器翻译 · NLLB-600M</button><button className={localChoice === 'llm' ? 'active' : ''} onClick={() => chooseLocal('llm')}>LLM · TranslateGemma 4B</button></div>{localChoice === 'llm' && props.platform === 'windows' && <><label>Windows 运行方式</label><div className="segmented three"><button className={props.llamaBackend === 'cuda' ? 'active' : ''} onClick={() => props.onBackendChange('cuda')}>CUDA</button><button className={props.llamaBackend === 'vulkan' ? 'active' : ''} onClick={() => props.onBackendChange('vulkan')}>Vulkan</button><button className={props.llamaBackend === 'cpu' ? 'active' : ''} onClick={() => props.onBackendChange('cpu')}>CPU</button></div><small>CUDA 适合 NVIDIA；Vulkan 兼容更多显卡；CPU 兼容性最高。</small></>}<div className={`wizard-download ${localDownloadReady ? 'ready' : ''}`}><div><strong>{localChoice === 'llm' ? 'TranslateGemma 4B' : 'NLLB-200 Distilled 600M'}</strong><span>{localDownloadReady ? '模型已经就绪' : downloadStarted ? '下载已开始，可以继续配置' : '需要下载模型后才能使用'}</span></div>{!localDownloadReady && <button className="scan-button" disabled={props.installingModel || props.nllbPreparing} onClick={startDownload}><Download size={15} />{downloadStarted ? '下载进行中' : '开始下载'}</button>}</div>{localChoice === 'llm' && props.modelProgress && <div className="model-download-progress"><div><span style={{ width: `${props.modelProgress.percent ?? 0}%` }} /></div></div>}<small>{localChoice === 'llm' ? props.modelStatus : props.nllbStatus}</small></div>}
        {translationChoice === 'remote' && <div className="wizard-subsection"><label>阿里百炼（千问）API Key</label><input type="password" value={props.routing.entitySearch.qwenApiKey} onChange={(event) => props.onEntitySearchChange({ qwenApiKey: event.target.value })} placeholder="DashScope API Key" autoComplete="off" /><KeyLink href={qwenKeyUrl}>前往获取 API Key</KeyLink><label>核心翻译模型</label><Select label="核心翻译模型" value={props.routing.entitySearch.coreModelId} onChange={(coreModelId) => props.onEntitySearchChange({ coreModelId })}>{searchModels.map((model) => <option value={model.id} key={model.id}>{model.name}</option>)}</Select></div>}
        {translationChoice === 'web' && <div className="wizard-subsection"><label>在线翻译服务</label><Select label="在线翻译服务" value={props.routing.machineTranslationProvider} onChange={(machineTranslationProvider) => props.onRoutingChange({ coreTranslationEngine: 'machine', machineTranslationProvider: machineTranslationProvider as MachineTranslationProvider })}><option value="youdao-web">网易有道网页机翻</option><option value="bing-web">Bing 网页机翻</option><option value="google-web">Google 网页机翻</option><option value="deepl-web">DeepL 网页机翻</option></Select><small>无需 API Key。客户端会在服务不可用时按既定策略尝试其他在线翻译服务。</small></div>}
      </div>}
      {step === 4 && <div className="wizard-step"><span className="wizard-step-number">04</span><h2>在线学习专有名词</h2><p>为片假名、人名和地名查询可靠译名，并保存到本地词库。</p><div className="toggle-row wizard-master-toggle"><div><strong>在线学习专有名词</strong><small>关闭后跳过全部搜索工具设置</small></div><button className={`toggle ${props.routing.entityLookupEnabled ? 'on' : ''}`} onClick={() => props.onEntityLookupChange(!props.routing.entityLookupEnabled)}><span /></button></div>{props.routing.entityLookupEnabled && <div className="wizard-search-stack"><div className="wizard-subsection"><label>第一搜索工具</label><Select label="第一搜索工具" value={props.routing.entitySearch.primary} onChange={(primary) => props.onEntitySearchChange({ primary: primary as EntitySearchEngineId })}>{Object.entries(entitySearchEngineLabels).map(([id, label]) => <option value={id} key={id}>{label}</option>)}</Select><EngineHelp engine={props.routing.entitySearch.primary} settings={props.routing.entitySearch} onChange={props.onEntitySearchChange} /></div><div className="wizard-subsection"><label>第二搜索工具（可选）</label><Select label="第二搜索工具" value={props.routing.entitySearch.fallback} onChange={(fallback) => props.onEntitySearchChange({ fallback: fallback as EntitySearchEngineId | 'none' })}><option value="none">不开启第二搜索工具</option>{Object.entries(entitySearchEngineLabels).filter(([id]) => id !== props.routing.entitySearch.primary).map(([id, label]) => <option value={id} key={id}>{label}</option>)}</Select>{props.routing.entitySearch.fallback !== 'none' && <EngineHelp engine={props.routing.entitySearch.fallback} settings={props.routing.entitySearch} onChange={props.onEntitySearchChange} />}</div><div className="wizard-subsection"><div className="toggle-row"><div><strong>第三搜索工具 · 远程视觉模型</strong><small>前两项无结果时发送局部截图识别</small></div><button className={`toggle ${props.routing.entitySearch.visionFallbackEnabled ? 'on' : ''}`} onClick={() => props.onEntitySearchChange({ visionFallbackEnabled: !props.routing.entitySearch.visionFallbackEnabled })}><span /></button></div>{props.routing.entitySearch.visionFallbackEnabled && <><label>阿里百炼（千问）API Key</label><input type="password" value={props.routing.entitySearch.qwenApiKey} onChange={(event) => props.onEntitySearchChange({ qwenApiKey: event.target.value })} placeholder="DashScope API Key" autoComplete="off" /><KeyLink href={qwenKeyUrl}>前往获取 API Key</KeyLink><label>多模态模型</label><Select label="远程视觉多模态模型" value={props.routing.entitySearch.visionModelId} onChange={(visionModelId) => props.onEntitySearchChange({ visionModelId })}>{visionModels.map((model) => <option value={model.id} key={model.id}>{model.name}</option>)}</Select></>}</div></div>}</div>}
      {step === 2 && <div className="wizard-step"><span className="wizard-step-number">02</span><h2>社区账号与词库共享</h2><p>登录后可使用 wiki镜像、创建社区游戏，并自愿选择共享词库；也可以跳过登录。</p><div className="notice">不会上传截取画面，也不会上传整段游戏文本。登录成功后设备密钥会自动保存，不需要复制或粘贴。</div><div className="wizard-choice-grid two"><button className={shareChoice === 'yes' ? 'selected' : ''} onClick={() => setShareChoice('yes')}><strong>登录社区账号</strong><span>使用 wiki镜像和社区游戏功能</span></button><button className={shareChoice === 'no' ? 'selected' : ''} onClick={() => setShareChoice('no')}><strong>暂不登录</strong><span>仍可翻译，稍后可在密钥管理中登录</span></button></div>{shareChoice === 'yes' && <CommunityAccountAccess compact origin={communityOrigin} build={props.officialBuild} connected={Boolean(props.communityApiKey.trim())} onApiKey={props.onCommunityKeyChange} onDisconnect={() => props.onCommunityKeyChange('')} />}{shareChoice === 'yes' && Boolean(props.communityApiKey.trim()) && <div className="toggle-row"><div><strong>共享本地词库（可选）</strong><small>wiki镜像不需要开启共享</small></div><button className={`toggle ${props.sharingEnabled ? 'on' : ''}`} aria-label="共享本地词库" onClick={() => props.onSharingChange(!props.sharingEnabled)}><span /></button></div>}</div>}
      {step === 5 && <div className="wizard-step"><span className="wizard-step-number">05</span><h2>选择适配词库</h2><p>游戏名称会作为专有名词搜索和翻译上下文。新建游戏会直接写入社区目录并立即开放。</p><div className="wizard-game-list">{props.games.map((game) => <button key={game.id} className={props.routing.gameId === game.id ? 'selected' : ''} onClick={() => props.onGameChange(game.id)}><span><strong>{game.label}</strong><small>{game.description}</small></span>{props.routing.gameId === game.id && <Check size={18} />}</button>)}</div><button className="secondary wizard-add-game" onClick={() => { setNewGameOpen((value) => !value); setCreateGameError('') }}>{newGameOpen ? '取消新建' : '新建社区游戏配置'}</button>{newGameOpen && <div className="wizard-subsection">{!props.communityApiKey.trim() ? <><div className="notice">新建社区游戏需要先登录社区账号。</div><button className="secondary" onClick={() => { setShareChoice('yes'); setStep(2) }}>返回账号登录步骤</button></> : <><label>游戏中文名（必填）</label><input value={newGameChineseName} onChange={(event) => setNewGameChineseName(event.target.value)} placeholder="例如：最终幻想 VII 重制版" maxLength={120} /><label>游戏日文名（可选）</label><input value={newGameJapaneseName} onChange={(event) => setNewGameJapaneseName(event.target.value)} placeholder="ゲーム日本語名" maxLength={120} /><label>封面 URL（可选）</label><input type="url" value={newGamePosterUrl} onChange={(event) => setNewGamePosterUrl(event.target.value)} placeholder="https://…" maxLength={600} />{createGameError && <div className="notice">{createGameError}</div>}<button className="scan-button" disabled={creatingGame || !newGameChineseName.trim()} onClick={() => void createGame()}>{creatingGame ? '正在创建…' : '创建并选择此社区游戏'}</button><small>创建后立即开放，无需管理员审核；管理员可以在社区控制台编辑或删除游戏。</small></>}</div>}</div>}
      {step === 6 && <div className="wizard-step wizard-finish"><span className="wizard-step-number">06</span><div className="wizard-hero-icon"><Check size={28} /></div><h2>{completed ? '配置已经保存' : '完成配置'}</h2><p>{completed ? '请关闭并重新打开 NSTrans，确保模型运行时、词库同步和搜索服务按新配置初始化。' : '系统将保留以上选择。完成后建议重启应用。'}</p>{!completed ? <button className="primary wizard-complete" onClick={() => { props.onComplete(); setCompleted(true) }}>完成配置</button> : <button className="secondary wizard-complete" onClick={props.onExit}>返回实时结果</button>}</div>}
    </div>
    {!completed && <div className="wizard-navigation"><button className="secondary" disabled={step <= 1} onClick={() => setStep((value) => Math.max(1, value - 1))}><ArrowLeft size={15} />上一步</button>{step < 6 && <button className="primary" disabled={!stepValid} onClick={next}>下一步<ArrowRight size={15} /></button>}</div>}
  </div>
}
