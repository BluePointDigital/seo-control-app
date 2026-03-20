import { useEffect, useState } from 'react'
import { Download, FileText, LayoutDashboard } from 'lucide-react'

import { DEFAULT_REPORT_SECTION_IDS, REPORT_SECTIONS } from '../../shared/reportSections.js'
import { MarkdownPreview } from '../components/MarkdownPreview'
import { ReportCanvas } from '../components/ReportCanvas'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Select } from '../components/ui/select'
import { FormField, MetricCard, PageIntro, SectionHeading } from '../components/ui/surface'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { apiRequest } from '../lib/api'
import { getDateRangeWindow } from '../lib/dateRange'
import {
  buildReportPdfPath,
  formatReportSummaryLine,
  getReportSectionMeta,
  getReportSummaryMetrics,
  getVisualReportPresentation,
} from '../lib/reports'

export function ReportsPage({ dateRange, onRefreshAuth, onSetNotice, routeQuery = {}, workspace }) {
  const [history, setHistory] = useState([])
  const [selectedReportId, setSelectedReportId] = useState(() => {
    const requested = Number(routeQuery?.reportId)
    return Number.isInteger(requested) && requested > 0 ? requested : null
  })
  const [selectedReport, setSelectedReport] = useState(null)
  const [selectedReportLoading, setSelectedReportLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [downloadingPdf, setDownloadingPdf] = useState(false)
  const [viewMode, setViewMode] = useState('visual')
  const [reportForm, setReportForm] = useState(() => ({
    type: 'custom',
    sections: [...DEFAULT_REPORT_SECTION_IDS],
    ...getDateRangeWindow(dateRange),
  }))
  const summaryMetrics = getReportSummaryMetrics(selectedReport?.summary)
  const includedSections = getReportSectionMeta(selectedReport?.summary)
  const hasVisualPresentation = Boolean(getVisualReportPresentation(selectedReport?.summary))

  useEffect(() => {
    const windowRange = getDateRangeWindow(dateRange)
    setReportForm((current) => ({
      ...current,
      startDate: windowRange.startDate,
      endDate: windowRange.endDate,
    }))
  }, [dateRange])

  useEffect(() => {
    if (!selectedReport) return
    setViewMode(getVisualReportPresentation(selectedReport.summary) ? 'visual' : 'narrative')
  }, [selectedReport])

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
    setSelectedReportLoading(true)
    apiRequest(`/api/workspaces/${workspace.id}/reports/${selectedReportId}`)
      .then((report) => {
        if (!cancelled) setSelectedReport(report)
      })
      .catch((error) => onSetNotice(error.message))
      .finally(() => {
        if (!cancelled) setSelectedReportLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [onSetNotice, selectedReportId, workspace.id])

  async function generateReport(typeOverride = null) {
    const type = typeOverride || reportForm.type
    if (!reportForm.sections.length) {
      onSetNotice('Select at least one report section.')
      return
    }

    setGenerating(true)
    try {
      const body = type === 'custom'
        ? {
            type,
            startDate: reportForm.startDate,
            endDate: reportForm.endDate,
            sections: reportForm.sections,
          }
        : {
            type,
            sections: reportForm.sections,
          }

      const report = await apiRequest(`/api/workspaces/${workspace.id}/reports/generate`, {
        method: 'POST',
        body,
      })
      await reloadHistory()
      setSelectedReportId(report.id)
      setSelectedReport(report)
      setViewMode(getVisualReportPresentation(report.summary) ? 'visual' : 'narrative')
      await onRefreshAuth()
      onSetNotice(`${type} report generated.`)
    } catch (error) {
      onSetNotice(error.message)
    } finally {
      setGenerating(false)
    }
  }

  function toggleSection(sectionId) {
    setReportForm((current) => {
      const exists = current.sections.includes(sectionId)
      return {
        ...current,
        sections: exists
          ? current.sections.filter((item) => item !== sectionId)
          : [...current.sections, sectionId].sort((left, right) => (
            DEFAULT_REPORT_SECTION_IDS.indexOf(left) - DEFAULT_REPORT_SECTION_IDS.indexOf(right)
          )),
      }
    })
  }

  async function handleDownloadPdf() {
    if (!selectedReport) return
    setDownloadingPdf(true)
    try {
      const response = await fetch(buildReportPdfPath(workspace.id, selectedReport.id), {
        credentials: 'same-origin',
      })

      if (!response.ok) {
        const contentType = response.headers.get('content-type') || ''
        const payload = contentType.includes('application/json') ? await response.json() : await response.text()
        throw new Error(typeof payload === 'string' ? payload : (payload?.error || 'Failed to download the PDF.'))
      }

      const blob = await response.blob()
      const objectUrl = window.URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = objectUrl
      anchor.download = `${selectedReport.summary?.presentation?.meta?.workspaceName || workspace.name}-${selectedReport.reportType}-report.pdf`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 1000)
      onSetNotice('PDF download started.')
    } catch (error) {
      onSetNotice(error.message)
    } finally {
      setDownloadingPdf(false)
    }
  }

  return (
    <div className="report-page space-y-6">
      <PageIntro
        badge="Reports"
        className="report-page-intro"
        title="Report library"
        description="Build client-ready visual reports with selectable sections, live charts, and a native PDF export."
        actions={<Badge variant="neutral">{dateRange.label}</Badge>}
      />

      <div className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
        <Card className="report-page-sidebar">
          <CardHeader>
            <SectionHeading
              title="Generate reports"
              description="Choose a cadence, confirm the date window, and decide which sections to include before generating the report."
            />
          </CardHeader>
          <CardContent className="space-y-6">
            <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); generateReport() }}>
              <FormField label="Report type">
                <Select value={reportForm.type} onChange={(event) => setReportForm((current) => ({ ...current, type: event.target.value }))}>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="custom">Custom</option>
                </Select>
              </FormField>

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Period start">
                  <Input
                    type="date"
                    value={reportForm.startDate}
                    onChange={(event) => setReportForm((current) => ({ ...current, startDate: event.target.value }))}
                    disabled={reportForm.type !== 'custom'}
                  />
                </FormField>
                <FormField label="Period end">
                  <Input
                    type="date"
                    value={reportForm.endDate}
                    onChange={(event) => setReportForm((current) => ({ ...current, endDate: event.target.value }))}
                    disabled={reportForm.type !== 'custom'}
                  />
                </FormField>
              </div>

              <p className="text-xs leading-5 text-slate-400">
                Prefilled from the active reporting window: {dateRange.label}
              </p>

              <div className="space-y-3">
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-slate-950">Sections to include</h3>
                  <p className="text-sm leading-6 text-slate-500">
                    These choices are saved with the generated report and drive the preview, narrative, and PDF output.
                  </p>
                </div>
                <div className="grid gap-3">
                  {REPORT_SECTIONS.map((section) => (
                    <SectionToggle
                      key={section.id}
                      checked={reportForm.sections.includes(section.id)}
                      description={section.description}
                      label={section.label}
                      onChange={() => toggleSection(section.id)}
                    />
                  ))}
                </div>
              </div>

              <div className="grid gap-3">
                <Button type="submit" disabled={generating || !reportForm.sections.length}>
                  {generating ? 'Generating...' : 'Generate report'}
                </Button>
                <div className="flex flex-wrap gap-3">
                  <Button type="button" variant="secondary" size="sm" onClick={() => generateReport('weekly')} disabled={generating || !reportForm.sections.length}>
                    Weekly preset
                  </Button>
                  <Button type="button" variant="secondary" size="sm" onClick={() => generateReport('monthly')} disabled={generating || !reportForm.sections.length}>
                    Monthly preset
                  </Button>
                  <Button type="button" variant="secondary" size="sm" onClick={() => generateReport('quarterly')} disabled={generating || !reportForm.sections.length}>
                    Quarterly preset
                  </Button>
                </div>
              </div>
            </form>

            <div className="space-y-3">
              <SectionHeading
                title="History"
                description="Jump between prior drafts and compare which sections each report included."
              />
              <div className="grid gap-3">
                {history.map((item) => {
                  const historySections = getReportSectionMeta(item.summary)
                  const selected = selectedReportId === item.id
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`grid gap-3 rounded-[24px] border px-4 py-4 text-left transition-colors ${
                        selected
                          ? 'border-slate-950 bg-slate-950 text-white shadow-sm'
                          : 'border-slate-200 bg-slate-50/70 text-slate-700 hover:border-slate-300 hover:bg-white'
                      }`}
                      onClick={() => setSelectedReportId(item.id)}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <strong className="text-sm uppercase tracking-[0.12em]">{item.reportType}</strong>
                        <span className={selected ? 'text-slate-300' : 'text-slate-400'}>
                          {item.periodStart} to {item.periodEnd}
                        </span>
                      </div>
                      <div className={`grid gap-1 text-sm ${selected ? 'text-slate-200' : 'text-slate-500'}`}>
                        <span>{formatReportSummaryLine(item.summary)}</span>
                        <span>Clicks {Math.round(item.summary?.clicks || 0)} / Sessions {Math.round(item.summary?.sessions || 0)} / Conversions {Math.round(item.summary?.conversions || 0)}</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {historySections.slice(0, 4).map((section) => (
                          <Badge key={`${item.id}-${section.id}`} variant={selected ? 'neutral' : 'default'}>
                            {section.shortLabel}
                          </Badge>
                        ))}
                        {historySections.length > 4 ? (
                          <Badge variant={selected ? 'neutral' : 'default'}>
                            +{historySections.length - 4} more
                          </Badge>
                        ) : null}
                      </div>
                    </button>
                  )
                })}
                {!history.length ? <p className="text-sm text-slate-500">No reports generated yet.</p> : null}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="report-preview-card">
          <CardHeader className="report-preview-toolbar">
            <SectionHeading
              title="Preview"
              description={
                selectedReport
                  ? `${selectedReport.reportType} report draft for review, export, and delivery.`
                  : 'Select a report to preview the visual layout and narrative.'
              }
              action={selectedReport ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="accent">{selectedReport.periodStart} to {selectedReport.periodEnd}</Badge>
                  <Button type="button" variant="secondary" size="sm" onClick={handleDownloadPdf} disabled={downloadingPdf}>
                    <Download className="mr-2 h-4 w-4" />
                    {downloadingPdf ? 'Preparing PDF...' : 'Download PDF'}
                  </Button>
                </div>
              ) : null}
            />
          </CardHeader>
          <CardContent className="space-y-6">
            {selectedReport ? (
              <>
                <div className="report-preview-summary grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
                  <MetricCard label="Organic visibility" value={summaryMetrics.organicVisibility} tone="accent" />
                  <MetricCard label="Map visibility" value={summaryMetrics.mapVisibility} />
                  <MetricCard label="Top 10 keywords" value={summaryMetrics.top10Count} />
                  <MetricCard label="Top 3 pack" value={summaryMetrics.top3Count} />
                  <MetricCard label="Health score" value={summaryMetrics.healthScore == null ? 'n/a' : summaryMetrics.healthScore} tone={summaryMetrics.healthScore == null ? 'subtle' : 'warning'} />
                </div>

                <Tabs value={viewMode} onValueChange={setViewMode}>
                  <div className="report-legacy-tabs flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <TabsList>
                      <TabsTrigger value="visual" disabled={!hasVisualPresentation}>
                        <LayoutDashboard className="mr-2 h-4 w-4" />
                        Visual report
                      </TabsTrigger>
                      <TabsTrigger value="narrative">
                        <FileText className="mr-2 h-4 w-4" />
                        Narrative
                      </TabsTrigger>
                    </TabsList>

                    <div className="flex flex-wrap gap-2">
                      {includedSections.map((section) => (
                        <Badge key={`selected-${section.id}`} variant="default">
                          {section.shortLabel}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  <TabsContent value="visual" className="mt-0">
                    {hasVisualPresentation ? (
                      <ReportCanvas key={selectedReport.id} printMode={false} report={selectedReport} />
                    ) : (
                      <div className="rounded-[24px] border border-dashed border-slate-300 bg-slate-50/70 px-6 py-12 text-center text-sm leading-6 text-slate-500">
                        This report was generated before the visual canvas was introduced. Use the narrative tab or generate a new report to get the upgraded presentation.
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="narrative" className="mt-0">
                    <div className="rounded-[28px] border border-slate-200 bg-slate-50/70 p-5">
                      <MarkdownPreview markdown={selectedReport.content} />
                    </div>
                  </TabsContent>
                </Tabs>
              </>
            ) : selectedReportLoading ? (
              <div className="rounded-[24px] border border-dashed border-slate-300 bg-slate-50/70 px-6 py-12 text-center text-sm leading-6 text-slate-500">
                Loading report...
              </div>
            ) : (
              <div className="report-empty-state rounded-[24px] border border-dashed border-slate-300 bg-slate-50/70 px-6 py-12 text-center text-sm leading-6 text-slate-500">
                No report selected.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function SectionToggle({ checked, description, label, onChange }) {
  return (
    <label className={`flex cursor-pointer items-start gap-3 rounded-[22px] border px-4 py-4 transition-colors ${
      checked
        ? 'border-emerald-200 bg-emerald-50/70'
        : 'border-slate-200 bg-slate-50/70 hover:border-slate-300 hover:bg-white'
    }`}>
      <input
        checked={checked}
        className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
        onChange={onChange}
        type="checkbox"
      />
      <span className="grid gap-1">
        <span className="text-sm font-semibold text-slate-950">{label}</span>
        <span className="text-sm leading-6 text-slate-500">{description}</span>
      </span>
    </label>
  )
}
