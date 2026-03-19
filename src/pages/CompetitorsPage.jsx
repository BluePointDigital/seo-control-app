import { useEffect, useState } from 'react'

import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { MetricCard, PageIntro, SectionHeading } from '../components/ui/surface'
import { apiRequest } from '../lib/api'

export function CompetitorsPage({ onRefreshAuth, onSetNotice, workspace }) {
  const [competitors, setCompetitors] = useState([])
  const [overlap, setOverlap] = useState({ items: [] })
  const [domain, setDomain] = useState('')

  async function reload() {
    const [competitorsJson, overlapJson] = await Promise.all([
      apiRequest(`/api/workspaces/${workspace.id}/competitors`),
      apiRequest(`/api/workspaces/${workspace.id}/competitors/overlap`),
    ])
    setCompetitors(competitorsJson.items || [])
    setOverlap(overlapJson)
  }

  useEffect(() => {
    let cancelled = false

    Promise.all([
      apiRequest(`/api/workspaces/${workspace.id}/competitors`),
      apiRequest(`/api/workspaces/${workspace.id}/competitors/overlap`),
    ]).then(([competitorsJson, overlapJson]) => {
      if (cancelled) return
      setCompetitors(competitorsJson.items || [])
      setOverlap(overlapJson)
    }).catch((error) => onSetNotice(error.message))

    return () => {
      cancelled = true
    }
  }, [onSetNotice, workspace.id])

  async function addCompetitor(event) {
    event.preventDefault()
    try {
      await apiRequest(`/api/workspaces/${workspace.id}/competitors`, { method: 'POST', body: { domain } })
      setDomain('')
      await reload()
      await onRefreshAuth()
      onSetNotice('Competitor added.')
    } catch (error) {
      onSetNotice(error.message)
    }
  }

  async function removeCompetitor(id) {
    try {
      await apiRequest(`/api/workspaces/${workspace.id}/competitors/${id}`, { method: 'DELETE' })
      await reload()
      await onRefreshAuth()
    } catch (error) {
      onSetNotice(error.message)
    }
  }

  return (
    <div className="space-y-6">
      <PageIntro
        badge="Competitors"
        title="Competitor benchmarks"
        description="Keep competitor tracking inside the client workspace so overlap analysis stays close to the rest of your rank reporting."
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <Card>
          <CardHeader>
            <SectionHeading
              title="Tracked competitors"
              description="Save competitor domains to include them in overlap baselines and benchmark narratives."
            />
          </CardHeader>
          <CardContent className="space-y-6">
            <form className="flex flex-col gap-3 sm:flex-row" onSubmit={addCompetitor}>
              <Input
                value={domain}
                onChange={(event) => setDomain(event.target.value)}
                placeholder="competitor.com"
              />
              <Button type="submit">Add competitor</Button>
            </form>

            <div className="grid gap-3">
              {competitors.map((item) => (
                <div key={item.id} className="flex flex-col gap-4 rounded-[24px] border border-slate-200 bg-slate-50/70 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-semibold text-slate-950">{item.domain}</p>
                    <p className="mt-1 text-sm text-slate-500">Added {formatDate(item.createdAt)}</p>
                  </div>
                  <Button type="button" variant="secondary" size="sm" onClick={() => removeCompetitor(item.id)}>
                    Remove
                  </Button>
                </div>
              ))}
              {!competitors.length ? <p className="text-sm text-slate-500">No competitors saved yet.</p> : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <SectionHeading
              title="Overlap summary"
              description={overlap.latestDate ? `Latest competitor baseline: ${overlap.latestDate}` : 'Run rank sync after adding competitors to see overlap.'}
            />
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard label="Competitors" value={competitors.length} tone="accent" />
              <MetricCard label="Benchmarks with overlap" value={(overlap.items || []).length} />
              <MetricCard label="Latest baseline" value={overlap.latestDate || 'n/a'} tone="subtle" />
              <MetricCard label="Tracked workspace" value={workspace.name} tone="subtle" />
            </div>

            <div className="grid gap-3">
              {(overlap.items || []).map((item) => (
                <div key={item.domain} className="rounded-[24px] border border-slate-200 bg-slate-50/70 px-5 py-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-lg font-semibold tracking-tight text-slate-950">{item.domain}</p>
                      <p className="mt-1 text-sm leading-6 text-slate-500">
                        {item.overlapKeywords}/{item.trackedKeywords} tracked keywords overlap. Average position {item.avgPosition ?? 'n/a'}.
                      </p>
                    </div>
                    <div className="grid gap-2 sm:text-right">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Top 10 keywords</p>
                      <p className="text-xl font-semibold tracking-tight text-slate-950">{item.top10Keywords}</p>
                    </div>
                  </div>
                </div>
              ))}
              {!overlap.items?.length ? <p className="text-sm text-slate-500">No overlap data yet.</p> : null}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function formatDate(value) {
  if (!value) return 'recently'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString()
}
