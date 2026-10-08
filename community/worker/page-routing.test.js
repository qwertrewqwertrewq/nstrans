import { describe, expect, it, vi } from 'vitest'
import worker, { isCommunityPage } from './index.js'

describe('Vue community page routing', () => {
  it('recognizes public pages and every dashboard deep link, without swallowing APIs or downloads', () => {
    for (const path of ['/', '/login', '/download', '/donate', '/client', '/how-it-works', '/client-auth-complete', '/dashboard', ...['keys', 'games', 'dictionary', 'account', 'updates'].map(name => `/dashboard/${name}`)]) expect(isCommunityPage(path)).toBe(true)
    for (const path of ['/api/me', '/download/file/tv', '/download/model/nllb', '/assets/index.js', '/dashboard/unknown', '/client-login']) expect(isCommunityPage(path)).toBe(false)
  })
  it('serves the same fresh entry HTML for deep links and permits Element Plus style attributes without weakening scripts', async () => {
    const assets = vi.fn(async () => new Response('<div id="app"></div>', { headers: { 'content-type': 'text/html' } }))
    const response = await worker.fetch(new Request('https://nstrans.221129.xyz/dashboard/dictionary?game=general'), { ASSETS: { fetch: assets } })
    expect(response.status).toBe(200)
    expect(new URL(assets.mock.calls[0][0].url).pathname).toBe('/index.html')
    expect(new URL(assets.mock.calls[0][0].url).search).toBe('')
    expect(response.headers.get('cache-control')).toBe('no-cache')
    const policy = response.headers.get('content-security-policy')
    expect(policy).toContain("style-src 'self' 'unsafe-inline'")
    expect(policy).not.toMatch(/script-src[^;]*unsafe/u)
    expect(policy).toContain("frame-ancestors 'none'")
  })
  it('keeps missing APIs JSON 404 and rejects writes to frontend pages', async () => {
    const response = await worker.fetch(new Request('https://nstrans.221129.xyz/api/not-found'), {})
    expect(response.status).toBe(404)
    expect((await response.json()).error).toBe('接口不存在')
    const write = await worker.fetch(new Request('https://nstrans.221129.xyz/dashboard/keys', { method: 'POST' }), {})
    expect(write.status).toBe(405)
  })
  it('shows the Vue not-found page with HTTP 404 without replacing missing scripts with HTML', async () => {
    const assets = { fetch: async request => new URL(request.url).pathname === '/index.html' ? new Response('<div id="app"></div>') : new Response('Not Found', { status: 404 }) }
    const page = await worker.fetch(new Request('https://nstrans.221129.xyz/missing-page', { headers: { accept: 'text/html' } }), { ASSETS: assets })
    expect(page.status).toBe(404)
    expect(await page.text()).toContain('id="app"')
    const script = await worker.fetch(new Request('https://nstrans.221129.xyz/assets/missing.js', { headers: { accept: 'text/html' } }), { ASSETS: assets })
    expect(script.status).toBe(404)
    expect(await script.text()).toBe('Not Found')
  })
})
