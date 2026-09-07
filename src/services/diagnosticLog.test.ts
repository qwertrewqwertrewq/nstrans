import { describe, expect, it, vi } from 'vitest'
import { clearDiagnosticLog, diagnosticLogEntries, subscribeDiagnosticLog, writeDiagnosticLog } from './diagnosticLog'

describe('diagnostic log', () => {
  it('records structured events and notifies subscribers', () => {
    clearDiagnosticLog()
    const listener = vi.fn(), unsubscribe = subscribeDiagnosticLog(listener)
    writeDiagnosticLog('OCR', '识别成功', '3 条', 'success')
    expect(diagnosticLogEntries()).toEqual([expect.objectContaining({ category: 'OCR', event: '识别成功', detail: '3 条', level: 'success' })])
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('throttles identical noisy events', () => {
    clearDiagnosticLog()
    writeDiagnosticLog('OCR', '识别成功', '0 条', 'info', 10_000)
    writeDiagnosticLog('OCR', '识别成功', '0 条', 'info', 10_000)
    expect(diagnosticLogEntries()).toHaveLength(1)
  })
})
