import { describe, expect, it } from 'vitest'
import { detectClientPlatform } from './clientPlatform'

describe('client platform', () => {
  it('detects an Android WebView before applying desktop layout rules', () => {
    expect(detectClientPlatform('Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36')).toBe('android')
    expect(detectClientPlatform('Mozilla/5.0 (iPad; CPU OS 18_2 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148')).toBe('ios')
    expect(detectClientPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Mobile/15E148')).toBe('ios')
    expect(detectClientPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 5)).toBe('ios')
    expect(detectClientPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('macos')
  })
})
