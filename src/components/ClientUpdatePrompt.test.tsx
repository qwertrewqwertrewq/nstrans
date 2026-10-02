// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClientUpdatePrompt } from './ClientUpdatePrompt'

const policy = { targetVersion: '0.1.5', popupEnabled: true, forceUpdate: false, content: '重要更新', downloadUrl: 'https://example.com/download', shouldShow: true }
afterEach(cleanup)

describe('ClientUpdatePrompt', () => {
  it('allows a normal update reminder to be dismissed', () => {
    const close = vi.fn()
    render(<ClientUpdatePrompt policy={policy} onClose={close} />)
    fireEvent.click(screen.getByRole('button', { name: '稍后提醒' }))
    expect(close).toHaveBeenCalledOnce()
  })

  it('does not render any dismiss action for a forced update', () => {
    render(<ClientUpdatePrompt policy={{ ...policy, forceUpdate: true }} onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: '稍后提醒' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '关闭更新提示' })).not.toBeInTheDocument()
    expect(screen.getByText(/完成更新后才能继续使用/)).toBeInTheDocument()
  })
})
