import { invoke, isTauri } from '@tauri-apps/api/core'
import { detectClientPlatform } from './clientPlatform'

export type UsbVideoDevice = {
  id: string
  label: string
  vendorId: number
  productId: number
  connected: boolean
}

export type UsbVideoFrame = {
  imageBase64: string
  width: number
  height: number
  timestamp: number
}

const supported = () => isTauri() && ['android', 'ios'].includes(detectClientPlatform())

export async function listUsbVideoDevices(): Promise<UsbVideoDevice[]> {
  if (!supported()) return []
  return invoke<{ devices: UsbVideoDevice[] }>('usb_video_devices').then((result) => result.devices)
}

export async function openUsbVideoDevice(deviceId: string) {
  if (!supported()) throw new Error('原生 USB UVC 仅支持 Android 与 iPad 客户端')
  return invoke<{ available: boolean; width: number; height: number; label: string; error?: string }>('usb_video_open', { deviceId })
}

export async function closeUsbVideoDevice() {
  if (supported()) await invoke('usb_video_close')
}

export async function readUsbVideoFrame(): Promise<UsbVideoFrame> {
  if (!supported()) throw new Error('原生 USB UVC 仅支持 Android 与 iPad 客户端')
  return invoke<UsbVideoFrame>('usb_video_frame')
}
