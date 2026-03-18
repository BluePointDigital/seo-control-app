import { useEffect, useState } from 'react'

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

    return () => { cancelled = true }
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
    <section className="page-grid">
      <article className="panel span-6">
        <div className="panel-head">
          <h2>Tracked competitors</h2>
          <p>Agency benchmarking stays inside the client workspace instead of living in separate tools.</p>
        </div>
        <form className="row-actions" onSubmit={addCompetitor}>
          <input value={domain} onChange={(event) => setDomain(event.target.value)} placeholder="competitor.com" />
          <button type="submit">Add competitor</button>
        </form>
        <div className="list-table mt">
          {competitors.map((item) => (
            <div key={item.id} className="list-row">
              <span>{item.domain}</span>
              <button type="button" className="secondary small" onClick={() => removeCompetitor(item.id)}>Remove</button>
            </div>
          ))}
          {!competitors.length ? <p className="muted-copy">No competitors saved yet.</p> : null}
        </div>
      </article>
      <aside className="panel span-6">
        <div className="panel-head">
          <h2>Overlap summary</h2>
          <p>{overlap.latestDate ? `Latest competitor baseline: ${overlap.latestDate}` : 'Run rank sync after adding competitors to see overlap.'}</p>
        </div>
        <div className="list-table">
          {(overlap.items || []).map((item) => (
            <div key={item.domain} className="audit-row">
              <strong>{item.domain}</strong>
              <span>{item.top10Keywords} top-10 keywords</span>
              <p>{item.overlapKeywords}/{item.trackedKeywords} tracked keywords ranked. Avg position: {item.avgPosition ?? 'n/a'}.</p>
            </div>
          ))}
          {!overlap.items?.length ? <p className="muted-copy">No overlap data yet.</p> : null}
        </div>
      </aside>
    </section>
  )
}
