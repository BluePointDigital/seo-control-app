import { useEffect, useState } from 'react'

import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { MetricCard, PageIntro, SectionHeading, StatusPill } from '../components/ui/surface'
import { apiRequest, buildApiPath } from '../lib/api'

export function PortfolioPage({ dateRange, onOpenWorkspace, onSetNotice }) {
  const [portfolio, setPortfolio] = useState({ items: [], summary: null, range: { label: dateRange.label } })
  const [alerts, setAlerts] = useState([])
  const rangeKey = JSON.stringify(dateRange.query)

  useEffect(() => {
    let cancelled = false

    Promise.all([
      apiRequest(buildApiPath('/api/org/portfolio', dateRange.query)),
      apiRequest('/api/org/alerts?status=open&limit=12'),
    ]).then(([portfolioJson, alertsJson]) => {
      if (cancelled) return
      setPortfolio(portfolioJson)
      setAlerts(alertsJson.items || [])
    }).catch((error) => onSetNotice(error.message))

    return () => {
      cancelled = true
    }
  }, [dateRange.query, onSetNotice, rangeKey])

  async function resolveAlert(alertId) {
    try {
      await apiRequest(`/api/org/alerts/${alertId}`, { method: 'PATCH', body: { status: 'resolved' } })
      const [alertsJson, portfolioJson] = await Promise.all([
        apiRequest('/api/org/alerts?status=open&limit=12'),
        apiRequest(buildApiPath('/api/org/portfolio', dateRange.query)),
      ])
      setAlerts(alertsJson.items || [])
      setPortfolio(portfolioJson)
    } catch (error) {
      onSetNotice(error.message)
    }
  }

  return (
    <div className="space-y-6">
      <PageIntro
        badge="Portfolio"
        title="Agency portfolio"
        description="Scan health, visibility, and alert pressure across every client workspace from one cleaner command surface."
        actions={<Badge variant="neutral">{portfolio.range?.label || dateRange.label}</Badge>}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_360px]">
        <Card>
          <CardHeader>
            <SectionHeading
              title="Workspace portfolio"
              description="Start here to see which client workspaces are healthy, stale, or ready for deeper review."
            />
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard label="Workspaces" value={portfolio.summary?.workspaceCount || 0} tone="accent" />
              <MetricCard label="Open alerts" value={portfolio.summary?.openAlertCount || 0} tone={(portfolio.summary?.openAlertCount || 0) ? 'warning' : 'subtle'} />
              <MetricCard label="Stale workspaces" value={portfolio.summary?.staleWorkspaces || 0} />
              <MetricCard label="Failing syncs" value={portfolio.summary?.failingWorkspaces || 0} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard label="Avg organic visibility" value={portfolio.summary?.avgRankVisibilityScore || 0} />
              <MetricCard label="Avg map visibility" value={portfolio.summary?.avgMapPackVisibilityScore || 0} />
              <MetricCard label="Workspaces in pack" value={portfolio.summary?.workspacesWithMapPackCoverage || 0} />
              <MetricCard label="Top 3 pack terms" value={portfolio.summary?.totalMapPackTop3Keywords || 0} />
            </div>

            <div className="grid gap-4">
              {(portfolio.items || []).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="grid gap-4 rounded-[24px] border border-slate-200 bg-slate-50/70 px-5 py-5 text-left transition-colors hover:border-slate-300 hover:bg-white"
                  onClick={() => onOpenWorkspace(item.slug, 'overview')}
                >
                  <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-lg font-semibold tracking-tight text-slate-950">{item.name}</p>
                        <StatusPill
                          tone={item.stale ? 'warning' : item.latestRankStatus === 'failed' ? 'danger' : 'success'}
                          value={item.stale ? 'Stale' : humanizeRankStatus(item.latestRankStatus)}
                        />
                      </div>
                      <p className="text-sm leading-6 text-slate-500">
                        {item.latestRankStatus === 'failed'
                          ? item.latestRankError || 'Rank sync failed.'
                          : `${item.trackedKeywords} tracked keywords, ${item.top10Keywords} organic top 10, ${item.mapPackTop3Keywords || 0} map pack top 3.`}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="neutral">{formatSchedule(item.schedule)}</Badge>
                      <Badge variant={(item.openAlertCount || 0) ? 'warning' : 'accent'}>{item.openAlertCount || 0} alerts</Badge>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <WorkspaceMetric label="Organic visibility" value={item.rankVisibilityScore || 0} />
                    <WorkspaceMetric label="Map visibility" value={item.mapPackVisibilityScore || 0} />
                    <WorkspaceMetric label="Tracked keywords" value={item.trackedKeywords || 0} />
                    <WorkspaceMetric label="Top 10 keywords" value={item.top10Keywords || 0} />
                  </div>
                </button>
              ))}

              {!portfolio.items?.length ? (
                <p className="rounded-[24px] border border-dashed border-slate-300 bg-slate-50/70 px-6 py-8 text-sm leading-6 text-slate-500">
                  No workspace portfolio data yet.
                </p>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Open alerts</CardTitle>
              <CardDescription>Rank movement and sync health that still need agency attention.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {alerts.map((alert) => (
                <div key={alert.id} className="rounded-[24px] border border-slate-200 bg-slate-50/70 p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="font-semibold text-slate-950">{alert.title}</p>
                    <Badge variant={severityVariant(alert.severity)}>{alert.severity}</Badge>
                  </div>
                  <p className="mt-2 text-sm text-slate-500">
                    {alert.workspaceName}
                    {alert.profileName ? ` / ${alert.profileName}` : ''}
                  </p>
                  <p className="mt-3 text-sm leading-6 text-slate-600">{alert.message}</p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <Button type="button" variant="secondary" size="sm" onClick={() => onOpenWorkspace(alert.workspaceSlug, 'rankings')}>
                      Open workspace
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => resolveAlert(alert.id)}>
                      Resolve
                    </Button>
                  </div>
                </div>
              ))}
              {!alerts.length ? <p className="text-sm text-slate-500">No open alerts right now.</p> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Portfolio signals</CardTitle>
              <CardDescription>Use these as a quick prioritization frame before diving into a client workspace.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <SignalRow
                label="Most urgent review"
                value={(portfolio.summary?.openAlertCount || 0) ? 'Alerted workspaces' : 'No urgent issues'}
              />
              <SignalRow
                label="Likely cleanup target"
                value={(portfolio.summary?.staleWorkspaces || 0) ? `${portfolio.summary?.staleWorkspaces || 0} stale workspaces` : 'All workspaces active'}
              />
              <SignalRow
                label="Coverage momentum"
                value={`${portfolio.summary?.workspacesWithMapPackCoverage || 0} workspaces in map pack`}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function WorkspaceMetric({ label, value }) {
  return (
    <div className="rounded-[20px] border border-slate-200 bg-white px-4 py-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</p>
      <p className="mt-3 text-lg font-semibold tracking-tight text-slate-950">{value}</p>
    </div>
  )
}

function SignalRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-[20px] border border-slate-200 bg-slate-50/70 px-4 py-3">
      <span className="text-sm text-slate-500">{label}</span>
      <span className="text-sm font-semibold text-slate-950">{value}</span>
    </div>
  )
}

function severityVariant(severity) {
  if (severity === 'high') return 'danger'
  if (severity === 'medium') return 'warning'
  return 'neutral'
}

function humanizeRankStatus(status) {
  const normalized = String(status || 'idle')
  if (normalized === 'completed') return 'Healthy'
  if (normalized === 'failed') return 'Failed'
  if (normalized === 'partial') return 'Partial'
  if (normalized === 'running') return 'Running'
  return 'Idle'
}

function formatSchedule(schedule) {
  if (!schedule) return 'Manual'
  if (schedule.frequency === 'manual') return 'Manual'
  if (schedule.frequency === 'daily') return `Daily @ ${padHour(schedule.hour)}`
  return `Weekly ${weekdayLabel(schedule.weekday)} @ ${padHour(schedule.hour)}`
}

function weekdayLabel(weekday) {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][Number(weekday) || 0]
}

function padHour(hour) {
  const normalized = Number(hour) || 0
  return `${String(normalized).padStart(2, '0')}:00`
}
