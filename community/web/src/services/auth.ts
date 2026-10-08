import { reactive } from 'vue'
import { api, ApiError, errorText } from './api'
import type { User } from './types'

export const auth = reactive({
  user: null as User | null,
  loaded: false,
  error: '',
  loading: false,
})
let request: Promise<void> | null = null
window.addEventListener('community-session-expired', () => {
  auth.user = null
  auth.loaded = true
  auth.error = ''
})
export function loadAuth(force = false): Promise<void> {
  if (request) return request
  if (auth.loaded && !force) return Promise.resolve()
  auth.loading = true
  request = api<{ user: User }>('/api/me')
    .then(({ user }) => {
      auth.user = user
      auth.loaded = true
      auth.error = ''
    })
    .catch((error) => {
      if (error instanceof ApiError && error.status === 401) {
        auth.user = null
        auth.loaded = true
        auth.error = ''
      } else {
        auth.error = errorText(error)
        auth.loaded = false
      }
    })
    .finally(() => {
      auth.loading = false
      request = null
    })
  return request
}
