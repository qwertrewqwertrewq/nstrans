import { invoke, isTauri } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'

export type OfficialBuildInfo = {
  available: boolean
  version: string
  platform?: string
  variant?: string
  issuedAt?: string
  expiresAt?: string
  attestation?: string
}

type NativeAttestation = { available: boolean; version: string; attestation?: string }
export type CommunityAuthMode = 'login' | 'register'
export type CommunityAuthInput = { username: string; password: string }

function decodeBase64Url(value: string) {
  const base64 = value.replace(/-/gu, '+').replace(/_/gu, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  return decodeURIComponent([...atob(base64)].map((character) => `%${character.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''))
}

export async function officialBuildInfo(): Promise<OfficialBuildInfo> {
  if (!isTauri()) return { available: false, version: 'web' }
  const native = await invoke<NativeAttestation>('client_build_attestation')
  if (!native.available || !native.attestation) return native
  try {
    const envelope = JSON.parse(decodeBase64Url(native.attestation)) as { payload: string }
    const payload = JSON.parse(decodeBase64Url(envelope.payload)) as Omit<OfficialBuildInfo, 'available' | 'attestation'>
    return { available: true, attestation: native.attestation, ...payload }
  } catch { return { ...native, available: false } }
}

function clientDevice() {
  const storageKey = 'nstrans.community-device-id.v1'
  let deviceId = localStorage.getItem(storageKey) ?? ''
  if (!deviceId) { deviceId = crypto.randomUUID(); localStorage.setItem(storageKey, deviceId) }
  const deviceName = `${buildPlatformLabel()} · NSTrans`
  return { deviceId, deviceName }
}

function buildPlatformLabel() {
  const platform = navigator.platform || '设备'
  return platform.slice(0, 80)
}

async function clientAuthRequest(origin: string, path: string, body: object) {
  const response = await fetch(`${origin.replace(/\/$/u, '')}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const result = await response.json().catch(() => ({})) as { apiKey?: string; error?: string; [key: string]: unknown }
  if (!response.ok) throw new Error(result.error || `社区账号请求失败 (${response.status})`)
  return result
}

export async function authenticateCommunityAccount(origin: string, build: OfficialBuildInfo, mode: CommunityAuthMode, input: CommunityAuthInput) {
  if (!build.available || !build.attestation) throw new Error('当前安装包不含官方构建签名')
  const result = await clientAuthRequest(origin, `/api/v1/auth/client/${mode}`, { attestation: build.attestation, ...clientDevice(), ...input })
  if (!result.apiKey) throw new Error('服务端没有返回客户端凭证')
  return result.apiKey
}

export async function authenticateCommunityWithGithub(origin: string, build: OfficialBuildInfo, onStatus?: (message: string) => void) {
  if (!build.available || !build.attestation) throw new Error('当前安装包不含官方构建签名')
  const start = await clientAuthRequest(origin, '/api/v1/auth/client/start', { attestation: build.attestation, ...clientDevice() }) as { browserUrl?: string; pollToken?: string; expiresIn?: number }
  if (!start.browserUrl || !start.pollToken) throw new Error('无法创建 GitHub 授权会话')
  await openUrl(start.browserUrl)
  onStatus?.('请在浏览器完成 GitHub 授权，完成后会自动返回应用')
  const deadline = Date.now() + Math.min(Number(start.expiresIn || 600), 600) * 1000
  while (Date.now() < deadline) {
    await new Promise((resolve) => window.setTimeout(resolve, 1800))
    const response = await fetch(`${origin.replace(/\/$/u, '')}/api/v1/auth/client/poll`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pollToken: start.pollToken }) })
    const result = await response.json().catch(() => ({})) as { status?: string; apiKey?: string; error?: string }
    if (response.status === 202 || result.status === 'pending') continue
    if (!response.ok) throw new Error(result.error || 'GitHub 授权失败')
    if (result.status === 'complete' && result.apiKey) return result.apiKey
  }
  throw new Error('GitHub 授权已超时，请重试')
}
