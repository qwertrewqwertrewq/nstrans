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

export async function openOfficialClientLogin(origin: string, build: OfficialBuildInfo) {
  if (!build.available || !build.attestation) throw new Error('当前安装包不含官方构建签名')
  const response = await fetch(`${origin.replace(/\/$/u, '')}/api/v1/auth/client/ticket`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ attestation: build.attestation }) })
  const result = await response.json().catch(() => ({})) as { loginUrl?: string; error?: string }
  if (!response.ok || !result.loginUrl) throw new Error(result.error || `官方构建验证失败 (${response.status})`)
  await openUrl(result.loginUrl)
}
