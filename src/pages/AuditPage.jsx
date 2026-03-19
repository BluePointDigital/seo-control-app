import { useEffect, useMemo, useState } from 'react'

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../components/ui/accordion'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { ScrollArea } from '../components/ui/scroll-area'
import { MetricCard, PageIntro, SectionHeading } from '../components/ui/surface'
import { apiRequest } from '../lib/api'
import { useWorkspaceSetupModel } from '../lib/workspaceSetup'

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

  const groupedIssues = useMemo(() => {
    const map = new Map()
    for (const issue of audit?.issues || []) {
      const key = `${issue.code}|${issue.severity}`
      const current = map.get(key) || { ...issue, urls: [] }
      if (issue.url && !current.urls.includes(issue.url)) current.urls.push(issue.url)
      map.set(key, current)
    }
    return [...map.values()]
      .filter((issue) => severityFilter === 'all' || issue.severity === severityFilter)
      .sort((left, right) => right.urls.length - left.urls.length || left.code.localeCompare(right.code))
  }, [audit, severityFilter])

  const pageSpeed = audit?.details?.pageSpeed || {}
  const crawlSummary = audit?.details || {}
  const issueCounts = crawlSummary.issueCounts?.severity || { high: 0, medium: 0, low: 0 }
  const auditTarget = setupModel.setup.auditEntryUrl || (setupModel.setup.rankDomain ? `https://${setupModel.setup.rankDomain}` : '')

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
              <PageSpeedPanel label="Mobile Lighthouse" metrics={pageSpeed.mobile} />
              <PageSpeedPanel label="Desktop Lighthouse" metrics={pageSpeed.desktop} />
            </div>
            {pageSpeed.error ? (
              <div className="rounded-[22px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-700">
                {pageSpeed.error}
              </div>
            ) : null}
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
            description="Expand any issue to review every affected URL, not just a preview list."
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
                    <ScrollArea className="max-h-56 rounded-[20px] border border-slate-200 bg-slate-50/70">
                      <div className="grid gap-2 p-4">
                        {issue.urls.map((url) => (
                          <code key={url} className="rounded-2xl bg-white px-3 py-2 text-xs text-slate-700">
                            {url}
                          </code>
                        ))}
                      </div>
                    </ScrollArea>
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

function PageSpeedPanel({ label, metrics }) {
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
