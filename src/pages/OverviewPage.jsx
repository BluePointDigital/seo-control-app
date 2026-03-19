import { useEffect, useState } from 'react'

import { LineChart } from '../components/LineChart'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { FocusCard, MetricCard, PageIntro, SectionHeading, StatusPill } from '../components/ui/surface'
import { apiRequest, buildApiPath } from '../lib/api'
import { useWorkspaceSetupModel } from '../lib/workspaceSetup'

const EMPTY_RANK_INSIGHTS = {
  visibilityScore: 0,
  moversUp: [],
  moversDown: [],
  latestDate: null,
  narrative: 'No rank baseline yet.',
  trackedKeywords: 0,
  rankedKeywords: 0,
  top10Keywords: 0,
  top3Keywords: 0,
  top1Keywords: 0,
}

function createEmptyRankSummary(label) {
  return {
    items: [],
    insights: { ...EMPTY_RANK_INSIGHTS },
    range: { label },
    mapPack: {
      items: [],
      insights: { ...EMPTY_RANK_INSIGHTS, narrative: 'No map pack baseline yet.' },
      range: { label },
    },
  }
}

function normalizeRankSummary(summary, label) {
  const organic = summary || {}
  const mapPack = organic.mapPack || {}
  return {
    ...createEmptyRankSummary(label),
    ...organic,
    insights: { ...EMPTY_RANK_INSIGHTS, ...(organic.insights || {}) },
    range: { label, ...(organic.range || {}) },
    mapPack: {
      ...createEmptyRankSummary(label).mapPack,
      ...mapPack,
      insights: { ...EMPTY_RANK_INSIGHTS, narrative: 'No map pack baseline yet.', ...(mapPack.insights || {}) },
      range: { label, ...(mapPack.range || {}) },
    },
  }
}

export function OverviewPage({
  dateRange,
  googleConnected,
  onOpenOrganizationSettings,
  onOpenReports,
  onOpenSetup,
  onSetNotice,
  onRefreshAuth,
  workspace,
}) {
  const [summary, setSummary] = useState(null)
  const [rankSummary, setRankSummary] = useState(() => createEmptyRankSummary(dateRange.label))
  const [alerts, setAlerts] = useState([])
  const [jobs, setJobs] = useState([])
  const rangeKey = JSON.stringify(dateRange.query)

  const setupModel = useWorkspaceSetupModel({
    googleConnected,
    onRefreshAuth,
    onSetNotice,
    workspace,
  })

  useEffect(() => {
    let cancelled = false

    async function load() {
      const [summaryJson, rankJson, alertsJson, jobsJson] = await Promise.all([
        apiRequest(buildApiPath(`/api/workspaces/${workspace.id}/summary`, dateRange.query)),
        apiRequest(buildApiPath(`/api/workspaces/${workspace.id}/rank/summary`, dateRange.query)),
        apiRequest(`/api/workspaces/${workspace.id}/alerts?status=open&limit=4`),
        apiRequest(`/api/workspaces/${workspace.id}/jobs`),
      ])

      if (cancelled) return

      setSummary(summaryJson)
      setRankSummary(normalizeRankSummary(rankJson, dateRange.label))
      setAlerts(alertsJson.items || [])
      setJobs(jobsJson.items || [])
    }

    load().catch((error) => onSetNotice(error.message))
    return () => {
      cancelled = true
    }
  }, [dateRange.label, dateRange.query, onSetNotice, rangeKey, workspace.id])

  const latestJob = jobs[0] || null
  const setupSummary = setupModel.summary
  const organicInsights = rankSummary.insights || EMPTY_RANK_INSIGHTS
  const mapPackInsights = rankSummary.mapPack?.insights || EMPTY_RANK_INSIGHTS
  const summaryLabel = summary?.range?.label || dateRange.label

  function handlePrimaryAction() {
    if (setupSummary.focus.action === 'Open organization settings') {
      onOpenOrganizationSettings()
      return
    }
    onOpenSetup()
  }

  return (
    <div className="space-y-6">
      <PageIntro
        badge="Overview"
        title={workspace.name}
        description="Track readiness, workspace health, and cross-channel performance without leaving the client workspace."
        actions={(
          <>
            <Button type="button" variant="accent" onClick={handlePrimaryAction}>{setupSummary.focus.action}</Button>
            <Button type="button" variant="secondary" onClick={onOpenReports}>Open reports</Button>
          </>
        )}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_360px]">
        <Card>
          <CardHeader>
            <SectionHeading
              title="Workspace snapshot"
              description={setupSummary.focus.description}
              action={<Badge variant="accent">{setupSummary.readinessScore}% ready</Badge>}
            />
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard label="Checklist" value={`${setupSummary.steps.filter((step) => step.done).length}/${setupSummary.steps.length}`} tone="accent" />
              <MetricCard label="Tracked keywords" value={workspace.keywordCount || 0} />
              <MetricCard label="Open alerts" value={alerts.length} tone={alerts.length ? 'warning' : 'subtle'} />
              <MetricCard label="Latest activity" value={latestJob ? humanizeJob(latestJob.jobType) : 'No jobs'} />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-[24px] border border-slate-200 bg-slate-50/70 p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Source readiness</p>
                <div className="mt-4 grid gap-3">
                  <SourceRow label="Search Console" ready={Boolean(setupModel.setup.gscSiteUrl)} />
                  <SourceRow label="GA4" ready={Boolean(setupModel.setup.ga4PropertyId)} />
                  <SourceRow label="Google Ads" ready={Boolean(setupModel.setup.googleAdsCustomerId)} />
                  <SourceRow label="Rank domain" ready={Boolean(setupModel.setup.rankDomain)} />
                </div>
              </div>
              <div className="rounded-[24px] border border-slate-200 bg-slate-50/70 p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Recent activity</p>
                <div className="mt-4 space-y-3">
                  {jobs.slice(0, 4).map((job) => (
                    <div key={job.id} className="flex items-center justify-between gap-3 rounded-[20px] border border-slate-200 bg-white px-4 py-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-950">{humanizeJob(job.jobType)}</p>
                        <p className="text-xs text-slate-400">{formatDateTime(job.updatedAt || job.createdAt)}</p>
                      </div>
                      <StatusPill tone={jobTone(job.status)} value={job.status} />
                    </div>
                  ))}
                  {!jobs.length ? <p className="text-sm text-slate-500">No jobs have run yet.</p> : null}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <FocusCard
            title={setupSummary.focus.title}
            description={setupSummary.focus.description}
            actionLabel={setupSummary.focus.action}
            onAction={handlePrimaryAction}
          />

          <Card>
            <CardHeader>
              <CardTitle>Attention queue</CardTitle>
              <CardDescription>Issues that still need action inside this workspace.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {alerts.map((alert) => (
                <div key={alert.id} className="rounded-[22px] border border-slate-200 bg-slate-50/70 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-slate-950">{alert.title}</p>
                      <p className="mt-1 text-sm leading-6 text-slate-500">{alert.message}</p>
                    </div>
                    <Badge variant={alert.severity === 'high' ? 'danger' : alert.severity === 'medium' ? 'warning' : 'neutral'}>
                      {alert.severity}
                    </Badge>
                  </div>
                </div>
              ))}
              {!alerts.length ? <p className="text-sm text-slate-500">No open workspace alerts.</p> : null}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <SectionHeading
            title="Performance snapshot"
            description="Cross-channel client reporting across organic, analytics, paid data, and rank movement."
            action={<Badge variant="neutral">{summaryLabel}</Badge>}
          />
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Search clicks" value={summary?.gsc?.clicks || 0} tone="accent" />
            <MetricCard label="Sessions" value={summary?.ga4?.sessions || 0} />
            <MetricCard label="Conversions" value={summary?.ga4?.conversions || 0} />
            <MetricCard label="Paid spend" value={`$${Number(summary?.ads?.cost || 0).toFixed(2)}`} tone="warning" />
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <ChartBlock
              title="Search visibility"
              subtitle={summary?.gsc?.points?.length ? summaryLabel : 'Waiting for sync'}
              rows={summary?.gsc?.points || []}
              series={[
                { key: 'clicks', label: 'Clicks', color: '#0f766e' },
                { key: 'impressions', label: 'Impressions', color: '#1d4ed8' },
              ]}
            />
            <ChartBlock
              title="Engagement"
              subtitle={summaryLabel}
              rows={summary?.ga4?.points || []}
              series={[
                { key: 'sessions', label: 'Sessions', color: '#b45309' },
                { key: 'conversions', label: 'Conversions', color: '#059669' },
              ]}
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <RankSnapshotPanel
          title="Organic rankings"
          subtitle={organicInsights.narrative || 'No organic movement captured yet.'}
          latestDate={organicInsights.latestDate}
          metrics={[
            { label: 'Visibility score', value: organicInsights.visibilityScore || 0 },
            { label: 'Ranked keywords', value: organicInsights.rankedKeywords || 0 },
            { label: 'Top 10 keywords', value: organicInsights.top10Keywords || 0 },
            { label: 'Tracked keywords', value: organicInsights.trackedKeywords || 0 },
          ]}
          moversUp={organicInsights.moversUp || []}
          moversDown={organicInsights.moversDown || []}
        />
        <RankSnapshotPanel
          title="Map pack"
          subtitle={mapPackInsights.narrative || 'No map-pack movement captured yet.'}
          latestDate={mapPackInsights.latestDate}
          metrics={[
            { label: 'Map visibility', value: mapPackInsights.visibilityScore || 0 },
            { label: 'Ranked in pack', value: mapPackInsights.rankedKeywords || 0 },
            { label: 'Top 3 pack', value: mapPackInsights.top3Keywords || 0 },
            { label: 'Tracked keywords', value: mapPackInsights.trackedKeywords || 0 },
          ]}
          moversUp={mapPackInsights.moversUp || []}
          moversDown={mapPackInsights.moversDown || []}
        />
      </div>
    </div>
  )
}

function ChartBlock({ rows, series, subtitle, title }) {
  return (
    <div className="space-y-4 rounded-[24px] border border-slate-200 bg-slate-50/70 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-slate-950">{title}</p>
          <p className="text-sm text-slate-500">{subtitle}</p>
        </div>
      </div>
      <LineChart rows={rows} series={series} />
    </div>
  )
}

function RankSnapshotPanel({ latestDate, metrics, moversDown, moversUp, subtitle, title }) {
  return (
    <Card>
      <CardHeader>
        <SectionHeading
          title={title}
          description={subtitle}
          action={<Badge variant="neutral">{latestDate ? `Latest ${latestDate}` : 'Waiting for sync'}</Badge>}
        />
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          {metrics.map((metric) => <MetricCard key={`${title}-${metric.label}`} label={metric.label} value={metric.value} />)}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <MovementList title="Top winners" items={moversUp} />
          <MovementList title="Top decliners" items={moversDown} />
        </div>
      </CardContent>
    </Card>
  )
}

function MovementList({ items, title }) {
  return (
    <div className="rounded-[24px] border border-slate-200 bg-slate-50/70 p-5">
      <p className="font-semibold text-slate-950">{title}</p>
      <div className="mt-4 space-y-3">
        {items.length ? items.map((item) => (
          <div key={`${title}-${item.keyword}`} className="flex items-center justify-between gap-3 rounded-[20px] border border-slate-200 bg-white px-4 py-3">
            <span className="text-sm text-slate-600">{item.keyword}</span>
            <span className="text-sm font-semibold text-slate-950">{item.delta > 0 ? `+${item.delta}` : item.delta}</span>
          </div>
        )) : <p className="text-sm text-slate-500">No movement recorded.</p>}
      </div>
    </div>
  )
}

function SourceRow({ label, ready }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[20px] border border-slate-200 bg-white px-4 py-3">
      <span className="text-sm text-slate-600">{label}</span>
      <StatusPill tone={ready ? 'success' : 'warning'} value={ready ? 'Ready' : 'Pending'} />
    </div>
  )
}

function humanizeJob(jobType) {
  return String(jobType || 'job').replace(/_/g, ' ')
}

function jobTone(status) {
  const normalized = String(status || '').toLowerCase()
  if (normalized === 'completed') return 'success'
  if (normalized === 'failed') return 'danger'
  if (normalized === 'running') return 'warning'
  return 'default'
}

function formatDateTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}
