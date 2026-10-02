import { useEffect, useRef, useState } from 'react'
import { ExternalLink, RefreshCw, X } from 'lucide-react'
import { isTauri } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'
import type { ClientUpdatePolicy } from '../services/clientUpdate'

export function ClientUpdatePrompt({ policy, onClose }: { policy: ClientUpdatePolicy; onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (element.showModal) element.showModal()
    else element.setAttribute('open', '')
    return () => element.close?.()
  }, [])
  const openDownload = async () => {
    setError('')
    try {
      if (isTauri()) await openUrl(policy.downloadUrl)
      else window.open(policy.downloadUrl, '_blank', 'noopener,noreferrer')
    } catch { setError('无法打开下载页面，请重试。') }
  }
  return <dialog ref={dialog} className="client-update-backdrop" aria-labelledby="client-update-title" onCancel={(event) => { event.preventDefault(); if (!policy.forceUpdate) onClose() }}>
    <section className="client-update-dialog">
      {!policy.forceUpdate && <button className="client-update-close" aria-label="关闭更新提示" onClick={onClose}><X size={17} /></button>}
      <div className="client-update-icon"><RefreshCw size={24} /></div>
      <span className="client-update-kicker">NSTrans UPDATE</span>
      <h2 id="client-update-title">发现新版本 {policy.targetVersion}</h2>
      <p className="client-update-content">{policy.content}</p>
      {policy.forceUpdate && <div className="client-update-required">此版本为强制更新。完成更新后才能继续使用 NSTrans。</div>}
      <button className="primary client-update-action" onClick={() => void openDownload()}>前往下载<ExternalLink size={15} /></button>
      {error && <p role="alert">{error}</p>}
      {!policy.forceUpdate && <button className="text-button" onClick={onClose}>稍后提醒</button>}
    </section>
  </dialog>
}
