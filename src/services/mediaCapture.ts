type VideoMediaDevices = Pick<MediaDevices, 'getUserMedia'>

const deviceConstraint = (deviceId: string) => (deviceId ? { deviceId: { exact: deviceId } } : {})

/**
 * Capture cards often expose 640x480 as their first UVC mode. WebKit is free to
 * satisfy `ideal: 1920x1080` with that mode, so first request Full HD exactly,
 * then progressively relax the constraints for cameras that cannot provide it.
 */
export async function openPreferredVideoStream(mediaDevices: VideoMediaDevices, deviceId = '') {
  const device = deviceConstraint(deviceId)
  const profiles: MediaTrackConstraints[] = [
    { ...device, width: { exact: 1920 }, height: { exact: 1080 }, frameRate: { ideal: 30, max: 60 } },
    { ...device, width: { min: 1280, ideal: 1920 }, height: { min: 720, ideal: 1080 }, aspectRatio: { ideal: 16 / 9 }, frameRate: { ideal: 30, max: 60 } },
    { ...device, width: { ideal: 1920 }, height: { ideal: 1080 }, aspectRatio: { ideal: 16 / 9 } },
  ]
  let lastError: unknown
  for (const video of profiles) {
    try {
      return await mediaDevices.getUserMedia({ video, audio: false })
    } catch (error) {
      lastError = error
      if (error instanceof DOMException && error.name === 'NotAllowedError') throw error
    }
  }
  throw lastError ?? new Error('无法打开视频输入源')
}

export async function waitForVideoDimensions(video: HTMLVideoElement, timeoutMs = 2500) {
  if (video.videoWidth > 1 && video.videoHeight > 1) return { width: video.videoWidth, height: video.videoHeight }
  await new Promise<void>((resolve) => {
    const done = () => {
      window.clearTimeout(timer)
      video.removeEventListener('loadedmetadata', done)
      video.removeEventListener('resize', done)
      resolve()
    }
    const timer = window.setTimeout(done, timeoutMs)
    video.addEventListener('loadedmetadata', done, { once: true })
    video.addEventListener('resize', done, { once: true })
  })
  return { width: video.videoWidth, height: video.videoHeight }
}
