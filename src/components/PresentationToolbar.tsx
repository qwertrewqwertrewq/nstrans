import { EyeOff, Languages, Minimize2, Move, Play, RotateCcw, ScanSearch, Square } from 'lucide-react'
import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { nearestDockEdge, type DockEdge } from '../services/presentationGeometry'

type Position = { x: number; y: number }

export function PresentationToolbar({ paused, selecting, hasSelection, mediaAvailable, onTogglePause, onSelect, onReset, onClearSelection, onExit }: { paused: boolean; selecting: boolean; hasSelection: boolean; mediaAvailable: boolean; onTogglePause(): void; onSelect(): void; onReset(): void; onClearSelection(): void; onExit(): void }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ pointerId: number; clientX: number; clientY: number; position: Position } | null>(null)
  const [position, setPosition] = useState<Position>({ x: 20, y: 20 })
  const positionRef = useRef(position)
  const [docked, setDocked] = useState<DockEdge | null>(null)

  const bounds = () => { const parent = rootRef.current?.parentElement?.getBoundingClientRect(); const self = rootRef.current?.getBoundingClientRect(); return parent && self ? { parent, self } : null }
  const hideToNearestEdge = () => { const value = bounds(), current = positionRef.current; if (value) setDocked(nearestDockEdge(current.x, current.y, value.self.width, value.self.height, value.parent.width, value.parent.height)) }
  const down = (event: ReactPointerEvent<HTMLButtonElement>) => { dragRef.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, position: positionRef.current }; event.currentTarget.setPointerCapture(event.pointerId) }
  const move = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current, value = bounds(); if (!drag || !value) return
    const next = { x: Math.max(0, Math.min(value.parent.width - value.self.width, drag.position.x + event.clientX - drag.clientX)), y: Math.max(0, Math.min(value.parent.height - value.self.height, drag.position.y + event.clientY - drag.clientY)) }
    positionRef.current = next; setPosition(next)
  }
  const up = () => {
    const value = bounds(); dragRef.current = null
    if (!value) return
    const current = positionRef.current, edge = nearestDockEdge(current.x, current.y, value.self.width, value.self.height, value.parent.width, value.parent.height)
    const distance = edge === 'left' ? current.x : edge === 'right' ? value.parent.width - current.x - value.self.width : edge === 'top' ? current.y : value.parent.height - current.y - value.self.height
    if (distance <= 18) setDocked(edge)
  }

  if (docked) return <button className={`presentation-dock-tab ${docked}`} onClick={() => setDocked(null)} aria-label="展开翻译工具"><Languages size={17} /></button>
  return <div className="presentation-toolbar" ref={rootRef} style={{ transform: `translate(${position.x}px, ${position.y}px)` }}>
    <button className="toolbar-drag" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} title="拖动工具条"><Move size={16} /></button>
    <button disabled={!mediaAvailable} onClick={onTogglePause} title={paused ? '继续播放' : '暂停画面并全画面翻译'}>{paused ? <Play size={16} /> : <Square size={15} />}</button>
    <button disabled={!mediaAvailable} className={selecting || hasSelection ? 'active' : ''} onClick={onSelect} title={selecting || hasSelection ? '取消框选并恢复全画面' : '框选翻译区域'}><ScanSearch size={16} /></button>
    <button disabled={!mediaAvailable} onClick={onReset} title="重置上下文并重新翻译"><RotateCcw size={16} /></button>
    {hasSelection && <button disabled={!mediaAvailable} onClick={onClearSelection} title="清除框选区域">×</button>}
    <button onClick={hideToNearestEdge} title="隐藏到最近边缘"><EyeOff size={15} /></button>
    <button onClick={onExit} title="退出全屏或全窗口"><Minimize2 size={15} /></button>
  </div>
}
