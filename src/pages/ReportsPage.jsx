import { useEffect, useState } from 'react'

import { MarkdownPreview } from '../components/MarkdownPreview'
import { apiRequest } from '../lib/api'
import { getDateRangeWindow } from '../lib/dateRange'

export function ReportsPage({ dateRange, onRefreshAuth, onSetNotice, workspace }) {
  const [history, setHistory] = useState([])
  const [selectedReportId, setSelectedReportId] = useState(null)
  const [selectedReport, setSelectedReport] = useState(null)
  const [generating, setGenerating] = useState(false)
  const [reportForm, setReportForm] = useState(() => ({ type: 'custom', ...getDateRangeWindow(dateRange) }))

  useEffect(() => {
    const windowRange = getDateRangeWindow(dateRange)
    setReportForm((current) => ({ ...current, startDate: windowRange.startDate, endDate: windowRange.endDate }))
  }, [dateRange])

  async function reloadHistory() {
    const historyJson = await apiRequest(`/api/workspaces/${workspace.id}/reports/history`)
    setHistory(historyJson.items || [])
    if (!selectedReportId && historyJson.items?.length) {
      setSelectedReportId(historyJson.items[0].id)
    }
  }

  useEffect(() => {
    let cancelled = false
    apiRequest(`/api/workspaces/${workspace.id}/reports/history`).then((historyJson) => {
      if (cancelled) return
      setHistory(historyJson.items || [])
      if (historyJson.items?.length) {
        setSelectedReportId((current) => current || historyJson.items[0].id)
      }
    }).catch((error) => onSetNotice(error.message))

    return () => { cancelled = true }
  }, [onSetNotice, workspace.id])

  useEffect(() => {
    if (!selectedReportId) {
      setSelectedReport(null)
      return
    }

    let cancelled = false
    apiRequest(`/api/workspaces/${workspace.id}/reports/${selectedReportId}`)
      .then((report) => {
        if (!cancelled) setSelectedReport(report)
      })
      .catch((error) => onSetNotice(error.message))

    return () => { cancelled = true }
  }, [onSetNotice, selectedReportId, workspace.id])

  async function generateReport(typeOverride = null) {
    const type = typeOverride || reportForm.type
    setGenerating(true)
    try {
      const body = type === 'custom'
        ? { type, startDate: reportForm.startDate, endDate: reportForm.endDate }
        : { type }
      const report = await apiRequest(`/api/workspaces/${workspace.id}/reports/generate`, {
        method: 'POST',
        body,
      })
      await reloadHistory()
      setSelectedReportId(report.id)
      await onRefreshAuth()
      onSetNotice(`${type} report generated.`)
    } catch (error) {
      onSetNotice(error.message)
    } finally {
      setGenerating(false)
    }
  }

  return (
    <section className="reports-split">
      <article className="panel reports-history-panel">
        <div className="panel-head">
          <h2>Report library</h2>
          <p>Generate recurring draft reports that an agency can brand, edit, and deliver.</p>
        </div>
        <form className="stack" onSubmit={(event) => { event.preventDefault(); generateReport() }}>
          <label>
            Report type
            <select value={reportForm.type} onChange={(event) => setReportForm((current) => ({ ...current, type: event.target.value }))}>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          <label>
            Period start
            <input type="date" value={reportForm.startDate} onChange={(event) => setReportForm((current) => ({ ...current, startDate: event.target.value }))} disabled={reportForm.type !== 'custom'} />
          </label>
          <label>
            Period end
            <input type="date" value={reportForm.endDate} onChange={(event) => setReportForm((current) => ({ ...current, endDate: event.target.value }))} disabled={reportForm.type !== 'custom'} />
          </label>
          <p className="muted-copy inline-note">Prefilled from the active workspace range: {dateRange.label}</p>
          <div className="row-actions">
            <button type="submit" disabled={generating}>{generating ? 'Generating...' : 'Generate report'}</button>
            <button type="button" className="secondary" onClick={() => generateReport('weekly')} disabled={generating}>Weekly preset</button>
            <button type="button" className="secondary" onClick={() => generateReport('monthly')} disabled={generating}>Monthly preset</button>
            <button type="button" className="secondary" onClick={() => generateReport('quarterly')} disabled={generating}>Quarterly preset</button>
          </div>
        </form>
        <div className="list-table mt reports-history-table">
          {history.map((item) => (
            <button
              key={item.id}
              type="button"
              className={selectedReportId === item.id ? 'report-row selected' : 'report-row'}
              onClick={() => setSelectedReportId(item.id)}
            >
              <strong>{item.reportType}</strong>
              <span>{item.periodStart} to {item.periodEnd}</span>
            </button>
          ))}
          {!history.length ? <p className="muted-copy">No reports generated yet.</p> : null}
        </div>
      </article>
      <aside className="panel reports-viewer-panel">
        <div className="panel-head">
          <h2>Preview</h2>
          <p>{selectedReport ? `${selectedReport.reportType} report draft` : 'Select a report to preview the markdown output.'}</p>
        </div>
        <div className="report-viewer">
          {selectedReport ? <MarkdownPreview markdown={selectedReport.content} /> : <p className="muted-copy">No report selected.</p>}
        </div>
      </aside>
    </section>
  )
}
