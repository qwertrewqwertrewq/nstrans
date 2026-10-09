import { describe, expect, it, vi } from 'vitest'
import { findCaptureAudioDevice, openPreferredVideoStream } from './mediaCapture'

describe('media capture constraints', () => {
  it('prefers 60 fps on desktop without requiring unsupported frame rates', async () => {
    const stream = { getVideoTracks: () => [{ getSettings: () => ({ frameRate: 30 }) }] } as unknown as MediaStream
    const getUserMedia = vi.fn(async (_constraints: MediaStreamConstraints) => stream)
    await expect(openPreferredVideoStream({ getUserMedia }, 'card', 60)).resolves.toBe(stream)
    expect(getUserMedia.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ video: expect.objectContaining({ frameRate: { ideal: 60, max: 60 } }) }))
  })

  it('keeps mobile and unspecified callers at the existing 30 fps preference', async () => {
    const getUserMedia = vi.fn(async (_constraints: MediaStreamConstraints) => ({} as MediaStream))
    await openPreferredVideoStream({ getUserMedia }, 'camera')
    expect(getUserMedia.mock.calls[0]?.[0].video).toEqual(expect.objectContaining({ frameRate: { ideal: 30, max: 60 } }))
  })
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
  it('ignores default and communications aliases when matching a media-device group', () => {
    const video = { deviceId: 'capture-video', groupId: 'usb-card', label: 'Hagibis' }
    const audio = [
      { deviceId: 'default', groupId: 'usb-card', label: 'Default - Hagibis' },
      { deviceId: 'communications', groupId: 'usb-card', label: 'Communications - Hagibis' },
      { deviceId: 'capture-audio', groupId: 'usb-card', label: 'Hagibis' },
    ]
    expect(findCaptureAudioDevice(video, audio)?.deviceId).toBe('capture-audio')
  })

  it('ignores system aliases when matching device labels', () => {
    expect(findCaptureAudioDevice({ deviceId: 'capture-video', label: 'Hagibis' }, [
      { deviceId: 'default', label: 'Default - Hagibis' },
      { deviceId: 'capture-audio', label: 'Hagibis' },
    ])?.deviceId).toBe('capture-audio')
  })

  it('does not use a system alias as the only external audio source', () => {
    expect(findCaptureAudioDevice({ deviceId: 'capture-video', label: 'USB Video' }, [
      { deviceId: 'default', label: 'Default - USB Audio' },
    ])).toBeUndefined()
  })

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
