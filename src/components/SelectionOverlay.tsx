import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { NormalizedSelection } from '../services/presentationGeometry'
import { normalizeSelection } from '../services/presentationGeometry'

export function SelectionOverlay({ width, height, onComplete, onCancel }: { width: number; height: number; onComplete(selection: NormalizedSelection): void; onCancel(): void }) {
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const [draft, setDraft] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const point = (event: ReactPointerEvent<HTMLDivElement>) => { const rect = event.currentTarget.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top } }
  const down = (event: ReactPointerEvent<HTMLDivElement>) => { const next = point(event); startRef.current = next; setDraft({ x0: next.x, y0: next.y, x1: next.x, y1: next.y }); event.currentTarget.setPointerCapture(event.pointerId) }
  const move = (event: ReactPointerEvent<HTMLDivElement>) => { if (!startRef.current) return; const next = point(event); setDraft({ x0: startRef.current.x, y0: startRef.current.y, x1: next.x, y1: next.y }) }
  const up = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!startRef.current) return
    const next = point(event), selection = normalizeSelection(startRef.current.x, startRef.current.y, next.x, next.y, width, height)
    startRef.current = null; setDraft(null)
    if (selection) onComplete(selection); else onCancel()
  }
  const style = draft ? { left: Math.min(draft.x0, draft.x1), top: Math.min(draft.y0, draft.y1), width: Math.abs(draft.x1 - draft.x0), height: Math.abs(draft.y1 - draft.y0) } : undefined
  return <div className="selection-overlay" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={onCancel} role="presentation">{draft && <div className="selection-draft" style={style} />}</div>
}
