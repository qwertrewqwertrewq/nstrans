import { useState } from 'react'
import { Check, ExternalLink, LogIn, UserPlus } from 'lucide-react'
import { authenticateCommunityAccount, authenticateCommunityWithGithub, type CommunityAuthMode, type OfficialBuildInfo } from '../services/communityAccount'

type Props = {
  origin: string
  build: OfficialBuildInfo
  connected: boolean
  onApiKey(apiKey: string): void
  onDisconnect?(): void
  compact?: boolean
}

export function CommunityAccountAccess({ origin, build, connected, onApiKey, onDisconnect, compact = false }: Props) {
  const [mode, setMode] = useState<CommunityAuthMode>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const complete = (apiKey: string, success: string) => {
    onApiKey(apiKey)
    setPassword('')
    setMessage(success)
  }
  const submitPassword = async () => {
    setBusy(true); setMessage(mode === 'login' ? '正在登录…' : '正在创建账号…')
    try { complete(await authenticateCommunityAccount(origin, build, mode, { username, password }), mode === 'login' ? '登录成功，客户端密钥已自动保存' : '注册成功，客户端密钥已自动保存') }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : '社区账号操作失败') }
    finally { setBusy(false) }
  }
  const submitGithub = async () => {
    setBusy(true); setMessage('正在打开 GitHub 授权…')
    try { complete(await authenticateCommunityWithGithub(origin, build, setMessage), 'GitHub 授权成功，客户端密钥已自动保存') }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : 'GitHub 授权失败') }
    finally { setBusy(false) }
  }

  return <div className={`community-account-access ${compact ? 'compact' : ''}`}>
    <div className="community-account-state">
      <span className={connected ? 'connected' : ''}>{connected ? <Check size={14} /> : <LogIn size={14} />}</span>
      <div><strong>{connected ? '此设备已登录社区' : '登录 NSTrans 社区'}</strong><small>{connected ? '社区客户端密钥已安全保存在本机，不会在界面中显示。' : '登录后自动配置词库上传和游戏创建权限。'}</small></div>
      {connected && onDisconnect && <button className="text-button" onClick={onDisconnect}>退出此设备</button>}
    </div>
    {!build.available ? <div className="notice">当前安装包没有官方构建签名，无法使用客户端账号登录。请安装 GitHub Actions 发布的正式客户端。</div> : <>
      <div className="segmented community-auth-tabs"><button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}><LogIn size={14} />登录</button><button className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}><UserPlus size={14} />注册</button></div>
      <div className="community-password-auth"><input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="用户名" maxLength={32} autoComplete="username" /><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === 'register' ? '密码（至少 10 位）' : '密码'} minLength={mode === 'register' ? 10 : undefined} maxLength={128} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} /><button className="primary" disabled={busy || username.trim().length < 3 || password.length < (mode === 'register' ? 10 : 1)} onClick={() => void submitPassword()}>{busy ? '处理中…' : mode === 'login' ? '登录并自动配置' : '注册并自动配置'}</button></div>
      <div className="community-auth-divider"><span>或</span></div>
      <button className="secondary community-github-auth" disabled={busy} onClick={() => void submitGithub()}>使用 GitHub 授权<ExternalLink size={13} /></button>
    </>}
    {message && <small className="community-auth-message">{message}</small>}
  </div>
}
