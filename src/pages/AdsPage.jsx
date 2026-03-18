import { useEffect, useState } from 'react'

import { LineChart } from '../components/LineChart'
import { apiRequest, buildApiPath } from '../lib/api'

export function AdsPage({ dateRange, onSetNotice, workspace }) {
  const [summary, setSummary] = useState(null)
  const [settings, setSettings] = useState({ google_ads_customer_id: '' })
  const rangeKey = JSON.stringify(dateRange.query)

  useEffect(() => {
    Promise.all([
      apiRequest(buildApiPath(`/api/workspaces/${workspace.id}/summary`, dateRange.query)),
      apiRequest(`/api/workspaces/${workspace.id}/settings`),
    ]).then(([summaryJson, settingsJson]) => {
      setSummary(summaryJson)
      setSettings(settingsJson)
    }).catch((error) => onSetNotice(error.message))
  }, [dateRange.query, onSetNotice, rangeKey, workspace.id])

  return (
    <section className="page-grid">
      <article className="panel span-8">
        <div className="panel-head">
          <h2>Paid search visibility</h2>
          <p>{settings.google_ads_customer_id ? `Customer ${settings.google_ads_customer_id}` : 'Assign a Google Ads customer to activate workspace-level paid reporting.'}</p>
        </div>
        <div className="kpi-row compact">
          <Metric label="Clicks" value={summary?.ads?.clicks || 0} />
          <Metric label="Impressions" value={summary?.ads?.impressions || 0} />
          <Metric label="Conversions" value={summary?.ads?.conversions || 0} />
          <Metric label="Spend" value={`$${Number(summary?.ads?.cost || 0).toFixed(2)}`} />
        </div>
        <div className="chart-header"><strong>Spend and clicks</strong><span>{summary?.range?.label || dateRange.label}</span></div>
        <LineChart
          rows={summary?.ads?.points || []}
          series={[
            { key: 'clicks', label: 'Clicks', color: '#f97316' },
            { key: 'cost', label: 'Spend', color: '#dc2626' },
          ]}
        />
      </article>
      <aside className="panel span-4">
        <div className="panel-head">
          <h2>Workspace guidance</h2>
          <p>Ads stays optional in the beta, but shared org credentials keep the setup sane for agencies.</p>
        </div>
        <div className="stack">
          <div className="metric-tile"><span>Customer assigned</span><strong>{settings.google_ads_customer_id ? 'Yes' : 'No'}</strong></div>
          <div className="metric-tile"><span>CTR</span><strong>{((summary?.ads?.ctr || 0) * 100).toFixed(2)}%</strong></div>
          {!settings.google_ads_customer_id ? <p className="muted-copy inline-note">Google Ads stays optional. Leave the customer blank until the client is ready.</p> : null}
        </div>
      </aside>
    </section>
  )
}

function Metric({ label, value }) {
  return <div className="metric-tile"><span>{label}</span><strong>{value}</strong></div>
}
