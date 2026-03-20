import { useState } from 'react'
import { ArrowUpRight, BarChart3, Gauge, TrendingDown, TrendingUp } from 'lucide-react'

import { getFindingAccordionValues, getReportSectionMeta, getVisualReportPresentation } from '../lib/reports'
import { cn } from '../lib/utils'
import { LineChart } from './LineChart'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './ui/accordion'
import { Badge } from './ui/badge'
import { Card, CardContent, CardHeader } from './ui/card'
import { MetricCard, SectionHeading } from './ui/surface'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'

export function ReportCanvas({ printMode = false, report }) {
  const summary = report?.summary || {}
  const presentation = getVisualReportPresentation(summary)
  const groupedFindingValues = getFindingAccordionValues(presentation?.groupedFindings)
  const [activeStrategy, setActiveStrategy] = useState(() => presentation?.lighthouse?.strategies?.[0]?.id || 'mobile')
  const [openFindings, setOpenFindings] = useState(groupedFindingValues.slice(0, 2))
  const visibleFindingValues = printMode ? groupedFindingValues : openFindings

  if (!presentation) return null

  const includedSections = getReportSectionMeta(summary)

  return (
    <div className="report-canvas space-y-6 rounded-[32px] border border-white/80 bg-white/95 p-5 shadow-[0_28px_90px_-48px_rgba(15,23,42,0.45)] sm:p-8">
      <section className="report-section rounded-[28px] border border-slate-200/80 bg-[linear-gradient(135deg,rgba(255,255,255,0.96),rgba(240,249,255,0.85))] p-6 shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="accent">{presentation.meta.reportHeading} report</Badge>
              <Badge variant="neutral">{presentation.meta.dateRangeLabel}</Badge>
            </div>
            <div className="space-y-2">
              <h2 className="text-3xl font-semibold tracking-tight text-slate-950">{presentation.meta.title}</h2>
              <p className="max-w-3xl text-sm leading-7 text-slate-600">{presentation.meta.headline}</p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:min-w-[280px]">
            <InfoTile label="Generated" value={formatDateTime(presentation.meta.generatedAt)} />
            <InfoTile label="Sections included" value={`${includedSections.length}`} />
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          {includedSections.map((section) => (
            <Badge key={section.id} variant="default">
              {section.shortLabel}
            </Badge>
          ))}
        </div>
      </section>

      {presentation.executive ? (
        <Card className="report-section">
          <CardHeader>
            <SectionHeading
              title="Executive snapshot"
              description="A top-line view of client performance, rankings, and technical health for this reporting period."
            />
          </CardHeader>
          <CardContent className="space-y-5">
            <p className="rounded-[24px] border border-emerald-100 bg-emerald-50/70 px-5 py-4 text-sm leading-7 text-emerald-950">
              {presentation.executive.headline}
            </p>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {(presentation.executive.kpis || []).map((metric) => (
                <MetricCard key={metric.id} label={metric.label} tone={metric.tone} value={formatMetricDisplay(metric)} />
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {presentation.charts?.length ? (
        <Card className="report-section">
          <CardHeader>
            <SectionHeading
              title="Performance charts"
              description="Cross-channel trend lines aligned to the selected reporting window."
            />
          </CardHeader>
          <CardContent className="grid gap-5 xl:grid-cols-2">
            {presentation.charts.map((chart) => (
              <div key={chart.id} className="rounded-[24px] border border-slate-200 bg-slate-50/60 p-4 shadow-sm">
                <div className="mb-4 space-y-1">
                  <p className="text-base font-semibold text-slate-950">{chart.title}</p>
                  <p className="text-sm text-slate-500">{chart.subtitle}</p>
                </div>
                <LineChart rows={chart.rows || []} series={chart.series || []} height={260} staticMode={printMode} />
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {presentation.ads ? (
        <Card className="report-section">
          <CardHeader>
            <SectionHeading
              title="Google Ads / paid media"
              description="Paid search reporting is kept separate so it can be included only for workspaces actively using Google Ads."
            />
          </CardHeader>
          <CardContent className="space-y-5">
            <p className="rounded-[24px] border border-slate-200 bg-slate-50/80 px-5 py-4 text-sm leading-7 text-slate-600">
              {presentation.ads.narrative}
            </p>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {(presentation.ads.kpis || []).map((metric) => (
                <MetricCard key={metric.id} label={metric.label} tone={metric.tone} value={formatMetricDisplay(metric)} />
              ))}
            </div>
            <div className="grid gap-5">
              {(presentation.ads.charts || []).map((chart) => (
                <div key={chart.id} className="rounded-[24px] border border-slate-200 bg-slate-50/60 p-4 shadow-sm">
                  <div className="mb-4 space-y-1">
                    <p className="text-base font-semibold text-slate-950">{chart.title}</p>
                    <p className="text-sm text-slate-500">{chart.subtitle}</p>
                  </div>
                  <LineChart rows={chart.rows || []} series={chart.series || []} height={260} staticMode={printMode} />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {presentation.rankings ? (
        <Card className="report-section">
          <CardHeader>
            <SectionHeading
              title="Rankings summary"
              description="Organic and local search movement, including winners, decliners, and matched map-pack visibility."
            />
          </CardHeader>
          <CardContent className="grid gap-5 xl:grid-cols-2">
            <RankingPanel mode={presentation.rankings.organic} />
            <RankingPanel mode={presentation.rankings.mapPack} showMatchedListings />
          </CardContent>
        </Card>
      ) : null}

      {presentation.lighthouse ? (
        <Card className="report-section">
          <CardHeader>
            <SectionHeading
              title="Lighthouse overview"
              description="A concise PageSpeed summary for mobile and desktop, focused on category scores and core metrics."
            />
          </CardHeader>
          <CardContent className="space-y-5">
            {presentation.lighthouse.error ? (
              <div className="rounded-[24px] border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm leading-6 text-amber-800">
                {presentation.lighthouse.error}
              </div>
            ) : null}

            {presentation.lighthouse.strategies?.length ? (
              <Tabs value={activeStrategy} onValueChange={setActiveStrategy}>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <TabsList>
                    {presentation.lighthouse.strategies.map((strategy) => (
                      <TabsTrigger key={strategy.id} value={strategy.id}>
                        {strategy.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  {presentation.lighthouse.strategies.map((strategy) => (
                    strategy.id === activeStrategy && strategy.reportUrl ? (
                      <a
                        key={`${strategy.id}-link`}
                        className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50"
                        href={strategy.reportUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        Open in PageSpeed
                        <ArrowUpRight className="h-4 w-4" />
                      </a>
                    ) : null
                  ))}
                </div>

                {presentation.lighthouse.strategies.map((strategy) => (
                  <TabsContent key={strategy.id} value={strategy.id} className="mt-5 space-y-5">
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                      <MetricCard label="Performance" tone={scoreTone(strategy.performance)} value={formatScore(strategy.performance)} />
                      <MetricCard label="SEO" tone={scoreTone(strategy.seo)} value={formatScore(strategy.seo)} />
                      <MetricCard label="Accessibility" tone={scoreTone(strategy.accessibility)} value={formatScore(strategy.accessibility)} />
                      <MetricCard label="Best practices" tone={scoreTone(strategy.bestPractices)} value={formatScore(strategy.bestPractices)} />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                      {(strategy.metrics || []).map((metric) => (
                        <MetricCard
                          key={metric.id}
                          className="bg-slate-50/90"
                          label={metric.title}
                          tone="subtle"
                          value={metric.displayValue || 'n/a'}
                        />
                      ))}
                    </div>
                  </TabsContent>
                ))}
              </Tabs>
            ) : (
              <div className="rounded-[24px] border border-dashed border-slate-300 bg-slate-50/70 px-6 py-10 text-center text-sm leading-6 text-slate-500">
                Lighthouse overview data is not available for this report.
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {presentation.groupedFindings ? (
        <Card className="report-section">
          <CardHeader>
            <SectionHeading
              title="Grouped findings"
              description="Technical findings grouped by issue type, sorted by severity and issue volume."
            />
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <MetricCard label="High issues" tone="danger" value={presentation.groupedFindings.counts?.high || 0} />
              <MetricCard label="Medium issues" tone="warning" value={presentation.groupedFindings.counts?.medium || 0} />
              <MetricCard label="Low issues" value={presentation.groupedFindings.counts?.low || 0} />
              <MetricCard label="Finding groups" tone="accent" value={presentation.groupedFindings.totalGroups || 0} />
              <MetricCard label="Affected URLs" tone="subtle" value={presentation.groupedFindings.totalUrls || 0} />
            </div>

            {presentation.groupedFindings.items?.length ? (
              printMode ? (
                <div className="space-y-4">
                  {presentation.groupedFindings.items.map((item) => (
                    <FindingPanel key={`${item.severity}-${item.code}`} item={item} />
                  ))}
                </div>
              ) : (
                <Accordion className="space-y-3" type="multiple" value={visibleFindingValues} onValueChange={setOpenFindings}>
                  {presentation.groupedFindings.items.map((item) => {
                    const value = `${item.severity || 'low'}:${item.code || item.title || 'finding'}`
                    return (
                      <AccordionItem key={value} value={value}>
                        <AccordionTrigger className="items-start px-5 py-4">
                          <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <SeverityBadge severity={item.severity} />
                                <span className="text-base font-semibold text-slate-950">{item.title}</span>
                              </div>
                              <p className="text-sm font-normal leading-6 text-slate-500">{item.message || 'No description available.'}</p>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                              <span>{item.code}</span>
                              <span>{item.urlCount} URLs</span>
                            </div>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent className="px-5 pb-5">
                          <FindingBody item={item} />
                        </AccordionContent>
                      </AccordionItem>
                    )
                  })}
                </Accordion>
              )
            ) : (
              <div className="rounded-[24px] border border-dashed border-slate-300 bg-slate-50/70 px-6 py-10 text-center text-sm leading-6 text-slate-500">
                No grouped findings were saved with this report.
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {presentation.nextActions?.length ? (
        <Card className="report-section">
          <CardHeader>
            <SectionHeading
              title="Recommended next actions"
              description="Priority actions inferred from rankings, site health, and reporting trends."
            />
          </CardHeader>
          <CardContent className="grid gap-4">
            {presentation.nextActions.map((action, index) => (
              <div key={`${index + 1}-${action}`} className="flex gap-4 rounded-[24px] border border-slate-200 bg-slate-50/80 px-5 py-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-950 text-sm font-semibold text-white">
                  {index + 1}
                </div>
                <p className="pt-1 text-sm leading-7 text-slate-700">{action}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

function RankingPanel({ mode, showMatchedListings = false }) {
  if (!mode) return null

  return (
    <div className="rounded-[24px] border border-slate-200 bg-slate-50/70 p-5 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-emerald-600" />
            <h3 className="text-lg font-semibold tracking-tight text-slate-950">{mode.title}</h3>
          </div>
          <p className="text-sm leading-6 text-slate-500">{mode.narrative}</p>
        </div>
        <Badge variant="neutral">{mode.latestDate || 'No baseline'}</Badge>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {(mode.metrics || []).map((metric) => (
          <MetricCard key={metric.id} label={metric.label} tone={metric.tone} value={formatMetricDisplay(metric)} />
        ))}
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        <MovementList
          emptyCopy="No positive movers recorded in this range."
          icon={<TrendingUp className="h-4 w-4 text-emerald-600" />}
          items={mode.winners || []}
          title="Winners"
          tone="emerald"
        />
        <MovementList
          emptyCopy="No decliners recorded in this range."
          icon={<TrendingDown className="h-4 w-4 text-rose-600" />}
          items={mode.decliners || []}
          title="Decliners"
          tone="rose"
        />
      </div>

      {showMatchedListings ? (
        <div className="mt-5 rounded-[22px] border border-slate-200 bg-white px-4 py-4">
          <div className="mb-3 flex items-center gap-2">
            <Gauge className="h-4 w-4 text-emerald-600" />
            <p className="text-sm font-semibold text-slate-950">Current matched listings</p>
          </div>
          {mode.matchedListings?.length ? (
            <div className="grid gap-3">
              {mode.matchedListings.map((item) => (
                <div key={`${item.keyword}-${item.position}`} className="rounded-[18px] border border-slate-200 bg-slate-50/80 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-slate-950">{item.keyword}</span>
                    <Badge variant="accent">#{item.position}</Badge>
                  </div>
                  <p className="mt-2 text-sm text-slate-500">{item.foundName || 'Listing matched'}</p>
                  {item.foundUrl ? (
                    <a className="mt-1 inline-flex text-sm text-emerald-700 underline-offset-2 hover:underline" href={item.foundUrl} rel="noreferrer" target="_blank">
                      {item.foundUrl}
                    </a>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm leading-6 text-slate-500">No matched map-pack listings were captured in this range.</p>
          )}
        </div>
      ) : null}
    </div>
  )
}

function MovementList({ emptyCopy, icon, items = [], title, tone = 'emerald' }) {
  return (
    <div className={cn(
      'rounded-[22px] border px-4 py-4',
      tone === 'rose' ? 'border-rose-200 bg-rose-50/60' : 'border-emerald-200 bg-emerald-50/60',
    )}>
      <div className="mb-3 flex items-center gap-2">
        {icon}
        <p className="text-sm font-semibold text-slate-950">{title}</p>
      </div>
      {items.length ? (
        <div className="grid gap-3">
          {items.map((item) => (
            <div key={`${title}-${item.keyword}`} className="rounded-[18px] border border-white/80 bg-white/80 px-4 py-3 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold text-slate-950">{item.keyword}</span>
                <span className={cn(
                  'text-sm font-semibold',
                  tone === 'rose' ? 'text-rose-700' : 'text-emerald-700',
                )}>
                  {item.delta > 0 ? `+${item.delta}` : item.delta}
                </span>
              </div>
              <p className="mt-2 text-sm text-slate-500">Now ranking #{item.position ?? 'n/a'}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm leading-6 text-slate-500">{emptyCopy}</p>
      )}
    </div>
  )
}

function FindingPanel({ item }) {
  return (
    <div className="rounded-[24px] border border-slate-200 bg-white/90 p-5 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={item.severity} />
            <span className="text-base font-semibold text-slate-950">{item.title}</span>
          </div>
          <p className="text-sm leading-6 text-slate-500">{item.message || 'No description available.'}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
          <span>{item.code}</span>
          <span>{item.urlCount} URLs</span>
        </div>
      </div>
      <div className="mt-4">
        <FindingBody item={item} />
      </div>
    </div>
  )
}

function FindingBody({ item }) {
  return (
    <div className="space-y-3">
      <div className="rounded-[18px] border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm leading-6 text-slate-600">
        <span className="font-semibold text-slate-950">Issue code:</span> {item.code}
      </div>
      <div className="report-findings-scroll max-h-72 overflow-y-auto rounded-[18px] border border-slate-200 bg-slate-50/80 p-3">
        <div className="grid gap-2">
          {(item.urls || []).map((url) => (
            <a
              key={url}
              className="rounded-[14px] border border-white/80 bg-white px-3 py-2 font-mono text-xs leading-6 text-emerald-700 underline-offset-2 transition-colors hover:border-emerald-200 hover:text-emerald-800 hover:underline"
              href={url}
              rel="noreferrer"
              target="_blank"
            >
              {url}
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}

function SeverityBadge({ severity = 'low' }) {
  const normalized = String(severity || 'low').toLowerCase()
  const variant = normalized === 'high' ? 'danger' : normalized === 'medium' ? 'warning' : 'default'
  return <Badge variant={variant}>{normalized}</Badge>
}

function InfoTile({ label, value }) {
  return (
    <div className="rounded-[22px] border border-slate-200 bg-white/90 px-4 py-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</p>
      <p className="mt-2 text-sm font-semibold text-slate-950">{value}</p>
    </div>
  )
}

function formatMetricDisplay(metric = {}) {
  if (metric.displayValue && metric.displayValue !== String(metric.value ?? '')) return metric.displayValue

  if (typeof metric.value === 'number' && Number.isFinite(metric.value)) {
    if (Number.isInteger(metric.value)) return metric.value.toLocaleString()
    return metric.value.toFixed(1)
  }

  return metric.displayValue || 'n/a'
}

function formatScore(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Math.round(numeric) : 'n/a'
}

function scoreTone(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 'subtle'
  if (numeric >= 90) return 'accent'
  if (numeric >= 70) return 'warning'
  return 'danger'
}

function formatDateTime(value) {
  if (!value) return 'n/a'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)

  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}
