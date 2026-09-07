export type DiagnosticLogLevel = 'info' | 'success' | 'warning' | 'error'
export type DiagnosticLogCategory = '系统' | 'OCR' | '词库' | '搜索' | 'LLM'
export type DiagnosticLogEntry = {
  id: number
  timestamp: number
  level: DiagnosticLogLevel
  category: DiagnosticLogCategory
  event: string
  detail?: string
}

type Listener = (entry: DiagnosticLogEntry) => void
const listeners = new Set<Listener>()
const entries: DiagnosticLogEntry[] = []
const lastEmission = new Map<string, number>()
let nextId = 1

export function writeDiagnosticLog(category: DiagnosticLogCategory, event: string, detail?: string, level: DiagnosticLogLevel = 'info', throttleMs = 0) {
  const timestamp = Date.now(), key = `${category}\u0000${event}`
  if (throttleMs && timestamp - (lastEmission.get(key) ?? 0) < throttleMs) return
  lastEmission.set(key, timestamp)
  const entry = { id: nextId++, timestamp, level, category, event, detail }
  entries.push(entry)
  if (entries.length > 300) entries.splice(0, entries.length - 300)
  listeners.forEach((listener) => listener(entry))
}

export function diagnosticLogEntries() { return [...entries] }
export function subscribeDiagnosticLog(listener: Listener) { listeners.add(listener); return () => { listeners.delete(listener) } }
export function clearDiagnosticLog() { entries.length = 0; lastEmission.clear() }
