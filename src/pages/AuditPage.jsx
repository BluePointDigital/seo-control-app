import { useCallback, useEffect, useMemo, useState } from 'react'

import { apiRequest } from '../lib/api'

export function AuditPage({ onSetNotice, workspace }) {
  const [audit, setAudit] = useState(null)
  const [diff, setDiff] = useState(null)
  const [history, setHistory] = useState([])
  const [workspaceSettings, setWorkspaceSettings] = useState({ rank_domain: '', audit_entry_url: '', audit_max_pages: '25' })
  const [hasPageSpeedKey, setHasPageSpeedKey] = useState(false)
  const [auditConfig, setAuditConfig] = useState({ entryUrl: '', maxPages: '25' })
  const [running, setRunning] = useState(false)

  const reload = useCallback(async () => {
    const [auditJson, diffJson, historyJson, settingsJson, credentialsJson] = await Promise.all([
      apiRequest(`/api/workspaces/${workspace.id}/audit/latest`),
      apiRequest(`/api/workspaces/${workspace.id}/audit/diff`),
      apiRequest(`/api/workspaces/${workspace.id}/audit/history`),
      apiRequest(`/api/workspaces/${workspace.id}/settings`),
      apiRequest('/api/org/credentials'),
    ])
    setAudit(auditJson.item || null)
    setDiff(diffJson)
    setHistory(historyJson.items || [])
    setWorkspaceSettings(settingsJson)
    setAuditConfig({
      entryUrl: settingsJson.audit_entry_url || '',
      maxPages: settingsJson.audit_max_pages || '25',
    })
    setHasPageSpeedKey(Boolean((credentialsJson.items || []).find((item) => item.provider === 'google_pagespeed_api')))
  }, [workspace.id])

  useEffect(() => {
    reload().catch((error) => onSetNotice(error.message))
  }, [onSetNotice, reload])

  const groupedIssues = useMemo(() => {
    const map = new Map()
    for (const issue of audit?.issues || []) {
      const key = `${issue.code}|${issue.severity}`
      const current = map.get(key) || { ...issue, urls: [] }
      if (issue.url && !current.urls.includes(issue.url)) current.urls.push(issue.url)
      map.set(key, current)
    }
    return [...map.values()].sort((left, right) => right.urls.length - left.urls.length || left.code.localeCompare(right.code))
  }, [audit])

  async function runAudit(event) {
    event?.preventDefault?.()
    setRunning(true)
    try {
      await apiRequest(`/api/workspaces/${workspace.id}/settings`, {
        method: 'PATCH',
        body: {
          auditEntryUrl: auditConfig.entryUrl,
          auditMaxPages: Number(auditConfig.maxPages || 25),
        },
      })
      await apiRequest(`/api/workspaces/${workspace.id}/audit/run`, {
        method: 'POST',
        body: {
          entryUrl: auditConfig.entryUrl,
          maxPages: Number(auditConfig.maxPages || 25),
        },
      })
      await reload()
      onSetNotice('Site audit completed.')
    } catch (error) {
      onSetNotice(error.message)
    } finally {
      setRunning(false)
    }
  }

  const pageSpeed = audit?.details?.pageSpeed || {}
  const crawlSummary = audit?.details || {}
  const issueCounts = crawlSummary.issueCounts?.severity || { high: 0, medium: 0, low: 0 }
  const effectiveTarget = auditConfig.entryUrl || workspaceSettings.audit_entry_url || (workspaceSettings.rank_domain ? `https://${workspaceSettings.rank_domain}` : '')

  return (
    <section className="page-grid audit-grid">
      <article className="panel span-8">
        <div className="panel-head">
          <h2>Latest audit baseline</h2>
          <p>{audit ? `Audited ${audit.auditedUrl}` : 'Set the workspace rank domain or audit entry URL, then run the first audit baseline.'}</p>
        </div>
        <div className="kpi-row compact">
          <Metric label="Health score" value={audit ? Math.round(audit.healthScore) : 'n/a'} />
          <Metric label="Pages crawled" value={crawlSummary.pagesCrawled || 0} />
          <Metric label="Error pages" value={crawlSummary.errorPages || 0} />
          <Metric label="Duration" value={crawlSummary.durationMs ? `${Math.round(crawlSummary.durationMs / 1000)}s` : 'n/a'} />
        </div>
        <div className="kpi-row compact audit-metrics-row">
          <Metric label="PSI mobile SEO" value={pageSpeed.mobile?.seo ?? 'n/a'} />
          <Metric label="PSI desktop SEO" value={pageSpeed.desktop?.seo ?? 'n/a'} />
          <Metric label="Timeouts" value={crawlSummary.timedOutPages || 0} />
          <Metric label="Pages queued" value={crawlSummary.pagesQueued || 0} />
        </div>
        {!workspaceSettings.rank_domain && !effectiveTarget ? <p className="muted-copy inline-note">No rank domain is configured yet. Add a workspace rank domain or custom audit entry URL.</p> : null}
        {!hasPageSpeedKey ? <p className="muted-copy inline-note">No PageSpeed Insights API key is saved yet. The audit will still crawl pages, but Lighthouse scores will be unavailable.</p> : null}
        {pageSpeed.error ? <p className="muted-copy inline-note">{pageSpeed.error}</p> : null}
        {(crawlSummary.errorPages || 0) > 0 || (crawlSummary.timedOutPages || 0) > 0 ? <p className="muted-copy inline-note">The audit completed with crawl failures. Review blocked, timed-out, or non-HTML URLs below.</p> : null}

        <div className="two-column mt">
          <div className="subpanel">
            <h3>Issue severity</h3>
            <div className="list-table mt">
              <div className="list-row"><span>High</span><strong>{issueCounts.high || 0}</strong></div>
              <div className="list-row"><span>Medium</span><strong>{issueCounts.medium || 0}</strong></div>
              <div className="list-row"><span>Low</span><strong>{issueCounts.low || 0}</strong></div>
            </div>
          </div>
          <div className="subpanel">
            <h3>Crawl diagnostics</h3>
            <div className="list-table mt">
              <div className="list-row"><span>Duplicate titles</span><strong>{crawlSummary.duplicateTitles || 0}</strong></div>
              <div className="list-row"><span>Duplicate descriptions</span><strong>{crawlSummary.duplicateDescriptions || 0}</strong></div>
              <div className="list-row"><span>Audited at</span><strong>{audit?.createdAt ? new Date(audit.createdAt).toLocaleString() : 'n/a'}</strong></div>
            </div>
          </div>
        </div>

        <div className="list-table mt">
          {groupedIssues.map((issue) => (
            <div key={`${issue.code}-${issue.severity}`} className="audit-row grouped">
              <div className="row-actions tight spread">
                <strong>{issue.severity}</strong>
                <span>{issue.code}</span>
              </div>
              <p>{issue.message}</p>
              <small>{issue.urls.length} URL(s)</small>
              {issue.urls.slice(0, 5).map((url) => <code key={url}>{url}</code>)}
            </div>
          ))}
          {!groupedIssues.length ? <p className="muted-copy">No audit findings yet.</p> : null}
        </div>
      </article>

      <aside className="panel span-4">
        <div className="panel-head">
          <h2>Audit controls</h2>
          <p>Keep the crawl lightweight and repeatable for beta monitoring.</p>
        </div>
        <form className="stack" onSubmit={runAudit}>
          <label>
            Entry URL
            <input value={auditConfig.entryUrl} onChange={(event) => setAuditConfig((current) => ({ ...current, entryUrl: event.target.value }))} placeholder={workspaceSettings.rank_domain ? `https://${workspaceSettings.rank_domain}` : 'https://clientsite.com'} />
          </label>
          <label>
            Max pages
            <input type="number" min="5" max="50" value={auditConfig.maxPages} onChange={(event) => setAuditConfig((current) => ({ ...current, maxPages: event.target.value }))} />
          </label>
          <button type="submit" disabled={running}>{running ? 'Running audit...' : 'Run site audit'}</button>
        </form>

        <div className="subpanel mt">
          <h3>Audit changes</h3>
          <div className="list-table mt">
            <div className="list-row"><span>Added</span><strong>{diff?.counts?.added || 0}</strong></div>
            <div className="list-row"><span>Resolved</span><strong>{diff?.counts?.resolved || 0}</strong></div>
            <div className="list-row"><span>Worsened</span><strong>{diff?.counts?.worsened || 0}</strong></div>
          </div>
          <div className="list-table mt">
            {['added', 'resolved', 'worsened'].map((bucket) => (
              <div key={bucket} className="audit-diff-block">
                <strong>{bucket}</strong>
                {(diff?.samples?.[bucket] || []).slice(0, 3).map((item, index) => <code key={`${bucket}-${index}`}>{item.code} - {item.url || item.message}</code>)}
              </div>
            ))}
          </div>
        </div>

        <div className="subpanel mt">
          <h3>Recent runs</h3>
          <div className="list-table mt">
            {history.map((item) => (
              <div key={item.id} className="list-row stacked-row">
                <span>{new Date(item.createdAt).toLocaleString()}</span>
                <strong>{Math.round(item.healthScore)} health</strong>
                <small>{item.pagesCrawled} pages, {item.issuesCount} issues</small>
              </div>
            ))}
            {!history.length ? <p className="muted-copy">No prior audit runs yet.</p> : null}
          </div>
        </div>
      </aside>
    </section>
  )
}

function Metric({ label, value }) {
  return <div className="metric-tile"><span>{label}</span><strong>{value}</strong></div>
}
