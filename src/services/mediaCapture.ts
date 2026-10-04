type VideoMediaDevices = Pick<MediaDevices, 'getUserMedia'>

export type CaptureDeviceDescriptor = {
  deviceId: string
  groupId?: string
  label: string
}

const genericCaptureWords = new Set(['audio', 'video', 'camera', 'capture', 'card', 'device', 'digital', 'interface', 'input', 'microphone', 'usb', 'hdmi', 'uvc'])
const captureTokens = (label: string) => label
  .normalize('NFKC')
  .toLocaleLowerCase()
  .replace(/[\u0028\u0029\u005b\u005d_-]+/gu, ' ')
  .split(/[^\p{L}\p{N}.]+/u)
  .filter((token) => token && !genericCaptureWords.has(token) && !/^\d+(?:\.\d+)?$/u.test(token))

/**
 * Select only an audio endpoint that looks like the chosen capture card. This
 * deliberately refuses to fall back to the built-in/default microphone.
 */
export function findCaptureAudioDevice(video: CaptureDeviceDescriptor, audioDevices: readonly CaptureDeviceDescriptor[]) {
  if (video.groupId) {
    const grouped = audioDevices.find((device) => device.groupId && device.groupId === video.groupId)
    if (grouped) return grouped
  }
  const videoTokens = new Set(captureTokens(video.label))
  const tokenMatch = audioDevices
    .map((device) => ({ device, score: captureTokens(device.label).filter((token) => videoTokens.has(token)).length }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score)[0]?.device
  if (tokenMatch) return tokenMatch
  const external = audioDevices.filter((device) => /(?:usb|hdmi|capture|采集卡|数字音频|digital audio)/iu.test(device.label))
  return external.length === 1 ? external[0] : undefined
}

const deviceConstraint = (deviceId: string) => (deviceId ? { deviceId: { exact: deviceId } } : {})

/**
 * Capture cards often expose 640x480 as their first UVC mode. WebKit is free to
 * satisfy `ideal: 1920x1080` with that mode, so first request Full HD exactly,
 * then progressively relax the constraints for cameras that cannot provide it.
 */
export async function openPreferredVideoStream(mediaDevices: VideoMediaDevices, deviceId = '', preferredFrameRate: 30 | 60 = 30) {
  const device = deviceConstraint(deviceId)
  const profiles: MediaTrackConstraints[] = [
    { ...device, width: { exact: 1920 }, height: { exact: 1080 }, frameRate: { ideal: preferredFrameRate, max: 60 } },
    { ...device, width: { min: 1280, ideal: 1920 }, height: { min: 720, ideal: 1080 }, aspectRatio: { ideal: 16 / 9 }, frameRate: { ideal: preferredFrameRate, max: 60 } },
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
