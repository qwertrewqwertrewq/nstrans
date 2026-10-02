// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CommunityAccountAccess } from './CommunityAccountAccess'

const build = { available: true, version: '0.1.5', attestation: 'signed-build' }
afterEach(cleanup)

describe('CommunityAccountAccess', () => {
  it('hides every authentication control after the device is connected', () => {
    render(<CommunityAccountAccess origin="https://example.com" build={build} connected onApiKey={vi.fn()} onDisconnect={vi.fn()} />)
    expect(screen.getByText('此设备已登录社区')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '退出此设备' })).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('用户名')).not.toBeInTheDocument()
    expect(screen.queryByText('使用 GitHub 授权')).not.toBeInTheDocument()
  })

  it('shows login and registration controls only while disconnected', () => {
    render(<CommunityAccountAccess origin="https://example.com" build={build} connected={false} onApiKey={vi.fn()} />)
    expect(screen.getByPlaceholderText('用户名')).toBeInTheDocument()
    expect(screen.getByText('使用 GitHub 授权')).toBeInTheDocument()
  })
})
