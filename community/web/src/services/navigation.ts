// Only same-site known dashboard routes may be restored after OAuth. This value
// contains navigation state only, never an account token or client key.
const returnKey = 'nstrans.community.return-route'
export function dashboardReturn(value: unknown): string | null {
  if (
    typeof value !== 'string' ||
    !/^\/dashboard(?:\/(?:keys|games|dictionary|account|updates|relay))?\/?(?:\?|$)/u.test(value)
  )
    return null
  return value
}
export function rememberReturn(value: unknown) {
  const path = dashboardReturn(value)
  try {
    if (path) sessionStorage.setItem(returnKey, path)
  } catch {
    /* Storage may be disabled. */
  }
}
export function consumeReturn() {
  try {
    const path = dashboardReturn(sessionStorage.getItem(returnKey))
    sessionStorage.removeItem(returnKey)
    return path
  } catch {
    return null
  }
}
