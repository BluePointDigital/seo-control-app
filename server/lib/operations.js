import { getWorkspaceSettingsMap } from './data.js'
import { clamp, safeJsonParse } from './utils.js'
import { validateCustomDateRange } from './validation.js'

export function buildDateRange(query = {}) {
  const hasCustomRange = Boolean(query.startDate && query.endDate)

  if (hasCustomRange) {
    const { startDate, endDate } = validateCustomDateRange(query.startDate, query.endDate)
    return {
      days: diffInDays(startDate, endDate),
      sql: 'date BETWEEN ? AND ?',
      params: [startDate, endDate],
      limitRows: false,
      startDate,
      endDate,
      isCustom: true,
      label: `${startDate} to ${endDate}`,
    }
  }

  const days = clamp(Number(query.days || 30), 7, 180)
  const offsetDays = Math.max(0, Number(query.offsetDays || 0))

  if (offsetDays > 0) {
    return {
      days,
      sql: "date <= date('now', ?)",
      params: [`-${offsetDays} day`],
      limitRows: true,
      startDate: null,
      endDate: null,
      isCustom: false,
      label: `Last ${days} days`,
    }
  }

  return {
    days,
    sql: '1=1',
    params: [],
    limitRows: true,
    startDate: null,
    endDate: null,
    isCustom: false,
    label: `Last ${days} days`,
  }
}

export function getWorkspaceSummary(db, workspaceId, query = {}) {
  const range = buildDateRange(query)

  const gscRows = db.prepare(`
    SELECT date, clicks, impressions, ctr, position
    FROM workspace_gsc_daily
    WHERE workspace_id = ? AND ${range.sql}
    ORDER BY date DESC
    ${range.limitRows ? 'LIMIT ?' : ''}
  `).all(Number(workspaceId), ...range.params, ...(range.limitRows ? [range.days] : []))

  const ga4Rows = db.prepare(`
    SELECT date, sessions, users, new_users, conversions, engagement_rate
    FROM workspace_ga4_daily
    WHERE workspace_id = ? AND ${range.sql}
    ORDER BY date DESC
    ${range.limitRows ? 'LIMIT ?' : ''}
  `).all(Number(workspaceId), ...range.params, ...(range.limitRows ? [range.days] : []))

  const adsRows = db.prepare(`
    SELECT date, clicks, impressions, ctr, conversions, cost_micros
    FROM workspace_google_ads_daily
    WHERE workspace_id = ? AND ${range.sql}
    ORDER BY date DESC
    ${range.limitRows ? 'LIMIT ?' : ''}
  `).all(Number(workspaceId), ...range.params, ...(range.limitRows ? [range.days] : []))

  const gscTotals = gscRows.reduce((acc, row) => ({
    clicks: acc.clicks + Number(row.clicks || 0),
    impressions: acc.impressions + Number(row.impressions || 0),
    position: acc.position + Number(row.position || 0),
  }), { clicks: 0, impressions: 0, position: 0 })

  const ga4Totals = ga4Rows.reduce((acc, row) => ({
    sessions: acc.sessions + Number(row.sessions || 0),
    users: acc.users + Number(row.users || 0),
    newUsers: acc.newUsers + Number(row.new_users || 0),
    conversions: acc.conversions + Number(row.conversions || 0),
    engagementRate: acc.engagementRate + Number(row.engagement_rate || 0),
  }), { sessions: 0, users: 0, newUsers: 0, conversions: 0, engagementRate: 0 })

  const adsTotals = adsRows.reduce((acc, row) => ({
    clicks: acc.clicks + Number(row.clicks || 0),
    impressions: acc.impressions + Number(row.impressions || 0),
    conversions: acc.conversions + Number(row.conversions || 0),
    costMicros: acc.costMicros + Number(row.cost_micros || 0),
  }), { clicks: 0, impressions: 0, conversions: 0, costMicros: 0 })

  const avgCtr = gscTotals.impressions ? gscTotals.clicks / gscTotals.impressions : 0
  const avgPosition = gscRows.length ? gscTotals.position / gscRows.length : 0
  const avgEngagementRate = ga4Rows.length ? ga4Totals.engagementRate / ga4Rows.length : 0
  const adsCtr = adsTotals.impressions ? adsTotals.clicks / adsTotals.impressions : 0

  const gsc = {
    clicks: Math.round(gscTotals.clicks),
    impressions: Math.round(gscTotals.impressions),
    ctr: avgCtr,
    avgPosition,
    points: gscRows.slice().reverse().map((row) => ({
      date: row.date,
      clicks: Number(row.clicks || 0),
      impressions: Number(row.impressions || 0),
      ctr: Number(row.ctr || 0),
      position: Number(row.position || 0),
    })),
  }

  const ga4 = {
    sessions: Math.round(ga4Totals.sessions),
    users: Math.round(ga4Totals.users),
    newUsers: Math.round(ga4Totals.newUsers),
    conversions: Math.round(ga4Totals.conversions),
    engagementRate: avgEngagementRate,
    points: ga4Rows.slice().reverse().map((row) => ({
      date: row.date,
      sessions: Number(row.sessions || 0),
      users: Number(row.users || 0),
      newUsers: Number(row.new_users || 0),
      conversions: Number(row.conversions || 0),
      engagementRate: Number(row.engagement_rate || 0),
    })),
  }

  const ads = {
    clicks: Math.round(adsTotals.clicks),
    impressions: Math.round(adsTotals.impressions),
    ctr: adsCtr,
    conversions: Math.round(adsTotals.conversions),
    cost: Number((adsTotals.costMicros / 1_000_000).toFixed(2)),
    points: adsRows.slice().reverse().map((row) => ({
      date: row.date,
      clicks: Number(row.clicks || 0),
      impressions: Number(row.impressions || 0),
      ctr: Number(row.ctr || 0),
      conversions: Number(row.conversions || 0),
      cost: Number((Number(row.cost_micros || 0) / 1_000_000).toFixed(2)),
    })),
  }

  return {
    range: {
      days: range.days,
      startDate: range.startDate,
      endDate: range.endDate,
      isCustom: range.isCustom,
      label: range.label,
    },
    gsc,
    ga4,
    ads,
    gscLast30Days: gsc,
    ga4Last30Days: ga4,
    adsLast30Days: ads,
  }
}

export function getWorkspaceRankSummary(db, workspaceId, query = {}) {
  const range = buildDateRange(query)
  const requestedProfileId = query.profileId == null || query.profileId === '' ? null : Number(query.profileId)
  const organic = buildRankSummaryForScope(db, workspaceId, range, requestedProfileId, 'organic')
  const mapPack = buildRankSummaryForScope(db, workspaceId, range, requestedProfileId, 'mapPack')

  if (requestedProfileId != null) {
    return {
      ...organic,
      mapPack,
    }
  }

  const profileRows = db.prepare(`
    SELECT id, name, slug, location_label, search_location_id, search_location_name, business_name, gl, hl, device, active
    FROM rank_profiles
    WHERE workspace_id = ?
    ORDER BY active DESC, name COLLATE NOCASE
  `).all(Number(workspaceId))

  const profiles = profileRows.map((profile) => {
    const profileSummary = buildRankSummaryForScope(db, workspaceId, range, profile.id, 'organic')
    return {
      id: profile.id,
      name: profile.name,
      slug: profile.slug,
      locationLabel: profile.location_label || '',
      searchLocationId: profile.search_location_id || '',
      searchLocationName: profile.search_location_name || '',
      businessName: profile.business_name || profile.name,
      gl: profile.gl,
      hl: profile.hl,
      device: profile.device,
      active: Boolean(profile.active),
      visibilityScore: profileSummary.insights.visibilityScore,
      latestDate: profileSummary.insights.latestDate,
      narrative: profileSummary.insights.narrative,
      trackedKeywords: profileSummary.items.length,
      rankedKeywords: profileSummary.items.filter((row) => Number.isInteger(row.position)).length,
      moversUp: profileSummary.insights.moversUp.length,
      moversDown: profileSummary.insights.moversDown.length,
      openAlertCount: Number(db.prepare("SELECT COUNT(*) AS count FROM workspace_alerts WHERE workspace_id = ? AND profile_id = ? AND status = 'open'").get(Number(workspaceId), Number(profile.id)).count || 0),
    }
  })

  const mapPackProfiles = profileRows.map((profile) => {
    const profileSummary = buildRankSummaryForScope(db, workspaceId, range, profile.id, 'mapPack')
    return {
      id: profile.id,
      name: profile.name,
      slug: profile.slug,
      locationLabel: profile.location_label || '',
      searchLocationId: profile.search_location_id || '',
      searchLocationName: profile.search_location_name || '',
      businessName: profile.business_name || profile.name,
      gl: profile.gl,
      hl: profile.hl,
      device: profile.device,
      active: Boolean(profile.active),
      visibilityScore: profileSummary.insights.visibilityScore,
      latestDate: profileSummary.insights.latestDate,
      narrative: profileSummary.insights.narrative,
      trackedKeywords: profileSummary.items.length,
      rankedKeywords: profileSummary.items.filter((row) => Number.isInteger(row.position)).length,
      top3Keywords: profileSummary.insights.top3Keywords || 0,
      moversUp: profileSummary.insights.moversUp.length,
      moversDown: profileSummary.insights.moversDown.length,
      openAlertCount: Number(db.prepare("SELECT COUNT(*) AS count FROM workspace_alerts WHERE workspace_id = ? AND profile_id = ? AND status = 'open'").get(Number(workspaceId), Number(profile.id)).count || 0),
    }
  })

  return {
    ...organic,
    profiles,
    mapPack: {
      ...mapPack,
      profiles: mapPackProfiles,
    },
  }
}

function buildRankSummaryForScope(db, workspaceId, range, profileId = null, mode = 'organic') {
  const positionColumn = mode === 'mapPack' ? 'map_pack_position' : 'position'
  const urlColumn = mode === 'mapPack' ? 'map_pack_found_url' : 'found_url'
  const nameColumn = mode === 'mapPack' ? 'map_pack_found_name' : 'NULL'
  const noBaselineNarrative = mode === 'mapPack'
    ? 'No map pack baseline yet. Run rank sync to capture the first local-pack snapshot.'
    : 'No rank baseline yet.'
  const params = [Number(workspaceId), ...range.params]
  const scopeSql = profileId != null ? ' AND profile_id = ?' : ''
  const scopeParams = profileId != null ? [Number(profileId)] : []
  const latestRow = db.prepare(`SELECT MAX(date) AS d FROM rank_daily WHERE workspace_id = ? AND ${range.sql}${scopeSql}`)
    .get(...params, ...scopeParams)
  const latestDate = latestRow?.d

  const baseResponse = {
    range: {
      days: range.days,
      startDate: range.startDate,
      endDate: range.endDate,
      isCustom: range.isCustom,
      label: range.label,
    },
    profileId: profileId == null ? null : Number(profileId),
    items: [],
    insights: {
      visibilityScore: 0,
      moversUp: [],
      moversDown: [],
      latestDate: null,
      prevDate: null,
      trendRows: [],
      narrative: noBaselineNarrative,
      trackedKeywords: 0,
      rankedKeywords: 0,
      top10Keywords: 0,
      top3Keywords: 0,
      top1Keywords: 0,
    },
  }

  if (!latestDate) {
    return baseResponse
  }

  const prevDateQuery = `
    SELECT MAX(date) AS d
    FROM rank_daily
    WHERE workspace_id = ? AND ${range.sql}${scopeSql} AND date < ?
  `
  const prevDate = db.prepare(prevDateQuery)
    .get(...params, ...scopeParams, latestDate)?.d || null

  const latestRows = db.prepare(`
    SELECT rd.keyword, rd.date, rd.${positionColumn} AS position, rd.${urlColumn} AS found_url, ${nameColumn} AS found_name, rd.profile_id, rp.name AS profile_name, rp.slug AS profile_slug
    FROM rank_daily rd
    JOIN rank_profiles rp ON rp.id = rd.profile_id
    WHERE rd.workspace_id = ? AND rd.date = ?${profileId != null ? ' AND rd.profile_id = ?' : ''}
    ORDER BY rd.position IS NULL, rd.position ASC, rd.keyword ASC
  `).all(Number(workspaceId), latestDate, ...scopeParams)

  const prevMap = new Map()
  if (prevDate) {
    const prevRows = db.prepare(`
      SELECT keyword, ${positionColumn} AS position, profile_id
      FROM rank_daily
      WHERE workspace_id = ? AND date = ?${profileId != null ? ' AND profile_id = ?' : ''}
    `).all(Number(workspaceId), prevDate, ...scopeParams)

    for (const row of prevRows) {
      prevMap.set(`${row.profile_id}|${row.keyword}`, row.position)
    }
  }

  const scored = latestRows.map((row) => {
    const current = Number.isInteger(row.position) ? row.position : null
    const previous = prevMap.has(`${row.profile_id}|${row.keyword}`) && Number.isInteger(prevMap.get(`${row.profile_id}|${row.keyword}`))
      ? prevMap.get(`${row.profile_id}|${row.keyword}`)
      : null

    let delta = null
    if (current !== null && previous !== null) delta = previous - current
    else if (current !== null && previous === null) delta = 100
    else if (current === null && previous !== null) delta = -100

    return {
      keyword: row.keyword,
      date: row.date,
      position: current,
      foundUrl: row.found_url || null,
      foundName: row.found_name || '',
      profileId: Number(row.profile_id),
      profileName: row.profile_name,
      profileSlug: row.profile_slug,
      delta,
    }
  })

  const moversUp = scored.filter((row) => (row.delta || 0) > 0).sort((a, b) => b.delta - a.delta).slice(0, 8)
  const moversDown = scored.filter((row) => (row.delta || 0) < 0).sort((a, b) => a.delta - b.delta).slice(0, 8)
  const ranked = scored.filter((row) => Number.isInteger(row.position))
  const top1Keywords = ranked.filter((row) => row.position <= 1).length
  const top3Keywords = ranked.filter((row) => row.position <= 3).length
  const top10Keywords = mode === 'mapPack'
    ? top3Keywords
    : ranked.filter((row) => row.position <= 10).length
  const visibilityScore = mode === 'mapPack'
    ? calculateMapPackVisibilityScore(scored)
    : ranked.length
      ? Math.max(0, Math.min(100, Number(((ranked.reduce((sum, row) => sum + (101 - row.position), 0) / (ranked.length * 100)) * 100).toFixed(1))))
      : 0

  const rawTrendRows = db.prepare(`
    SELECT date,
      SUM(CASE WHEN ${positionColumn} = 1 THEN 1 ELSE 0 END) AS top1,
      SUM(CASE WHEN ${positionColumn} BETWEEN 1 AND 3 THEN 1 ELSE 0 END) AS top3,
      SUM(CASE WHEN ${positionColumn} BETWEEN 1 AND 10 THEN 1 ELSE 0 END) AS top10,
      SUM(CASE WHEN ${positionColumn} BETWEEN 1 AND 20 THEN 1 ELSE 0 END) AS top20,
      SUM(CASE WHEN ${positionColumn} BETWEEN 1 AND 100 THEN 1 ELSE 0 END) AS top100,
      SUM(CASE WHEN ${positionColumn} IS NOT NULL THEN 1 ELSE 0 END) AS ranked,
      SUM(CASE WHEN ${positionColumn} IS NULL OR ${positionColumn} > ${mode === 'mapPack' ? 3 : 100} THEN 1 ELSE 0 END) AS notRanked
    FROM rank_daily
    WHERE workspace_id = ? AND ${range.sql}${scopeSql}
    GROUP BY date
    ORDER BY date DESC
    ${range.limitRows ? 'LIMIT ?' : ''}
  `).all(Number(workspaceId), ...range.params, ...scopeParams, ...(range.limitRows ? [range.days] : []))

  const trendRows = rawTrendRows.reverse().map((row) => ({
    date: row.date,
    top1: Number(row.top1 || 0),
    top3: Number(row.top3 || 0),
    top10: Number(row.top10 || 0),
    top20: Number(row.top20 || 0),
    top100: Number(row.top100 || 0),
    ranked: Number(row.ranked || 0),
    notRanked: Number(row.notRanked || 0),
  }))

  const narrative = (() => {
    if (!prevDate) {
      return mode === 'mapPack'
        ? 'First map pack baseline captured in the selected range. Run another sync to compare local-pack movement.'
        : 'First rank baseline captured in the selected range. Run another sync to see movement insights.'
    }
    if (!moversUp.length && !moversDown.length) {
      return mode === 'mapPack'
        ? 'No meaningful map pack movement versus the prior baseline in this range.'
        : 'No meaningful movement versus the prior rank baseline in this range.'
    }
    if (moversUp.length > moversDown.length) {
      return mode === 'mapPack'
        ? `Positive map-pack momentum: ${moversUp.length} gainers against ${moversDown.length} decliners.`
        : `Positive momentum: ${moversUp.length} gainers against ${moversDown.length} decliners.`
    }
    if (moversDown.length > moversUp.length) {
      return mode === 'mapPack'
        ? `Mixed or negative map-pack momentum: ${moversDown.length} decliners against ${moversUp.length} gainers.`
        : `Mixed or negative momentum: ${moversDown.length} decliners against ${moversUp.length} gainers.`
    }
    return mode === 'mapPack'
      ? `Balanced map-pack movement: ${moversUp.length} gainers and ${moversDown.length} decliners.`
      : `Balanced movement: ${moversUp.length} gainers and ${moversDown.length} decliners.`
  })()

  return {
    range: {
      days: range.days,
      startDate: range.startDate,
      endDate: range.endDate,
      isCustom: range.isCustom,
      label: range.label,
    },
    profileId: profileId == null ? null : Number(profileId),
    items: scored,
    insights: {
      visibilityScore,
      moversUp,
      moversDown,
      latestDate,
      prevDate,
      trendRows,
      narrative,
      trackedKeywords: scored.length,
      rankedKeywords: ranked.length,
      top10Keywords,
      top3Keywords,
      top1Keywords,
    },
  }
}

function calculateMapPackVisibilityScore(rows = []) {
  if (!rows.length) return 0

  const total = rows.reduce((sum, row) => {
    if (row.position === 1) return sum + 100
    if (row.position === 2) return sum + 66.7
    if (row.position === 3) return sum + 33.3
    return sum
  }, 0)

  return Math.max(0, Math.min(100, Number((total / rows.length).toFixed(1))))
}

export function getLatestSiteAudit(db, workspaceId) {
  const row = db.prepare(`
    SELECT id, workspace_id, audited_url, health_score, issues_json, created_at
    FROM site_audit_runs
    WHERE workspace_id = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(Number(workspaceId))

  if (!row) return null
  return parseAuditRow(row)
}

export function getSiteAuditHistory(db, workspaceId, limit = 8) {
  return db.prepare(`
    SELECT id, workspace_id, audited_url, health_score, issues_json, created_at
    FROM site_audit_runs
    WHERE workspace_id = ?
    ORDER BY id DESC
    LIMIT ?
  `).all(Number(workspaceId), Number(limit)).map(parseAuditHistoryRow)
}

export function getSiteAuditDiff(db, workspaceId) {
  const rows = db.prepare(`
    SELECT id, issues_json, created_at
    FROM site_audit_runs
    WHERE workspace_id = ?
    ORDER BY id DESC
    LIMIT 2
  `).all(Number(workspaceId))

  if (!rows.length) {
    return { latestDate: null, previousDate: null, counts: null, samples: null }
  }

  if (rows.length < 2) {
    return {
      latestDate: rows[0].created_at,
      previousDate: null,
      counts: { added: 0, resolved: 0, worsened: 0, unchanged: 0 },
      samples: { added: [], resolved: [], worsened: [] },
    }
  }

  const parseIssues = (raw) => {
    const parsed = safeJsonParse(raw, {}) || {}
    return Array.isArray(parsed) ? parsed : (parsed.issues || [])
  }

  const severityRank = { low: 1, medium: 2, high: 3 }
  const keyFor = (issue) => `${issue.code || 'unknown'}|${issue.url || '-'}`
  const latestMap = new Map(parseIssues(rows[0].issues_json).map((issue) => [keyFor(issue), issue]))
  const previousMap = new Map(parseIssues(rows[1].issues_json).map((issue) => [keyFor(issue), issue]))

  const added = []
  const resolved = []
  const worsened = []
  const unchanged = []

  for (const [key, issue] of latestMap.entries()) {
    const previous = previousMap.get(key)
    if (!previous) {
      added.push(issue)
      continue
    }

    const currentSeverity = severityRank[issue.severity] || 0
    const previousSeverity = severityRank[previous.severity] || 0
    if (currentSeverity > previousSeverity) worsened.push(issue)
    else unchanged.push(issue)
  }

  for (const [key, issue] of previousMap.entries()) {
    if (!latestMap.has(key)) resolved.push(issue)
  }

  return {
    latestDate: rows[0].created_at,
    previousDate: rows[1].created_at,
    counts: {
      added: added.length,
      resolved: resolved.length,
      worsened: worsened.length,
      unchanged: unchanged.length,
    },
    samples: {
      added: added.slice(0, 8),
      resolved: resolved.slice(0, 8),
      worsened: worsened.slice(0, 8),
    },
  }
}

export function getCompetitorOverlap(db, workspaceId) {
  const latestDate = db.prepare('SELECT MAX(date) AS d FROM competitor_rank_daily WHERE workspace_id = ?').get(Number(workspaceId))?.d || null
  if (!latestDate) return { latestDate: null, items: [] }

  const rows = db.prepare(`
    SELECT
      competitor_domain,
      COUNT(*) AS tracked_keywords,
      SUM(CASE WHEN position IS NOT NULL THEN 1 ELSE 0 END) AS ranked_keywords,
      SUM(CASE WHEN position IS NOT NULL AND position <= 10 THEN 1 ELSE 0 END) AS top10_keywords,
      AVG(CASE WHEN position IS NOT NULL THEN position END) AS avg_position
    FROM competitor_rank_daily
    WHERE workspace_id = ? AND date = ?
    GROUP BY competitor_domain
    ORDER BY ranked_keywords DESC, top10_keywords DESC, avg_position ASC
  `).all(Number(workspaceId), latestDate)

  return {
    latestDate,
    items: rows.map((row) => ({
      domain: row.competitor_domain,
      trackedKeywords: Number(row.tracked_keywords || 0),
      overlapKeywords: Number(row.ranked_keywords || 0),
      top10Keywords: Number(row.top10_keywords || 0),
      avgPosition: row.avg_position == null ? null : Number(Number(row.avg_position).toFixed(1)),
      overlapRate: row.tracked_keywords ? Number(((Number(row.ranked_keywords || 0) / Number(row.tracked_keywords)) * 100).toFixed(1)) : 0,
    })),
  }
}

export function getPortfolioSummary(db, organizationId, query = {}) {
  const range = buildDateRange(query)
  const workspaces = db.prepare(`
    SELECT id, name, slug, created_at
    FROM workspaces
    WHERE organization_id = ?
    ORDER BY name COLLATE NOCASE
  `).all(Number(organizationId))

  const items = workspaces.map((workspace) => {
    const settings = getWorkspaceSettingsMap(db, workspace.id)
    const rankSummary = getWorkspaceRankSummary(db, workspace.id, query)
    const mapPackSummary = rankSummary.mapPack || { insights: {} }
    const openAlertCount = Number(db.prepare("SELECT COUNT(*) AS count FROM workspace_alerts WHERE workspace_id = ? AND status = 'open'").get(Number(workspace.id)).count || 0)
    const stale = isWorkspaceRankStale(settings)

    return {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      createdAt: workspace.created_at,
      openAlertCount,
      rankVisibilityScore: rankSummary.insights.visibilityScore,
      latestRankDate: rankSummary.insights.latestDate,
      latestRankStatus: settings.rank_sync_last_status || 'idle',
      latestRankAttemptedAt: settings.rank_sync_last_attempted_at || null,
      latestRankCompletedAt: settings.rank_sync_last_completed_at || null,
      latestRankError: settings.rank_sync_last_error || '',
      trackedKeywords: rankSummary.insights.trackedKeywords,
      rankedKeywords: rankSummary.insights.rankedKeywords,
      top10Keywords: rankSummary.insights.top10Keywords,
      mapPackVisibilityScore: mapPackSummary.insights.visibilityScore || 0,
      latestMapPackDate: mapPackSummary.insights.latestDate || null,
      mapPackTrackedKeywords: mapPackSummary.insights.trackedKeywords || 0,
      mapPackRankedKeywords: mapPackSummary.insights.rankedKeywords || 0,
      mapPackTop3Keywords: mapPackSummary.insights.top3Keywords || 0,
      moversUp: rankSummary.insights.moversUp.slice(0, 3),
      moversDown: rankSummary.insights.moversDown.slice(0, 3),
      stale,
      schedule: {
        frequency: settings.rank_sync_frequency || 'weekly',
        weekday: Number(settings.rank_sync_weekday || 1),
        hour: Number(settings.rank_sync_hour || 6),
      },
    }
  })

  return {
    range: {
      days: range.days,
      startDate: range.startDate,
      endDate: range.endDate,
      isCustom: range.isCustom,
      label: range.label,
    },
    summary: {
      workspaceCount: items.length,
      openAlertCount: items.reduce((sum, item) => sum + item.openAlertCount, 0),
      staleWorkspaces: items.filter((item) => item.stale).length,
      failingWorkspaces: items.filter((item) => item.latestRankStatus === 'failed').length,
      avgRankVisibilityScore: averageMetric(items, 'rankVisibilityScore'),
      avgMapPackVisibilityScore: averageMetric(items, 'mapPackVisibilityScore'),
      workspacesWithMapPackCoverage: items.filter((item) => item.mapPackRankedKeywords > 0).length,
      totalMapPackTop3Keywords: items.reduce((sum, item) => sum + Number(item.mapPackTop3Keywords || 0), 0),
    },
    items: items.sort((left, right) => {
      if (right.openAlertCount !== left.openAlertCount) return right.openAlertCount - left.openAlertCount
      if (Number(right.stale) !== Number(left.stale)) return Number(right.stale) - Number(left.stale)
      return left.name.localeCompare(right.name)
    }),
  }
}

export function getReportRange(reportType = 'weekly') {
  return resolveReportRange(reportType)
}

export function createWorkspaceReport(db, workspace, reportType = 'weekly', options = {}) {
  const { startDate, endDate, days } = resolveReportRange(reportType, options)
  const summary = getWorkspaceSummary(db, workspace.id, { startDate, endDate })
  const rankSummary = getWorkspaceRankSummary(db, workspace.id, { startDate, endDate })
  const mapPackSummary = rankSummary.mapPack || { items: [], insights: { moversUp: [], moversDown: [] } }
  const latestAudit = getLatestSiteAudit(db, workspace.id)

  const organicMetrics = summarizeRankModeForReport(rankSummary, 'organic')
  const mapPackMetrics = summarizeRankModeForReport(mapPackSummary, 'mapPack')
  const reportHeading = reportType === 'custom'
    ? 'Custom'
    : `${reportType[0].toUpperCase()}${reportType.slice(1)}`

  const headline = [
    `Clicks ${Math.round(summary.gsc.clicks || 0)} and sessions ${Math.round(summary.ga4.sessions || 0)} over the last ${days} days.`,
    `Organic rank coverage: ${organicMetrics.rankedCount}/${organicMetrics.trackedKeywords || 0} keywords ranked, with ${organicMetrics.top10Count} in the top 10.`,
    `Map-pack coverage: ${mapPackMetrics.rankedCount}/${mapPackMetrics.trackedKeywords || 0} tracked keywords matched locally, with ${mapPackMetrics.top3Count} in the top 3.`,
    latestAudit
      ? `Latest technical health score ${Math.round(latestAudit.healthScore)} with ${(latestAudit.issues || []).length} tracked findings.`
      : 'No recent technical audit baseline is available yet.',
  ].join(' ')

  const markdown = `# ${workspace.name} ${reportHeading} SEO Report\n\nGenerated: ${new Date().toISOString()}\nPeriod: ${startDate} to ${endDate}\n\n## Executive Summary\n${headline}\n\n## Rankings\n### Organic Search\n- Visibility score: ${organicMetrics.visibilityScore}\n- Ranked keywords: ${organicMetrics.rankedCount}/${organicMetrics.trackedKeywords || 0}\n- Top 10 keywords: ${organicMetrics.top10Count}\n- Latest rank date: ${organicMetrics.latestDate || 'n/a'}\n\n#### Top Winners\n${formatReportMovementLines(organicMetrics.moversUp, '- No positive movers in the current comparison window.')}\n\n#### Top Decliners\n${formatReportMovementLines(organicMetrics.moversDown, '- No negative movers in the current comparison window.')}\n\n### Map Pack\n- Map visibility score: ${mapPackMetrics.visibilityScore}\n- Ranked in pack: ${mapPackMetrics.rankedCount}/${mapPackMetrics.trackedKeywords || 0}\n- Top 3 map pack results: ${mapPackMetrics.top3Count}\n- Latest map pack date: ${mapPackMetrics.latestDate || 'n/a'}\n\n#### Top Winners\n${formatReportMovementLines(mapPackMetrics.moversUp, '- No positive map-pack movers in the current comparison window.')}\n\n#### Top Decliners\n${formatReportMovementLines(mapPackMetrics.moversDown, '- No negative map-pack movers in the current comparison window.')}\n\n#### Current Matched Listings\n${formatMapPackListingLines(mapPackMetrics.items)}\n\n## Traffic & Engagement\n- Search clicks: ${Math.round(summary.gsc.clicks || 0)}\n- Search impressions: ${Math.round(summary.gsc.impressions || 0)}\n- Search CTR: ${((summary.gsc.ctr || 0) * 100).toFixed(2)}%\n- Avg position: ${(summary.gsc.avgPosition || 0).toFixed(2)}\n- Sessions: ${Math.round(summary.ga4.sessions || 0)}\n- Users: ${Math.round(summary.ga4.users || 0)}\n- Conversions: ${Math.round(summary.ga4.conversions || 0)}\n- Engagement rate: ${((summary.ga4.engagementRate || 0) * 100).toFixed(2)}%\n\n## Paid Search\n- Clicks: ${Math.round(summary.ads.clicks || 0)}\n- Impressions: ${Math.round(summary.ads.impressions || 0)}\n- CTR: ${((summary.ads.ctr || 0) * 100).toFixed(2)}%\n- Conversions: ${Math.round(summary.ads.conversions || 0)}\n- Spend: $${Number(summary.ads.cost || 0).toFixed(2)}\n\n## Technical SEO\n- Latest health score: ${latestAudit ? Math.round(latestAudit.healthScore) : 'n/a'}\n- Latest audit date: ${latestAudit?.createdAt || 'n/a'}\n- Open findings: ${(latestAudit?.issues || []).length}\n${(latestAudit?.issues || []).slice(0, 10).map((issue) => `- [${String(issue.severity || '').toUpperCase()}] ${issue.code}: ${issue.message}`).join('\n') || '- No technical findings captured yet.'}\n\n## Recommended Next Actions\n- Address high and medium technical findings that affect revenue pages first.\n- Refresh content tied to decliners that previously held top-10 visibility.\n- Improve GBP and local landing pages for tracked terms that are not yet holding a top-3 map-pack placement.\n- Tighten titles and descriptions on high-impression pages with weak CTR.\n`

  const reportSummary = {
    reportType,
    periodStart: startDate,
    periodEnd: endDate,
    dateRangeLabel: `${startDate} to ${endDate}`,
    visibilityScore: organicMetrics.visibilityScore,
    rankedCount: organicMetrics.rankedCount,
    trackedKeywords: organicMetrics.trackedKeywords,
    top10Count: organicMetrics.top10Count,
    latestRankDate: organicMetrics.latestDate,
    mapPackVisibilityScore: mapPackMetrics.visibilityScore,
    mapPackRankedCount: mapPackMetrics.rankedCount,
    mapPackTrackedKeywords: mapPackMetrics.trackedKeywords,
    mapPackTop3Count: mapPackMetrics.top3Count,
    latestMapPackDate: mapPackMetrics.latestDate,
    organic: {
      visibilityScore: organicMetrics.visibilityScore,
      rankedCount: organicMetrics.rankedCount,
      trackedKeywords: organicMetrics.trackedKeywords,
      top10Count: organicMetrics.top10Count,
      latestDate: organicMetrics.latestDate,
    },
    mapPack: {
      visibilityScore: mapPackMetrics.visibilityScore,
      rankedCount: mapPackMetrics.rankedCount,
      trackedKeywords: mapPackMetrics.trackedKeywords,
      top3Count: mapPackMetrics.top3Count,
      latestDate: mapPackMetrics.latestDate,
    },
    clicks: Math.round(summary.gsc.clicks || 0),
    sessions: Math.round(summary.ga4.sessions || 0),
    conversions: Math.round(summary.ga4.conversions || 0),
    healthScore: latestAudit ? Math.round(latestAudit.healthScore) : null,
  }

  const result = db.prepare(`
    INSERT INTO report_runs (workspace_id, report_type, period_start, period_end, status, content_markdown, summary_json)
    VALUES (?, ?, ?, ?, 'completed', ?, ?)
  `).run(Number(workspace.id), reportType, startDate, endDate, markdown, JSON.stringify(reportSummary))

  return {
    id: Number(result.lastInsertRowid),
    reportType,
    periodStart: startDate,
    periodEnd: endDate,
    content: markdown,
    summary: reportSummary,
  }
}

export function listReportHistory(db, workspaceId) {
  return db.prepare(`
    SELECT id, workspace_id, report_type, period_start, period_end, status, summary_json, created_at
    FROM report_runs
    WHERE workspace_id = ?
    ORDER BY id DESC
    LIMIT 40
  `).all(Number(workspaceId)).map((row) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    reportType: row.report_type,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    status: row.status,
    summary: safeJsonParse(row.summary_json, null),
    createdAt: row.created_at,
  }))
}

export function getReportById(db, workspaceId, reportId) {
  const row = db.prepare(`
    SELECT id, workspace_id, report_type, period_start, period_end, status, content_markdown, summary_json, created_at
    FROM report_runs
    WHERE workspace_id = ? AND id = ?
  `).get(Number(workspaceId), Number(reportId))

  if (!row) return null
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    reportType: row.report_type,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    status: row.status,
    content: row.content_markdown,
    summary: safeJsonParse(row.summary_json, null),
    createdAt: row.created_at,
  }
}

function resolveReportRange(reportType = 'weekly', options = {}) {
  if (reportType === 'custom') {
    const { startDate, endDate } = validateCustomDateRange(options.startDate, options.endDate)
    return {
      days: diffInDays(startDate, endDate),
      startDate,
      endDate,
    }
  }

  const end = new Date()
  const days = reportType === 'quarterly' ? 90 : reportType === 'monthly' ? 30 : 7
  const start = new Date(end)
  start.setDate(end.getDate() - (days - 1))
  return {
    days,
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  }
}

function parseAuditHistoryRow(row) {
  const item = parseAuditRow(row)
  return {
    id: item.id,
    auditedUrl: item.auditedUrl,
    healthScore: item.healthScore,
    createdAt: item.createdAt,
    issuesCount: item.issues.length,
    pagesCrawled: Number(item.details?.pagesCrawled || 0),
    errorPages: Number(item.details?.errorPages || 0),
    timedOutPages: Number(item.details?.timedOutPages || 0),
    durationMs: Number(item.details?.durationMs || 0),
  }
}

function parseAuditRow(row) {
  const parsed = safeJsonParse(row.issues_json, {}) || {}
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    auditedUrl: row.audited_url,
    healthScore: Number(row.health_score || 0),
    issues: Array.isArray(parsed) ? parsed : (parsed.issues || []),
    details: Array.isArray(parsed) ? {} : (parsed.details || {}),
    createdAt: row.created_at,
  }
}

function isWorkspaceRankStale(settings = {}) {
  const frequency = String(settings.rank_sync_frequency || 'weekly')
  if (frequency === 'manual') return false

  const completedAt = settings.rank_sync_last_completed_at || settings.rank_sync_last_attempted_at || ''
  if (!completedAt) return true

  const lastRunAt = new Date(completedAt).getTime()
  if (Number.isNaN(lastRunAt)) return true

  const ageHours = (Date.now() - lastRunAt) / 3600000
  if (frequency === 'daily') return ageHours > 48
  return ageHours > (8 * 24)
}

function diffInDays(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00Z`)
  const end = new Date(`${endDate}T00:00:00Z`)
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1)
}

function averageMetric(items, key) {
  if (!items.length) return 0
  const total = items.reduce((sum, item) => sum + Number(item[key] || 0), 0)
  return Number((total / items.length).toFixed(1))
}

function summarizeRankModeForReport(summary = {}, mode = 'organic') {
  const items = Array.isArray(summary.items) ? summary.items : []
  const insights = summary.insights || {}
  return {
    items,
    visibilityScore: Number(insights.visibilityScore || 0),
    rankedCount: items.filter((row) => Number.isInteger(row.position)).length,
    trackedKeywords: items.length,
    top10Count: Number(insights.top10Keywords || 0),
    top3Count: Number(insights.top3Keywords || 0),
    latestDate: insights.latestDate || null,
    moversUp: Array.isArray(insights.moversUp) ? insights.moversUp.slice(0, 8) : [],
    moversDown: Array.isArray(insights.moversDown) ? insights.moversDown.slice(0, 8) : [],
    mode,
  }
}

function formatReportMovementLines(items = [], fallback = '- No movement captured in the current comparison window.') {
  if (!items.length) return fallback
  return items.map((item) => `- ${item.keyword}: ${item.delta > 0 ? `+${item.delta}` : item.delta} (now #${item.position})`).join('\n')
}

function formatMapPackListingLines(items = []) {
  const matched = items
    .filter((item) => Number.isInteger(item.position))
    .sort((left, right) => left.position - right.position || left.keyword.localeCompare(right.keyword))
    .slice(0, 8)

  if (!matched.length) return '- No matched map-pack listings in the current range.'

  return matched.map((item) => {
    const parts = [`#${item.position}`]
    if (item.foundName) parts.push(item.foundName)
    if (item.foundUrl) parts.push(item.foundUrl)
    return `- ${item.keyword}: ${parts.join(' / ')}`
  }).join('\n')
}
