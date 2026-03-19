import { useEffect, useState } from 'react'

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
      const alertsJson = await apiRequest('/api/org/alerts?status=open&limit=12')
      setAlerts(alertsJson.items || [])
      const portfolioJson = await apiRequest(buildApiPath('/api/org/portfolio', dateRange.query))
      setPortfolio(portfolioJson)
    } catch (error) {
      onSetNotice(error.message)
    }
  }

  return (
    <section className="page-grid">
      <article className="panel span-8">
        <div className="panel-head">
          <h2>Agency portfolio</h2>
          <p>{portfolio.range?.label || dateRange.label}</p>
        </div>
        <div className="kpi-row compact">
          <MetricTile label="Workspaces" value={portfolio.summary?.workspaceCount || 0} />
          <MetricTile label="Open alerts" value={portfolio.summary?.openAlertCount || 0} />
          <MetricTile label="Stale workspaces" value={portfolio.summary?.staleWorkspaces || 0} />
          <MetricTile label="Failing syncs" value={portfolio.summary?.failingWorkspaces || 0} />
        </div>
        <div className="kpi-row compact">
          <MetricTile label="Avg organic visibility" value={portfolio.summary?.avgRankVisibilityScore || 0} />
          <MetricTile label="Avg map visibility" value={portfolio.summary?.avgMapPackVisibilityScore || 0} />
          <MetricTile label="Workspaces in pack" value={portfolio.summary?.workspacesWithMapPackCoverage || 0} />
          <MetricTile label="Top 3 pack terms" value={portfolio.summary?.totalMapPackTop3Keywords || 0} />
        </div>
        <div className="list-table mt">
          {(portfolio.items || []).map((item) => (
            <button key={item.id} type="button" className="report-row portfolio-row" onClick={() => onOpenWorkspace(item.slug, 'overview')}>
              <div className="portfolio-row-main">
                <strong>{item.name}</strong>
                <span className="muted-copy">
                  {item.latestRankStatus === 'failed'
                    ? item.latestRankError || 'Rank sync failed.'
                    : `${item.trackedKeywords} tracked keywords, ${item.top10Keywords} organic top 10, ${item.mapPackTop3Keywords || 0} map pack top 3`}
                </span>
              </div>
              <div className="portfolio-row-meta">
                <span className={`status-pill ${item.stale ? 'status-stale' : 'status-ok'}`}>{item.stale ? 'Stale' : item.latestRankStatus}</span>
                <span>{item.openAlertCount} alerts</span>
                <span>Organic {item.rankVisibilityScore || 0}</span>
                <span>Map {item.mapPackVisibilityScore || 0}</span>
                <span>{formatSchedule(item.schedule)}</span>
              </div>
            </button>
          ))}
          {!portfolio.items?.length ? <p className="muted-copy">No workspace portfolio data yet.</p> : null}
        </div>
      </article>

      <aside className="panel span-4">
        <div className="panel-head">
          <h2>Open alerts</h2>
          <p>Rank movement and sync health that need agency attention.</p>
        </div>
        <div className="stack tight">
          {alerts.map((alert) => (
            <div key={alert.id} className="alert-card">
              <div className="spread">
                <strong>{alert.title}</strong>
                <span className={`severity-pill severity-${alert.severity}`}>{alert.severity}</span>
              </div>
              <p className="muted-copy">{alert.workspaceName}{alert.profileName ? ` / ${alert.profileName}` : ''}</p>
              <p>{alert.message}</p>
              <div className="row-actions">
                <button type="button" className="secondary small" onClick={() => onOpenWorkspace(alert.workspaceSlug, 'rankings')}>Open workspace</button>
                <button type="button" className="secondary small" onClick={() => resolveAlert(alert.id)}>Resolve</button>
              </div>
            </div>
          ))}
          {!alerts.length ? <p className="muted-copy">No open alerts right now.</p> : null}
        </div>
      </aside>
    </section>
  )
}

function MetricTile({ label, value }) {
  return <div className="metric-tile"><span>{label}</span><strong>{value}</strong></div>
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
