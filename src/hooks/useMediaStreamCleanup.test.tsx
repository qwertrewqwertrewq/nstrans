// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMediaStreamCleanup } from './useMediaStreamCleanup'

afterEach(cleanup)
const makeStream = () => {
  const stop = vi.fn()
  return { stream: { getTracks: () => [{ stop }] } as unknown as MediaStream, stop }
}

describe('independent capture stream lifetimes', () => {
  it('keeps video alive through enabling, replacing and disabling audio', () => {
    const video = makeStream(), first = makeStream(), second = makeStream()
    const hook = renderHook(({ audio }: { audio: MediaStream | null }) => {
      useMediaStreamCleanup(video.stream)
      useMediaStreamCleanup(audio)
    }, { initialProps: { audio: null } as { audio: MediaStream | null } })
    hook.rerender({ audio: first.stream })
    expect(video.stop).not.toHaveBeenCalled()
    hook.rerender({ audio: second.stream })
    expect(first.stop).toHaveBeenCalledOnce()
    expect(video.stop).not.toHaveBeenCalled()
    hook.rerender({ audio: null })
    expect(second.stop).toHaveBeenCalledOnce()
    expect(video.stop).not.toHaveBeenCalled()
    hook.unmount()
    expect(video.stop).toHaveBeenCalledOnce()
  })
})
