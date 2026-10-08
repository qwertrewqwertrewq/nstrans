export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
  }
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers)
  if (options.body) headers.set('content-type', 'application/json')
  const response = await fetch(path, { ...options, headers, credentials: 'same-origin' })
  const body = await response.json().catch(() => null)
  if (response.status === 401 && path !== '/api/me' && typeof window !== 'undefined')
    window.dispatchEvent(new Event('community-session-expired'))
  if (!response.ok)
    throw new ApiError(body?.error || `请求失败（${response.status}）`, response.status)
  if (body === null) throw new ApiError('服务返回格式异常，请稍后重试', response.status)
  return body as T
}
export function write<T>(path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown) {
  return api<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) })
}
export function errorText(error: unknown) {
  return error instanceof Error ? error.message : '操作失败，请重试'
}
export function formatDate(value?: string | null) {
  if (!value) return '尚未使用'
  const date = new Date(/[zZ]|[+-]\d\d:\d\d$/u.test(value) ? value : `${value.replace(' ', 'T')}Z`)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}
export async function copyText(text: string) {
  await navigator.clipboard.writeText(text)
}
