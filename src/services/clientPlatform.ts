export type ClientPlatform = 'android' | 'ios' | 'macos' | 'windows' | 'other'

export function detectClientPlatform(
  userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent,
  platform = typeof navigator === 'undefined' ? '' : navigator.platform,
  maxTouchPoints = typeof navigator === 'undefined' ? 0 : navigator.maxTouchPoints,
): ClientPlatform {
  if (/android/i.test(userAgent)) return 'android'
  if (/(?:iphone|ipad|ipod)/i.test(userAgent) || /macintosh/i.test(userAgent) && (/mobile/i.test(userAgent) || platform === 'MacIntel' && maxTouchPoints > 1)) return 'ios'
  if (/windows/i.test(userAgent)) return 'windows'
  if (/(?:macintosh|mac os x)/i.test(userAgent)) return 'macos'
  return 'other'
}
