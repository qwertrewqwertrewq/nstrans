import { useEffect } from 'react'

/** Each stream owns its cleanup; changing audio must not stop video. */
export function useMediaStreamCleanup(stream: MediaStream | null) {
  useEffect(() => () => { stream?.getTracks().forEach((track) => track.stop()) }, [stream])
}
