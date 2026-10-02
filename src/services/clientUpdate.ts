export type ClientUpdatePolicy = {
  targetVersion: string
  popupEnabled: boolean
  forceUpdate: boolean
  content: string
  downloadUrl: string
  updatedAt?: string
  shouldShow: boolean
}

export async function fetchClientUpdatePolicy(origin: string, version: string, platform = ''): Promise<ClientUpdatePolicy | null> {
  if (!/^\d+\.\d+\.\d+(?:[-+].*)?$/u.test(version)) return null
  const query = new URLSearchParams({ version, platform })
  const response = await fetch(`${origin.replace(/\/$/u, '')}/api/v1/client-update?${query}`)
  if (!response.ok) return null
  return response.json() as Promise<ClientUpdatePolicy>
}
