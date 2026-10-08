// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CommunityModelAccess } from './CommunityModelAccess'
import { defaultEntitySearchSettings, type EntitySearchSettings } from '../services/entitySearchSettings'
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
function Harness({ apiKey = 'fixture-key' }: { apiKey?: string }) {
  const [settings,setSettings] = useState<EntitySearchSettings>(defaultEntitySearchSettings)
  return <><CommunityModelAccess settings={settings} apiKey={apiKey} onChange={patch=>setSettings(current=>({...current,...patch}))} /><output data-testid="models">{JSON.stringify({provider:settings.remoteProvider,profiles:settings.remoteModels.filter(model=>model.provider==='community')})}</output></>
}
describe('Community provider settings UI', () => {
  it('requests only authorized models after opting in and never saves credentials into profiles', async () => {
    const fetcher = vi.fn(async()=>Response.json({enabled:true,quota:{balance:25,spent:3},costs:{translation:1,search:2,vision:2}}))
    vi.stubGlobal('fetch',fetcher)
    render(<Harness />)
    expect(fetcher).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('远程模型服务'),{target:{value:'community'}})
    await screen.findByText('剩余 25 点 · 已用 3 点')
    const profiles = JSON.parse(screen.getByTestId('models').textContent || '{}')
    expect(profiles.provider).toBe('community')
    expect(profiles.profiles).toHaveLength(0)
    expect(JSON.stringify(profiles)).not.toContain('fixture-key')
    expect(screen.queryByText(/gemini-/)).toBeNull()
    fireEvent.change(screen.getByLabelText('远程模型服务'),{target:{value:'direct'}})
    await waitFor(()=>expect(screen.getByTestId('models').textContent).toContain('direct'))
  })
  it('does not access the network when logged out', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch',fetcher)
    render(<Harness apiKey="" />)
    fireEvent.change(screen.getByLabelText('远程模型服务'),{target:{value:'community'}})
    await screen.findByText('请先登录社区账号')
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('shows a disabled service clearly and removes stale community choices', async () => {
    vi.stubGlobal('fetch',vi.fn(async()=>Response.json({enabled:false,models:[],quota:{balance:0,spent:0}})))
    render(<Harness />)
    fireEvent.change(screen.getByLabelText('远程模型服务'),{target:{value:'community'}})
    await screen.findByText('社区中转模型尚未启用')
    expect(JSON.parse(screen.getByTestId('models').textContent || '{}').profiles).toHaveLength(0)
  })
})
