import { useEffect, useState } from 'react'

import { MarkdownPreview } from '../components/MarkdownPreview'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Select } from '../components/ui/select'
import { MetricCard, PageIntro, SectionHeading } from '../components/ui/surface'
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

    return () => {
      cancelled = true
    }
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

    return () => {
      cancelled = true
    }
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

  const summaryMetrics = getReportSummaryMetrics(selectedReport?.summary)

  return (
    <div className="space-y-6">
      <PageIntro
        badge="Reports"
        title="Report library"
        description="Generate client-ready draft reports, compare prior runs, and preview the markdown output without leaving the workspace."
        actions={<Badge variant="neutral">{dateRange.label}</Badge>}
      />

      <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <SectionHeading
              title="Generate reports"
              description="Use presets for recurring cadences or define a custom reporting window."
            />
          </CardHeader>
          <CardContent className="space-y-6">
            <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); generateReport() }}>
              <Field label="Report type">
                <Select value={reportForm.type} onChange={(event) => setReportForm((current) => ({ ...current, type: event.target.value }))}>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="custom">Custom</option>
                </Select>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Period start">
                  <Input
                    type="date"
                    value={reportForm.startDate}
                    onChange={(event) => setReportForm((current) => ({ ...current, startDate: event.target.value }))}
                    disabled={reportForm.type !== 'custom'}
                  />
                </Field>
                <Field label="Period end">
                  <Input
                    type="date"
                    value={reportForm.endDate}
                    onChange={(event) => setReportForm((current) => ({ ...current, endDate: event.target.value }))}
                    disabled={reportForm.type !== 'custom'}
                  />
                </Field>
              </div>
              <p className="text-xs leading-5 text-slate-400">Prefilled from the active reporting window: {dateRange.label}</p>
              <div className="grid gap-3">
                <Button type="submit" disabled={generating}>
                  {generating ? 'Generating...' : 'Generate report'}
                </Button>
                <div className="flex flex-wrap gap-3">
                  <Button type="button" variant="secondary" size="sm" onClick={() => generateReport('weekly')} disabled={generating}>
                    Weekly preset
                  </Button>
                  <Button type="button" variant="secondary" size="sm" onClick={() => generateReport('monthly')} disabled={generating}>
                    Monthly preset
                  </Button>
                  <Button type="button" variant="secondary" size="sm" onClick={() => generateReport('quarterly')} disabled={generating}>
                    Quarterly preset
                  </Button>
                </div>
              </div>
            </form>

            <div className="space-y-3">
              <SectionHeading
                title="History"
                description="Pick any prior draft to compare narrative and metrics."
              />
              <div className="grid gap-3">
                {history.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`grid gap-2 rounded-[24px] border px-4 py-4 text-left transition-colors ${
                      selectedReportId === item.id
                        ? 'border-slate-950 bg-slate-950 text-white shadow-sm'
                        : 'border-slate-200 bg-slate-50/70 text-slate-700 hover:border-slate-300 hover:bg-white'
                    }`}
                    onClick={() => setSelectedReportId(item.id)}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <strong className="text-sm uppercase tracking-[0.12em]">{item.reportType}</strong>
                      <span className={selectedReportId === item.id ? 'text-slate-300' : 'text-slate-400'}>
                        {item.periodStart} to {item.periodEnd}
                      </span>
                    </div>
                    <span className={`text-sm leading-6 ${selectedReportId === item.id ? 'text-slate-300' : 'text-slate-500'}`}>
                      {formatReportSummaryLine(item.summary)}
                    </span>
                  </button>
                ))}
                {!history.length ? <p className="text-sm text-slate-500">No reports generated yet.</p> : null}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <SectionHeading
              title="Preview"
              description={selectedReport ? `${selectedReport.reportType} report draft for review and delivery.` : 'Select a report to preview the markdown output.'}
              action={selectedReport ? <Badge variant="accent">{selectedReport.periodStart} to {selectedReport.periodEnd}</Badge> : null}
            />
          </CardHeader>
          <CardContent className="space-y-6">
            {selectedReport ? (
              <>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <MetricCard label="Organic visibility" value={summaryMetrics.organicVisibility} tone="accent" />
                  <MetricCard label="Map visibility" value={summaryMetrics.mapVisibility} />
                  <MetricCard label="Top 10 keywords" value={summaryMetrics.top10Count} />
                  <MetricCard label="Top 3 pack" value={summaryMetrics.top3Count} />
                </div>
                <div className="rounded-[28px] border border-slate-200 bg-slate-50/70 p-5">
                  <MarkdownPreview markdown={selectedReport.content} />
                </div>
              </>
            ) : (
              <div className="rounded-[24px] border border-dashed border-slate-300 bg-slate-50/70 px-6 py-12 text-center text-sm leading-6 text-slate-500">
                No report selected.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function Field({ children, label }) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  )
}

function formatReportSummaryLine(summary) {
  const metrics = getReportSummaryMetrics(summary)
  return `Organic ${metrics.organicVisibility} / Map ${metrics.mapVisibility} / Top 10 ${metrics.top10Count} / Top 3 pack ${metrics.top3Count}`
}

function getReportSummaryMetrics(summary = {}) {
  const organic = summary?.organic || {}
  const mapPack = summary?.mapPack || {}
  return {
    organicVisibility: Number(summary?.visibilityScore ?? organic.visibilityScore ?? 0),
    mapVisibility: Number(summary?.mapPackVisibilityScore ?? mapPack.visibilityScore ?? 0),
    top10Count: Number(summary?.top10Count ?? organic.top10Count ?? 0),
    top3Count: Number(summary?.mapPackTop3Count ?? mapPack.top3Count ?? 0),
  }
}
