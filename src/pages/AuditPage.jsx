import { ArrowUpRight } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../components/ui/accordion'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { MetricCard, PageIntro, SectionHeading } from '../components/ui/surface'
import { apiRequest } from '../lib/api'
import { groupAuditIssues } from '../lib/audit.js'
import { useWorkspaceSetupModel } from '../lib/workspaceSetup'

const LIGHTHOUSE_STRATEGIES = [
  { id: 'mobile', label: 'Mobile', summaryLabel: 'Mobile Lighthouse' },
  { id: 'desktop', label: 'Desktop', summaryLabel: 'Desktop Lighthouse' },
]

export function AuditPage({ googleConnected, onOpenSetup, onSetNotice, onRefreshAuth, workspace }) {
  const [audit, setAudit] = useState(null)
  const [diff, setDiff] = useState(null)
  const [history, setHistory] = useState([])
  const [severityFilter, setSeverityFilter] = useState('all')

  const setupModel = useWorkspaceSetupModel({
    googleConnected,
    onRefreshAuth,
    onSetNotice,
    workspace,
  })

  useEffect(() => {
    let cancelled = false

    Promise.all([
      apiRequest(`/api/workspaces/${workspace.id}/audit/latest`),
      apiRequest(`/api/workspaces/${workspace.id}/audit/diff`),
      apiRequest(`/api/workspaces/${workspace.id}/audit/history`),
    ]).then(([auditJson, diffJson, historyJson]) => {
      if (cancelled) return
      setAudit(auditJson.item || null)
      setDiff(diffJson)
      setHistory(historyJson.items || [])
    }).catch((error) => onSetNotice(error.message))

    return () => {
      cancelled = true
    }
  }, [onSetNotice, workspace.id])

  const groupedIssues = useMemo(
    () => groupAuditIssues(audit?.issues || [], severityFilter),
    [audit?.issues, severityFilter],
  )

  const pageSpeed = audit?.details?.pageSpeed || {}
  const crawlSummary = audit?.details || {}
  const issueCounts = crawlSummary.issueCounts?.severity || { high: 0, medium: 0, low: 0 }
  const auditTarget = setupModel.setup.auditEntryUrl || (setupModel.setup.rankDomain ? `https://${setupModel.setup.rankDomain}` : '')
  const hasDetailedLighthouseData = LIGHTHOUSE_STRATEGIES.some((item) => {
    const strategyData = pageSpeed?.[item.id]
    return Boolean(
      strategyData?.metrics?.length ||
      strategyData?.opportunities?.length ||
      strategyData?.diagnostics?.length ||
      strategyData?.passedAudits?.length,
    )
  })

  return (
    <div className="space-y-6">
      <PageIntro
        badge="Site Audit"
        title="Technical review"
        description={audit ? `Latest crawl for ${audit.auditedUrl}` : 'Open workspace setup to define the crawl target, then run the first audit baseline.'}
        actions={<Button type="button" variant="secondary" onClick={onOpenSetup}>Open setup</Button>}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_360px]">
        <Card>
          <CardHeader>
            <SectionHeading
              title="Latest audit baseline"
              description={audit ? `Audited ${audit.auditedUrl}` : 'No audit baseline yet.'}
              action={audit ? <Badge variant="accent">{Math.round(audit.healthScore)} health</Badge> : null}
            />
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard label="Pages crawled" value={crawlSummary.pagesCrawled || 0} tone="accent" />
              <MetricCard label="Error pages" value={crawlSummary.errorPages || 0} />
              <MetricCard label="Timeouts" value={crawlSummary.timedOutPages || 0} />
              <MetricCard label="Duration" value={crawlSummary.durationMs ? `${Math.round(crawlSummary.durationMs / 1000)}s` : 'n/a'} />
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              {LIGHTHOUSE_STRATEGIES.map((strategy) => (
                <PageSpeedSummaryPanel key={strategy.id} label={strategy.summaryLabel} metrics={pageSpeed?.[strategy.id]} />
              ))}
            </div>

            <div className="rounded-[24px] border border-slate-200 bg-slate-50/70 p-5">
              <SectionHeading
                title="Detailed Lighthouse review"
                description="Use the space below the summary blocks to inspect the real Lighthouse detail, not just the headline scores."
                action={pageSpeed.error ? <Badge variant="warning">Partial PSI data</Badge> : null}
              />

              <Tabs className="mt-5" defaultValue="mobile">
                <TabsList>
                  {LIGHTHOUSE_STRATEGIES.map((strategy) => (
                    <TabsTrigger key={strategy.id} value={strategy.id}>{strategy.label}</TabsTrigger>
                  ))}
                </TabsList>

                {LIGHTHOUSE_STRATEGIES.map((strategy) => (
                  <TabsContent key={strategy.id} value={strategy.id}>
                    <LighthouseStrategyPanel
                      strategyLabel={strategy.label}
                      strategyData={pageSpeed?.[strategy.id]}
                      pageSpeedError={pageSpeed.error}
                      showNoDataState={!hasDetailedLighthouseData}
                    />
                  </TabsContent>
                ))}
              </Tabs>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Audit context</CardTitle>
              <CardDescription>Workspace defaults now live in Setup, but the audit details stay visible here.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <MetricCard label="Current target" value={auditTarget || 'Not configured'} tone="subtle" />
              <MetricCard label="Max pages" value={setupModel.setup.auditMaxPages || '25'} tone="subtle" />
              <MetricCard label="Last run" value={audit?.createdAt ? new Date(audit.createdAt).toLocaleString() : 'Never'} tone="subtle" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Audit changes</CardTitle>
              <CardDescription>Compare the latest crawl against the prior run.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3">
                <MetricCard label="Added" value={diff?.counts?.added || 0} />
                <MetricCard label="Resolved" value={diff?.counts?.resolved || 0} tone="accent" />
                <MetricCard label="Worsened" value={diff?.counts?.worsened || 0} tone="warning" />
              </div>
              <DiffList bucket="added" items={diff?.samples?.added || []} />
              <DiffList bucket="resolved" items={diff?.samples?.resolved || []} />
              <DiffList bucket="worsened" items={diff?.samples?.worsened || []} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent runs</CardTitle>
              <CardDescription>Keep an eye on trend direction without leaving the audit page.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {history.map((item) => (
                <div key={item.id} className="rounded-[22px] border border-slate-200 bg-slate-50/70 p-4">
                  <p className="text-sm text-slate-500">{new Date(item.createdAt).toLocaleString()}</p>
                  <p className="mt-2 text-lg font-semibold text-slate-950">{Math.round(item.healthScore)} health</p>
                  <p className="mt-1 text-sm text-slate-500">{item.pagesCrawled} pages, {item.issuesCount} issues</p>
                </div>
              ))}
              {!history.length ? <p className="text-sm text-slate-500">No prior audit runs yet.</p> : null}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <SectionHeading
            title="Grouped findings"
            description="Expand any issue to review every affected URL, with each URL clickable and no display-side clipping."
            action={(
              <div className="flex flex-wrap gap-2">
                {['all', 'high', 'medium', 'low'].map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] ${
                      severityFilter === value
                        ? 'border-slate-950 bg-slate-950 text-white'
                        : 'border-slate-200 bg-slate-50 text-slate-500'
                    }`}
                    onClick={() => setSeverityFilter(value)}
                  >
                    {value}
                  </button>
                ))}
              </div>
            )}
          />
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <MetricCard label="High" value={issueCounts.high || 0} tone="warning" />
            <MetricCard label="Medium" value={issueCounts.medium || 0} />
            <MetricCard label="Low" value={issueCounts.low || 0} tone="subtle" />
          </div>

          {groupedIssues.length ? (
            <Accordion type="multiple" className="space-y-3">
              {groupedIssues.map((issue) => (
                <AccordionItem key={`${issue.code}-${issue.severity}`} value={`${issue.code}-${issue.severity}`}>
                  <AccordionTrigger className="px-5 py-4">
                    <div className="flex flex-col gap-2 text-left">
                      <div className="flex items-center gap-3">
                        <Badge variant={issue.severity === 'high' ? 'danger' : issue.severity === 'medium' ? 'warning' : 'neutral'}>
                          {issue.severity}
                        </Badge>
                        <span className="text-sm font-semibold text-slate-950">{issue.code}</span>
                        <span className="text-xs uppercase tracking-[0.12em] text-slate-400">{issue.urls.length} URLs</span>
                      </div>
                      <p className="text-sm font-normal leading-6 text-slate-500">{issue.message}</p>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="px-5 pb-5">
                    <div className="rounded-[20px] border border-slate-200 bg-slate-50/70 p-4">
                      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                        Showing {issue.urls.length} affected URL{issue.urls.length === 1 ? '' : 's'}
                      </p>
                      <div className="grid max-h-[360px] gap-2 overflow-y-auto pr-2">
                        {issue.urls.map((url) => (
                          <a
                            key={url}
                            className="rounded-2xl border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-emerald-700 transition-colors hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-800"
                            href={url}
                            rel="noreferrer"
                            target="_blank"
                          >
                            {url}
                          </a>
                        ))}
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          ) : (
            <p className="text-sm text-slate-500">No audit findings match this filter.</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function PageSpeedSummaryPanel({ label, metrics }) {
  return (
    <div className="rounded-[24px] border border-slate-200 bg-slate-50/70 p-5">
      <p className="text-lg font-semibold text-slate-950">{label}</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <MetricCard label="Performance" value={metrics?.performance ?? 'n/a'} />
        <MetricCard label="SEO" value={metrics?.seo ?? 'n/a'} tone="accent" />
        <MetricCard label="Accessibility" value={metrics?.accessibility ?? 'n/a'} />
        <MetricCard label="Best practices" value={metrics?.bestPractices ?? 'n/a'} />
      </div>
    </div>
  )
}

function LighthouseStrategyPanel({ pageSpeedError, showNoDataState, strategyData, strategyLabel }) {
  if (!strategyData && pageSpeedError) {
    return (
      <div className="mt-5 rounded-[22px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-700">
        {pageSpeedError}
      </div>
    )
  }

  if (!strategyData && showNoDataState) {
    return <p className="mt-5 text-sm text-slate-500">No Lighthouse detail has been captured for {strategyLabel.toLowerCase()} yet.</p>
  }

  return (
    <div className="mt-5 space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-lg font-semibold tracking-tight text-slate-950">{strategyLabel} report</p>
          <p className="text-sm text-slate-500">Categories, core metrics, opportunities, diagnostics, and passed audits.</p>
        </div>
        {strategyData?.reportUrl ? (
          <a
            className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50"
            href={strategyData.reportUrl}
            rel="noreferrer"
            target="_blank"
          >
            Open in PageSpeed
            <ArrowUpRight className="h-4 w-4" />
          </a>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Performance" value={strategyData?.performance ?? 'n/a'} />
        <MetricCard label="SEO" value={strategyData?.seo ?? 'n/a'} tone="accent" />
        <MetricCard label="Accessibility" value={strategyData?.accessibility ?? 'n/a'} />
        <MetricCard label="Best practices" value={strategyData?.bestPractices ?? 'n/a'} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {(strategyData?.metrics || []).map((item) => (
          <MetricCard key={`${strategyLabel}-${item.id}`} label={item.title} value={formatMetricValue(item)} tone="subtle" />
        ))}
      </div>

      <Accordion type="multiple" className="space-y-3">
        <LighthouseAuditList
          value={`${strategyLabel}-opportunities`}
          title="Opportunities"
          description="Performance opportunities sorted by estimated savings."
          items={strategyData?.opportunities || []}
          emptyMessage="No opportunity audits returned."
          renderItem={(item) => (
            <LighthouseAuditCard
              description={item.description}
              displayValue={item.displayValue}
              meta={formatSavings(item)}
              score={item.score}
              title={item.title}
            />
          )}
        />
        <LighthouseAuditList
          value={`${strategyLabel}-diagnostics`}
          title="Diagnostics / failing checks"
          description="All non-passing non-opportunity audits in this strategy."
          items={strategyData?.diagnostics || []}
          emptyMessage="No failing diagnostics."
          renderItem={(item) => (
            <LighthouseAuditCard
              description={item.description}
              displayValue={item.displayValue}
              score={item.score}
              title={item.title}
            />
          )}
        />
        <LighthouseAuditList
          value={`${strategyLabel}-passed`}
          title="Passed audits"
          description="Completed checks so the report feels complete instead of summary-only."
          items={strategyData?.passedAudits || []}
          emptyMessage="No passed audits captured."
          renderItem={(item) => (
            <LighthouseAuditCard
              description={item.description}
              title={item.title}
            />
          )}
        />
      </Accordion>
    </div>
  )
}

function LighthouseAuditList({ description, emptyMessage, items, renderItem, title, value }) {
  return (
    <AccordionItem value={value}>
      <AccordionTrigger>
        <div className="flex flex-col gap-1 text-left">
          <span>{title}</span>
          <span className="text-xs font-normal uppercase tracking-[0.12em] text-slate-400">{items.length} items</span>
        </div>
      </AccordionTrigger>
      <AccordionContent className="px-5 pb-5">
        <p className="mb-4 text-sm text-slate-500">{description}</p>
        {items.length ? (
          <div className="grid max-h-[360px] gap-3 overflow-y-auto pr-2">
            {items.map((item) => (
              <div key={`${value}-${item.id}`} className="rounded-[20px] border border-slate-200 bg-slate-50/70 p-4">
                {renderItem(item)}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">{emptyMessage}</p>
        )}
      </AccordionContent>
    </AccordionItem>
  )
}

function LighthouseAuditCard({ description, displayValue, meta, score, title }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <p className="font-semibold text-slate-950">{title}</p>
        <div className="flex flex-wrap gap-2">
          {typeof score === 'number' ? <Badge variant={score >= 0.9 ? 'accent' : score >= 0.5 ? 'warning' : 'danger'}>{score}</Badge> : null}
          {displayValue ? <Badge variant="neutral">{displayValue}</Badge> : null}
          {meta ? <Badge variant="neutral">{meta}</Badge> : null}
        </div>
      </div>
      {description ? <p className="text-sm leading-6 text-slate-500">{description}</p> : null}
    </div>
  )
}

function DiffList({ bucket, items }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">{bucket}</p>
      {items.length ? items.map((item, index) => (
        <div key={`${bucket}-${index}`} className="rounded-[20px] border border-slate-200 bg-slate-50/70 px-4 py-3 text-sm text-slate-600">
          {item.code} - {item.url || item.message}
        </div>
      )) : <p className="text-sm text-slate-500">No {bucket} samples.</p>}
    </div>
  )
}

function formatMetricValue(item) {
  if (item?.displayValue) return item.displayValue
  if (typeof item?.value !== 'number') return 'n/a'
  if (item.unit === 'ms') return `${Math.round(item.value)} ms`
  if (item.unit === 's') return `${Number(item.value).toFixed(2)} s`
  if (item.unit === 'bytes') return `${Math.round(item.value).toLocaleString()} bytes`
  if (item.unit === 'unitless') return Number(item.value).toFixed(2)
  return `${Number(item.value).toFixed(2)} ${item.unit || ''}`.trim()
}

function formatSavings(item) {
  const labels = []
  if (typeof item?.savingsMs === 'number') labels.push(`~${Math.round(item.savingsMs)} ms saved`)
  if (typeof item?.savingsBytes === 'number') labels.push(`~${Math.round(item.savingsBytes).toLocaleString()} bytes`)
  return labels.join(' / ')
}
