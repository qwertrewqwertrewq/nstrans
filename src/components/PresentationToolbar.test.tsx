// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PresentationToolbar } from './PresentationToolbar'

describe('PresentationToolbar', () => {
  it('exposes pause, selection, reset and clear-selection actions', () => {
    const onTogglePause = vi.fn(), onSelect = vi.fn(), onReset = vi.fn(), onClearSelection = vi.fn(), onExit = vi.fn()
    render(<PresentationToolbar paused={false} selecting={false} hasSelection mediaAvailable onTogglePause={onTogglePause} onSelect={onSelect} onReset={onReset} onClearSelection={onClearSelection} onExit={onExit} />)
    fireEvent.click(screen.getByTitle('暂停画面并全画面翻译'))
    fireEvent.click(screen.getByTitle('取消框选并恢复全画面'))
    fireEvent.click(screen.getByTitle('重置上下文并重新翻译'))
    fireEvent.click(screen.getByTitle('清除框选区域'))
    fireEvent.click(screen.getByTitle('退出全屏或全窗口'))
    expect(onTogglePause).toHaveBeenCalledOnce(); expect(onSelect).toHaveBeenCalledOnce(); expect(onReset).toHaveBeenCalledOnce(); expect(onClearSelection).toHaveBeenCalledOnce(); expect(onExit).toHaveBeenCalledOnce()
  })

  it('offers resume while the frame is paused', () => {
    render(<PresentationToolbar paused selecting={false} hasSelection={false} mediaAvailable onTogglePause={() => {}} onSelect={() => {}} onReset={() => {}} onClearSelection={() => {}} onExit={() => {}} />)
    expect(screen.getByTitle('继续播放')).toBeInTheDocument()
  })

  it('keeps the selection button active after a region is committed', () => {
    const { container } = render(<PresentationToolbar paused={false} selecting={false} hasSelection mediaAvailable onTogglePause={() => {}} onSelect={() => {}} onReset={() => {}} onClearSelection={() => {}} onExit={() => {}} />)
    const button = container.querySelector<HTMLButtonElement>('[title="取消框选并恢复全画面"]')
    expect(button).toHaveClass('active')
  })
})
