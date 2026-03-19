import { useEffect, useMemo, useState } from 'react'

import { LineChart } from '../components/LineChart'
import { WorkspaceHero } from '../components/WorkspaceHero'
import { apiRequest, buildApiPath } from '../lib/api'
import { getOnboardingSteps, getReadinessFocus, getReadinessScore } from '../lib/workspace'

const EMPTY_ASSET_RESULT = { items: [], availability: { state: 'ready', message: '' } }
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
  onSetNotice,
  onRefreshAuth,
  workspace,
}) {
  const [summary, setSummary] = useState(null)
  const [rankSummary, setRankSummary] = useState(() => createEmptyRankSummary(dateRange.label))
  const [alerts, setAlerts] = useState([])
  const [jobs, setJobs] = useState([])
  const [settings, setSettings] = useState({
    gscSiteUrl: '',
    ga4PropertyId: '',
    googleAdsCustomerId: '',
    rankDomain: '',
  })
  const [assets, setAssets] = useState({
    gscSites: EMPTY_ASSET_RESULT,
    ga4Properties: EMPTY_ASSET_RESULT,
    adsCustomers: EMPTY_ASSET_RESULT,
  })
  const [saving, setSaving] = useState(false)
  const [runningSync, setRunningSync] = useState(false)
  const rangeKey = JSON.stringify(dateRange.query)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const [summaryJson, rankJson, alertsJson, jobsJson, settingsJson] = await Promise.all([
        apiRequest(buildApiPath(`/api/workspaces/${workspace.id}/summary`, dateRange.query)),
        apiRequest(buildApiPath(`/api/workspaces/${workspace.id}/rank/summary`, dateRange.query)),
        apiRequest(`/api/workspaces/${workspace.id}/alerts?status=open&limit=5`),
        apiRequest(`/api/workspaces/${workspace.id}/jobs`),
        apiRequest(`/api/workspaces/${workspace.id}/settings`),
      ])

      if (cancelled) return
      setSummary(summaryJson)
      setRankSummary(normalizeRankSummary(rankJson, dateRange.label))
      setAlerts(alertsJson.items || [])
      setJobs(jobsJson.items || [])
      setSettings({
        gscSiteUrl: settingsJson.gsc_site_url || '',
        ga4PropertyId: settingsJson.ga4_property_id || '',
        googleAdsCustomerId: settingsJson.google_ads_customer_id || '',
        rankDomain: settingsJson.rank_domain || '',
      })
    }

    load().catch((error) => onSetNotice(error.message))
    return () => { cancelled = true }
  }, [dateRange.label, dateRange.query, onSetNotice, rangeKey, workspace.id])

  useEffect(() => {
    if (!googleConnected) {
      setAssets({
        gscSites: { items: [], availability: { state: 'missing_google_connection', message: 'Connect Google to load shared assets.' } },
        ga4Properties: { items: [], availability: { state: 'missing_google_connection', message: 'Connect Google to load shared assets.' } },
        adsCustomers: { items: [], availability: { state: 'missing_google_connection', message: 'Connect Google to load shared assets.' } },
      })
      return
    }

    let cancelled = false
    Promise.all([
      apiRequest('/api/org/google/assets/gsc-sites'),
      apiRequest('/api/org/google/assets/ga4-properties'),
      apiRequest('/api/org/google/assets/ads-customers'),
    ]).then(([gscSites, ga4Properties, adsCustomers]) => {
      if (cancelled) return
      setAssets({ gscSites, ga4Properties, adsCustomers })
    }).catch((error) => onSetNotice(error.message))

    return () => { cancelled = true }
  }, [googleConnected, onSetNotice])

  const steps = useMemo(() => getOnboardingSteps({
    googleConnected,
    workspaceSettings: {
      gsc_site_url: settings.gscSiteUrl,
      ga4_property_id: settings.ga4PropertyId,
      google_ads_customer_id: settings.googleAdsCustomerId,
      rank_domain: settings.rankDomain,
    },
    keywordCount: workspace.keywordCount,
    competitorCount: workspace.competitorCount,
  }), [googleConnected, settings.ga4PropertyId, settings.googleAdsCustomerId, settings.gscSiteUrl, settings.rankDomain, workspace.competitorCount, workspace.keywordCount])

  const readinessScore = getReadinessScore(steps)
  const focus = getReadinessFocus(steps)
  const latestJob = jobs[0] || null
  const summaryLabel = summary?.range?.label || dateRange.label
  const organicInsights = rankSummary.insights || EMPTY_RANK_INSIGHTS
  const mapPackInsights = rankSummary.mapPack?.insights || EMPTY_RANK_INSIGHTS

  async function reloadWorkspacePanels() {
    const [rankJson, alertsJson, jobsJson] = await Promise.all([
      apiRequest(buildApiPath(`/api/workspaces/${workspace.id}/rank/summary`, dateRange.query)),
      apiRequest(`/api/workspaces/${workspace.id}/alerts?status=open&limit=5`),
      apiRequest(`/api/workspaces/${workspace.id}/jobs`),
    ])
    setRankSummary(normalizeRankSummary(rankJson, dateRange.label))
    setAlerts(alertsJson.items || [])
    setJobs(jobsJson.items || [])
  }

  async function saveSettings(event) {
    event.preventDefault()
    setSaving(true)
    try {
      await apiRequest(`/api/workspaces/${workspace.id}/settings`, {
        method: 'PATCH',
        body: settings,
      })
      onSetNotice('Workspace configuration updated.')
      await onRefreshAuth()
    } catch (error) {
      onSetNotice(error.message)
    } finally {
      setSaving(false)
    }
  }

  async function runSync(source = 'all') {
    setRunningSync(true)
    try {
      await apiRequest(`/api/workspaces/${workspace.id}/jobs/run-sync`, {
        method: 'POST',
        body: { source },
      })
      onSetNotice(source === 'all' ? 'Full workspace sync finished.' : `${source.toUpperCase()} sync finished.`)
      await reloadWorkspacePanels()
    } catch (error) {
      onSetNotice(error.message)
    } finally {
      setRunningSync(false)
    }
  }

  function handlePrimaryAction() {
    if (focus.action === 'Run full sync') {
      runSync('all')
      return
    }
    if (focus.action === 'Open organization settings') {
      onOpenOrganizationSettings()
      return
    }
    document.getElementById('workspace-config')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="page-stack">
      <WorkspaceHero
        workspace={workspace}
        steps={steps}
        stepCount={steps.length}
        readinessScore={readinessScore}
        focus={focus}
        latestJob={latestJob}
        onPrimaryAction={handlePrimaryAction}
        onSecondaryAction={onOpenReports}
      />

      <section className="page-grid">
        <article className="panel span-8">
          <div className="panel-head">
            <h2>Performance snapshot</h2>
            <p>Cross-channel client reporting across organic, analytics, paid data, and rank movement.</p>
          </div>
          <div className="kpi-row compact">
            <StatCard label="Search clicks" value={summary?.gsc?.clicks || 0} accent="accent-cyan" />
            <StatCard label="Sessions" value={summary?.ga4?.sessions || 0} accent="accent-gold" />
            <StatCard label="Conversions" value={summary?.ga4?.conversions || 0} accent="accent-emerald" />
            <StatCard label="Paid spend" value={`$${Number(summary?.ads?.cost || 0).toFixed(2)}`} accent="accent-coral" />
          </div>
          <div className="kpi-row compact mt overview-rank-strip">
            <MetricTile label="Organic visibility" value={organicInsights.visibilityScore || 0} />
            <MetricTile label="Map visibility" value={mapPackInsights.visibilityScore || 0} />
            <MetricTile label="Tracked keywords" value={organicInsights.trackedKeywords || 0} />
            <MetricTile label="Open alerts" value={alerts.length} />
          </div>
          <div className="stack">
            <div>
              <div className="chart-header"><strong>Search visibility</strong><span>{summary?.gsc?.points?.length ? summaryLabel : 'Waiting for sync'}</span></div>
              <LineChart rows={summary?.gsc?.points || []} series={[{ key: 'clicks', label: 'Clicks', color: '#0f766e' }, { key: 'impressions', label: 'Impressions', color: '#1d4ed8' }]} />
            </div>
            <div>
              <div className="chart-header"><strong>Engagement</strong><span>{summaryLabel}</span></div>
              <LineChart rows={summary?.ga4?.points || []} series={[{ key: 'sessions', label: 'Sessions', color: '#b45309' }, { key: 'conversions', label: 'Conversions', color: '#059669' }]} />
            </div>
          </div>
          <div className="two-column mt">
            <RankSnapshotPanel
              title="Organic rankings"
              subtitle={organicInsights.narrative || 'No organic movement captured yet.'}
              latestDate={organicInsights.latestDate}
              metrics={[
                { label: 'Visibility score', value: organicInsights.visibilityScore || 0 },
                { label: 'Ranked keywords', value: organicInsights.rankedKeywords || 0 },
                { label: 'Top 10 keywords', value: organicInsights.top10Keywords || 0 },
                { label: 'Latest rank scan', value: organicInsights.latestDate || 'n/a' },
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
                { label: 'Latest map scan', value: mapPackInsights.latestDate || 'n/a' },
              ]}
              moversUp={mapPackInsights.moversUp || []}
              moversDown={mapPackInsights.moversDown || []}
            />
          </div>
        </article>

        <aside className="panel span-4" id="workspace-config">
          <div className="panel-head">
            <h2>Workspace configuration</h2>
            <p>Assign client-specific assets while the organization keeps the shared Google connection.</p>
          </div>
          <form className="stack" onSubmit={saveSettings}>
            <label>
              GSC property
              {assets.gscSites.items.length ? (
                <select value={settings.gscSiteUrl} onChange={(event) => setSettings((current) => ({ ...current, gscSiteUrl: event.target.value }))}>
                  <option value="">Select a property</option>
                  {assets.gscSites.items.map((item) => <option key={item.siteUrl} value={item.siteUrl}>{item.siteUrl}</option>)}
                </select>
              ) : (
                <input value={settings.gscSiteUrl} onChange={(event) => setSettings((current) => ({ ...current, gscSiteUrl: event.target.value }))} placeholder="sc-domain:client.com" />
              )}
            </label>
            <AvailabilityNote availability={assets.gscSites.availability} />
            <label>
              GA4 property
              {assets.ga4Properties.items.length ? (
                <select value={settings.ga4PropertyId} onChange={(event) => setSettings((current) => ({ ...current, ga4PropertyId: event.target.value }))}>
                  <option value="">Select a property</option>
                  {assets.ga4Properties.items.map((item) => <option key={item.propertyId} value={item.propertyId}>{item.accountDisplayName} / {item.displayName}</option>)}
                </select>
              ) : (
                <input value={settings.ga4PropertyId} onChange={(event) => setSettings((current) => ({ ...current, ga4PropertyId: event.target.value }))} placeholder="123456789" />
              )}
            </label>
            <AvailabilityNote availability={assets.ga4Properties.availability} />
            <label>
              Google Ads customer
              {assets.adsCustomers.items.length ? (
                <select value={settings.googleAdsCustomerId} onChange={(event) => setSettings((current) => ({ ...current, googleAdsCustomerId: event.target.value }))}>
                  <option value="">Select a customer</option>
                  {assets.adsCustomers.items.map((item) => <option key={item.customerId} value={item.customerId}>{item.displayName}</option>)}
                </select>
              ) : (
                <input value={settings.googleAdsCustomerId} onChange={(event) => setSettings((current) => ({ ...current, googleAdsCustomerId: event.target.value }))} placeholder="1234567890" />
              )}
            </label>
            <AvailabilityNote availability={assets.adsCustomers.availability} />
            <label>
              Rank domain
              <input value={settings.rankDomain} onChange={(event) => setSettings((current) => ({ ...current, rankDomain: event.target.value }))} placeholder="clientsite.com" />
            </label>
            <button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save workspace config'}</button>
          </form>
          <div className="row-actions mt">
            <button type="button" className="secondary" disabled={runningSync} onClick={() => runSync('all')}>Run full sync</button>
            <button type="button" className="secondary" disabled={runningSync} onClick={() => runSync('rank')}>Rank sync</button>
          </div>
          <div className="stack tight mt">
            <strong>Attention queue</strong>
            {alerts.length ? alerts.map((alert) => (
              <div key={alert.id} className="alert-card compact-alert">
                <div className="spread"><strong>{alert.title}</strong><span className={`severity-pill severity-${alert.severity}`}>{alert.severity}</span></div>
                <p>{alert.message}</p>
              </div>
            )) : <p className="muted-copy">No open workspace alerts.</p>}
          </div>
        </aside>
      </section>
    </div>
  )
}

function AvailabilityNote({ availability }) {
  if (!availability?.message || availability.state === 'ready') return null
  return <p className="muted-copy inline-note">{availability.message}</p>
}

function StatCard({ accent, label, value }) {
  return <div className={`kpi-card ${accent}`}><p>{label}</p><h3>{value}</h3></div>
}

function MetricTile({ label, value }) {
  return <div className="metric-tile"><span>{label}</span><strong>{value}</strong></div>
}

function MovementList({ items, title }) {
  return (
    <div className="subpanel">
      <h3>{title}</h3>
      {items.length ? items.map((item) => (
        <div key={`${title}-${item.keyword}`} className="list-row">
          <span>{item.keyword}</span>
          <strong>{item.delta > 0 ? `+${item.delta}` : item.delta}</strong>
        </div>
      )) : <p className="muted-copy">No movement recorded.</p>}
    </div>
  )
}

function RankSnapshotPanel({ latestDate, metrics, moversDown, moversUp, subtitle, title }) {
  return (
    <div className="subpanel stack">
      <div className="panel-head compact-head">
        <h3>{title}</h3>
        <p>{latestDate ? `Latest scan ${latestDate}` : 'Waiting for rank sync'}</p>
      </div>
      <div className="kpi-row compact overview-rank-panel-strip">
        {metrics.map((metric) => <MetricTile key={`${title}-${metric.label}`} label={metric.label} value={metric.value} />)}
      </div>
      <p className="muted-copy">{subtitle}</p>
      <div className="two-column">
        <MovementList title="Top winners" items={moversUp} />
        <MovementList title="Top decliners" items={moversDown} />
      </div>
    </div>
  )
}
