import { describe, expect, it, vi } from 'vitest'
import { openPreferredVideoStream } from './mediaCapture'

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
