import { useMemo, useRef, useState } from 'react'
import { Check, Pencil, ScanSearch, Search, X } from 'lucide-react'
import type { EntitySearchEngineId } from '../services/entitySearchSettings'
import { entitySearchEngineLabels } from '../services/entitySearchSettings'
import type { TerminologyItem, TerminologySource } from '../services/translationRouter'

type Sentence = { id: string; source: string; translated: string; confidence: number }
const tagLabels: Record<TerminologySource, string> = { remote: '远程词库', search: '搜索', 'ocr-fallback': 'OCR 兜底' }

export function TerminologyInspector({ sentences, terms, onEdit, onSearch, onVision }: {
  sentences: Sentence[]
  terms: TerminologyItem[]
  onEdit(item: TerminologyItem, source: string, target: string): Promise<void>
  onSearch(items: TerminologyItem[], engine: EntitySearchEngineId): Promise<void>
  onVision(items: TerminologyItem[]): Promise<void>
}) {
  const [sentenceId, setSentenceId] = useState(''), [filters, setFilters] = useState<Set<TerminologySource>>(new Set())
  const [checked, setChecked] = useState<Set<string>>(new Set()), [engine, setEngine] = useState<EntitySearchEngineId>('wiki')
  const [editing, setEditing] = useState<string>(), [draft, setDraft] = useState({ source: '', target: '' }), [working, setWorking] = useState(''), [message, setMessage] = useState('')
  const rowRefs = useRef(new Map<string, HTMLDivElement>())
  const activeSentenceId = sentences.some(({ id }) => id === sentenceId) ? sentenceId : sentences[0]?.id ?? ''
  const visible = useMemo(() => terms.filter((term) => !filters.size || filters.has(term.tag)), [terms, filters])
  const selected = visible.filter((term) => checked.has(term.id))
  const chooseSentence = (id: string) => {
    setSentenceId(id)
    const first = visible.find((term) => term.sentenceId === id)
    if (first) requestAnimationFrame(() => rowRefs.current.get(first.id)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }))
  }
  const toggleFilter = (tag: TerminologySource) => setFilters((current) => { const next = new Set(current); if (next.has(tag)) next.delete(tag); else next.add(tag); return next })
  const run = async (name: string, action: () => Promise<void>) => { setWorking(name); setMessage(''); try { await action(); setMessage('操作完成，结果已写入本地术语层') } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) } finally { setWorking('') } }
  const targets = (single?: TerminologyItem) => single ? [single] : selected
  return <div className="terminology-inspector">
    <div className="sentence-pane">
      <div className="inspector-pane-title"><strong>实时句子</strong><span>{sentences.length}</span></div>
      <div className="sentence-list">{sentences.length ? sentences.map((sentence) => <button key={sentence.id} className={sentence.id === activeSentenceId ? 'active' : ''} onClick={() => chooseSentence(sentence.id)}><span>{Math.round(sentence.confidence)}%</span><div><strong lang="ja">{sentence.source}</strong><small>{sentence.translated || '等待翻译…'}</small></div><i>{terms.filter((term) => term.sentenceId === sentence.id).length}</i></button>) : <div className="empty-results">识别结果将在这里显示</div>}</div>
    </div>
    <div className="term-pane">
      <div className="term-toolbar">
        <div className="tag-filters">{(Object.keys(tagLabels) as TerminologySource[]).map((tag) => <button key={tag} className={!filters.size || filters.has(tag) ? `term-tag ${tag}` : 'term-tag muted-tag'} onClick={() => toggleFilter(tag)}>{tagLabels[tag]}</button>)}</div>
        <div className="bulk-actions"><select value={engine} onChange={(event) => setEngine(event.target.value as EntitySearchEngineId)}>{Object.entries(entitySearchEngineLabels).map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select><button disabled={!selected.length || Boolean(working)} onClick={() => void run('search', () => onSearch(selected, engine))}><Search size={13} />重新搜索{selected.length ? ` (${selected.length})` : ''}</button><button disabled={!selected.length || Boolean(working)} onClick={() => void run('vision', () => onVision(selected))}><ScanSearch size={13} />多模态识别</button></div>
      </div>
      <div className="term-list">{visible.length ? visible.map((term) => <div className={`term-row ${term.sentenceId === activeSentenceId ? 'focused' : ''}`} key={term.id} ref={(node) => { if (node) rowRefs.current.set(term.id, node); else rowRefs.current.delete(term.id) }}>
        <input type="checkbox" checked={checked.has(term.id)} onChange={() => setChecked((current) => { const next = new Set(current); if (next.has(term.id)) next.delete(term.id); else next.add(term.id); return next })} />
        {editing === term.id ? <><div className="term-edit"><input value={draft.source} lang="ja" onChange={(event) => setDraft({ ...draft, source: event.target.value })} /><input value={draft.target} onChange={(event) => setDraft({ ...draft, target: event.target.value })} /></div><button title="保存" onClick={() => void run('edit', async () => { await onEdit(term, draft.source, draft.target); setEditing(undefined) })}><Check size={14} /></button><button title="取消" onClick={() => setEditing(undefined)}><X size={14} /></button></> : <><div className="term-text"><strong lang="ja">{term.source}</strong><span>→</span><b>{term.target || '未确认译名'}</b><small className={`term-tag ${term.tag}`}>{tagLabels[term.tag]}</small>{term.manuallyEdited && <small className="edited-tag">已编辑</small>}</div><button title="手动编辑" onClick={() => { setEditing(term.id); setDraft({ source: term.source, target: term.target }) }}><Pencil size={13} /></button><button title={`使用 ${entitySearchEngineLabels[engine]} 重新搜索`} disabled={Boolean(working)} onClick={() => void run('search', () => onSearch(targets(term), engine))}><Search size={13} /></button><button title="用所选 Qwen 模型重新进行多模态识别" disabled={Boolean(working)} onClick={() => void run('vision', () => onVision(targets(term)))}><ScanSearch size={13} /></button></>}
      </div>) : <div className="empty-results">当前句子暂无可追踪术语</div>}</div>
      {message && <div className="term-message">{message}</div>}
    </div>
  </div>
}
