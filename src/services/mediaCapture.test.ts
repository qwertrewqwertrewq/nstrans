import { describe, expect, it, vi } from 'vitest'
import { findCaptureAudioDevice, openPreferredVideoStream } from './mediaCapture'

describe('media capture constraints', () => {
  it('requests the selected capture card at exact 1080p first', async () => {
    const stream = {} as MediaStream
    const getUserMedia = vi.fn(async () => stream)
    await expect(openPreferredVideoStream({ getUserMedia }, 'capture-card')).resolves.toBe(stream)
    expect(getUserMedia).toHaveBeenCalledWith({
      video: expect.objectContaining({
        deviceId: { exact: 'capture-card' },
        width: { exact: 1920 },
        height: { exact: 1080 },
      }),
      audio: false,
    })
  })

  it('relaxes resolution constraints when a camera has no exact 1080p mode', async () => {
    const stream = {} as MediaStream
    const getUserMedia = vi.fn()
      .mockRejectedValueOnce(new DOMException('unsupported', 'OverconstrainedError'))
      .mockResolvedValueOnce(stream)
    await expect(openPreferredVideoStream({ getUserMedia }, 'camera')).resolves.toBe(stream)
    expect(getUserMedia).toHaveBeenCalledTimes(2)
    expect(getUserMedia.mock.calls[1]?.[0].video).toEqual(expect.objectContaining({ width: { min: 1280, ideal: 1920 }, height: { min: 720, ideal: 1080 } }))
  })
})

describe('capture-card audio pairing', () => {
  it('prefers an audio endpoint in the same media-device group', () => {
    const audio = [
      { deviceId: 'mic', groupId: 'builtin', label: 'MacBook Microphone' },
      { deviceId: 'capture-audio', groupId: 'usb-card', label: 'Digital Audio Interface' },
    ]
    expect(findCaptureAudioDevice({ deviceId: 'capture-video', groupId: 'usb-card', label: 'USB2 Video' }, audio)?.deviceId).toBe('capture-audio')
  })

  it('matches the only external USB audio source but never falls back to a built-in mic', () => {
    const video = { deviceId: 'capture-video', label: 'USB Video' }
    expect(findCaptureAudioDevice(video, [
      { deviceId: 'mic', label: 'MacBook Microphone' },
      { deviceId: 'usb-audio', label: 'USB Digital Audio' },
    ])?.deviceId).toBe('usb-audio')
    expect(findCaptureAudioDevice(video, [{ deviceId: 'mic', label: 'MacBook Microphone' }])).toBeUndefined()
  })
})
