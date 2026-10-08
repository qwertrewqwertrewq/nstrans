import { afterEach, describe, expect, it, vi } from 'vitest'
import { availableRemoteModels, defaultEntitySearchSettings, loadEntitySearchSettings, remoteModelCredentials, type EntitySearchSettings } from './entitySearchSettings'
import { qwenTranslateMany, qwenSearchTerm, qwenVisionFallback } from './qwenFlash'
vi.mock('./knowledgeSharing', () => ({ loadCommunityApiKey: vi.fn(() => 'fixture-community-key') }))
import { loadCommunityApiKey } from './knowledgeSharing'
afterEach(() => vi.unstubAllGlobals())
const settings: EntitySearchSettings = { ...defaultEntitySearchSettings, remoteProvider:'community',coreModelId:'community:qwen3.8-flash', searchModelId:'community:qwen3.7-max',remoteModels:[...defaultEntitySearchSettings.remoteModels,
  { id:'community:qwen3.8-flash',name:'flash',model:'qwen3.8-flash',provider:'community',capability:'multimodal-search' },
  { id:'community:qwen3.7-max',name:'max',model:'qwen3.7-max',provider:'community',capability:'search-only' },
  { id:'community:translation',name:'translation',model:'qwen3.6-flash',provider:'community',capability:'translation-only' },
] }
describe('Community model routing', () => {
  it('migrates old community profiles without retaining concrete relay models', () => {
    vi.stubGlobal('window',{localStorage:{getItem:()=>JSON.stringify({...settings,qwenProvider:'community',remoteProvider:undefined})}})
    const migrated=loadEntitySearchSettings()
    expect(migrated.remoteProvider).toBe('community')
    expect(migrated.remoteModels.some(model=>model.provider==='community')).toBe(false)
    expect(remoteModelCredentials(migrated,'vision')?.name).toBe('社区中转模型')
  })
  it('isolates provider lists and respects translation-only capabilities', () => {
    expect(availableRemoteModels(settings,'core')).toHaveLength(1)
    expect(availableRemoteModels(settings,'search')).toHaveLength(1)
    expect(availableRemoteModels(settings,'vision')).toHaveLength(1)
    expect(availableRemoteModels({...settings,remoteProvider:'direct'},'core').every(model=>model.provider!=='community')).toBe(true)
    expect(remoteModelCredentials({...settings,coreModelId:'preset:qwen3.8-flash'},'core')?.model).toBe('community-relay')
  })
  it('reads the current login credential without copying upstream or community keys into profiles', () => {
    vi.mocked(loadCommunityApiKey).mockReturnValueOnce('first').mockReturnValueOnce('second')
    expect(remoteModelCredentials(settings,'core')?.apiKey).toBe('first')
    expect(remoteModelCredentials(settings,'core')?.apiKey).toBe('second')
    expect(settings.remoteModels.some(model=>model.apiKey)).toBe(false)
  })
  it('sends translation directly to the community Worker on every platform', async () => {
    vi.stubGlobal('window',new EventTarget())
    const fetcher = vi.fn(async()=>Response.json({content:'{"translations":["你好"]}',cost:1,quota:{balance:9,spent:1}}))
    vi.stubGlobal('fetch',fetcher)
    const profile = remoteModelCredentials(settings,'core')!
    expect(await qwenTranslateMany({texts:['こんにちは'],...profile})).toEqual(['你好'])
    const [url,options] = fetcher.mock.calls[0] as unknown as [string,RequestInit]
    expect(url).toBe('https://nstrans.221129.xyz/api/v1/relay')
    const body = JSON.parse(String(options.body))
    expect(body).toMatchObject({purpose:'translation'})
    expect(body).not.toHaveProperty('model')
    expect(body).not.toHaveProperty('enableSearch')
    expect(body).not.toHaveProperty('apiKey')
    expect(new Headers(options.headers).get('authorization')).toBe('Bearer fixture-community-key')
  })
  it('surfaces depleted quota and prevents search on a translation-only model', async () => {
    vi.stubGlobal('fetch',vi.fn(async()=>Response.json({error:'社区额度不足'},{status:402})))
    await expect(qwenTranslateMany({texts:['日文'],...remoteModelCredentials(settings,'core')!})).rejects.toThrow('社区额度不足')
    await expect(qwenSearchTerm('ゼルダ',[],{...remoteModelCredentials(settings,'core')!,capability:'translation-only'})).rejects.toThrow('仅支持翻译')
  })
  it('sends search purpose without a model and preserves visual-independent requests', async () => {
    vi.stubGlobal('window',new EventTarget())
    const fetcher=vi.fn(async()=>Response.json({content:'{"canonicalSource":"ゼルダ","target":"塞尔达","confidence":0.99,"evidence":["来源"]}',quota:{balance:9,spent:1}}))
    vi.stubGlobal('fetch',fetcher)
    expect((await qwenSearchTerm('ゼルダ',['游戏'],remoteModelCredentials(settings,'search')!))?.target).toBe('塞尔达')
    const body=JSON.parse(String((fetcher.mock.calls[0] as unknown as [string,RequestInit])[1].body))
    expect(body.purpose).toBe('search');expect(body).not.toHaveProperty('model');expect(body).not.toHaveProperty('enableSearch')
  })
  it('routes a visual request with the cropped image and no client model override', async () => {
    vi.stubGlobal('window',new EventTarget())
    const fetcher=vi.fn(async()=>Response.json({content:'{"translation":"塞尔达","correctedText":"ゼルダ","entries":[]}',quota:{balance:9,spent:1}}))
    vi.stubGlobal('fetch',fetcher)
    expect((await qwenVisionFallback({observedText:'ゼルダ',candidates:['ゼルダ'],imageDataUrl:'data:image/png;base64,AAAA',gameId:'zelda-totk',gameNames:['游戏'],...remoteModelCredentials(settings,'vision')!}))?.translation).toBe('塞尔达')
    const body=JSON.parse(String((fetcher.mock.calls[0] as unknown as [string,RequestInit])[1].body))
    expect(body).toMatchObject({purpose:'vision',imageDataUrl:'data:image/png;base64,AAAA'});expect(body).not.toHaveProperty('model')
  })
})
