import { useEffect, useState } from 'react'

import { LineChart } from '../components/LineChart'
import { Badge } from '../components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { MetricCard, PageIntro, SectionHeading } from '../components/ui/surface'
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
    <div className="space-y-6">
      <PageIntro
        badge="Ads"
        title="Paid search visibility"
        description={settings.google_ads_customer_id
          ? `Reporting for Google Ads customer ${settings.google_ads_customer_id}.`
          : 'Assign a Google Ads customer in workspace setup to activate paid reporting.'}
        actions={<Badge variant="neutral">{summary?.range?.label || dateRange.label}</Badge>}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_340px]">
        <Card>
          <CardHeader>
            <SectionHeading
              title="Performance trend"
              description="Use paid search alongside organic reporting without bouncing into another tool."
            />
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard label="Clicks" value={summary?.ads?.clicks || 0} tone="accent" />
              <MetricCard label="Impressions" value={summary?.ads?.impressions || 0} />
              <MetricCard label="Conversions" value={summary?.ads?.conversions || 0} />
              <MetricCard label="Spend" value={`$${Number(summary?.ads?.cost || 0).toFixed(2)}`} />
            </div>
            <LineChart
              rows={summary?.ads?.points || []}
              series={[
                { key: 'clicks', label: 'Clicks', color: '#f97316' },
                { key: 'cost', label: 'Spend', color: '#dc2626' },
              ]}
            />
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Workspace guidance</CardTitle>
              <CardDescription>Paid search stays optional, but it fits the same workspace view once connected.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <MetricCard label="Customer assigned" value={settings.google_ads_customer_id ? 'Yes' : 'No'} tone={settings.google_ads_customer_id ? 'accent' : 'warning'} />
              <MetricCard label="CTR" value={`${((summary?.ads?.ctr || 0) * 100).toFixed(2)}%`} />
              <MetricCard label="Cost per conversion" value={formatCurrency(summary?.ads?.conversions ? Number(summary?.ads?.cost || 0) / Number(summary?.ads?.conversions || 1) : 0)} />
              {!settings.google_ads_customer_id ? (
                <p className="rounded-[20px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-700">
                  Google Ads stays optional. Keep this blank until the client is ready, then map the customer in Setup.
                </p>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function formatCurrency(value) {
  return `$${Number(value || 0).toFixed(2)}`
}
