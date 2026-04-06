import { getWorkspaceSettingsMap } from './data.js'
import { clamp, safeJsonParse } from './utils.js'
import { validateCustomDateRange } from './validation.js'
import { groupAuditIssues } from '../../shared/audit.js'
import { DEFAULT_REPORT_SECTION_IDS } from '../../shared/reportSections.js'

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
  const rangeSql = qualifyRankDateSql(range.sql)
  const scopeSql = profileId != null ? ' AND rd.profile_id = ?' : ''
  const scopeParams = profileId != null ? [Number(profileId)] : []
  const latestRow = db.prepare(`
    SELECT MAX(rd.date) AS d
    FROM rank_daily rd
    ${activeRankKeywordJoin()}
    WHERE rd.workspace_id = ? AND ${rangeSql}${scopeSql}
  `)
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
    SELECT MAX(rd.date) AS d
    FROM rank_daily rd
    ${activeRankKeywordJoin()}
    WHERE rd.workspace_id = ? AND ${rangeSql}${scopeSql} AND rd.date < ?
  `
  const prevDate = db.prepare(prevDateQuery)
    .get(...params, ...scopeParams, latestDate)?.d || null

  const latestRows = db.prepare(`
    SELECT rd.keyword, rd.date, rd.${positionColumn} AS position, rd.${urlColumn} AS found_url, ${nameColumn} AS found_name, rd.profile_id, rp.name AS profile_name, rp.slug AS profile_slug
    FROM rank_daily rd
    ${activeRankKeywordJoin()}
    JOIN rank_profiles rp ON rp.id = rd.profile_id
    WHERE rd.workspace_id = ? AND rd.date = ?${profileId != null ? ' AND rd.profile_id = ?' : ''}
    ORDER BY rd.position IS NULL, rd.position ASC, rd.keyword ASC
  `).all(Number(workspaceId), latestDate, ...scopeParams)

  const prevMap = new Map()
  if (prevDate) {
    const prevRows = db.prepare(`
      SELECT rd.keyword, rd.${positionColumn} AS position, rd.profile_id
      FROM rank_daily rd
      ${activeRankKeywordJoin()}
      WHERE rd.workspace_id = ? AND rd.date = ?${profileId != null ? ' AND rd.profile_id = ?' : ''}
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
    SELECT rd.date,
      SUM(CASE WHEN rd.${positionColumn} = 1 THEN 1 ELSE 0 END) AS top1,
      SUM(CASE WHEN rd.${positionColumn} BETWEEN 1 AND 3 THEN 1 ELSE 0 END) AS top3,
      SUM(CASE WHEN rd.${positionColumn} BETWEEN 1 AND 10 THEN 1 ELSE 0 END) AS top10,
      SUM(CASE WHEN rd.${positionColumn} BETWEEN 1 AND 20 THEN 1 ELSE 0 END) AS top20,
      SUM(CASE WHEN rd.${positionColumn} BETWEEN 1 AND 100 THEN 1 ELSE 0 END) AS top100,
      SUM(CASE WHEN rd.${positionColumn} IS NOT NULL THEN 1 ELSE 0 END) AS ranked,
      SUM(CASE WHEN rd.${positionColumn} IS NULL OR rd.${positionColumn} > ${mode === 'mapPack' ? 3 : 100} THEN 1 ELSE 0 END) AS notRanked
    FROM rank_daily rd
    ${activeRankKeywordJoin()}
    WHERE rd.workspace_id = ? AND ${rangeSql}${scopeSql}
    GROUP BY rd.date
    ORDER BY rd.date DESC
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

function activeRankKeywordJoin() {
  return `
    JOIN rank_keywords rk
      ON rk.workspace_id = rd.workspace_id
      AND rk.profile_id = rd.profile_id
      AND rk.keyword = rd.keyword
      AND rk.active = 1
  `
}

function qualifyRankDateSql(sql) {
  return sql === '1=1' ? sql : sql.replace(/^date\b/, 'rd.date')
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
  const sectionsIncluded = Array.isArray(options.sections) && options.sections.length
    ? [...options.sections]
    : [...DEFAULT_REPORT_SECTION_IDS]
  const generatedAt = new Date().toISOString()
  const summary = getWorkspaceSummary(db, workspace.id, { startDate, endDate })
  const rankSummary = getWorkspaceRankSummary(db, workspace.id, { startDate, endDate })
  const mapPackSummary = rankSummary.mapPack || { items: [], insights: { moversUp: [], moversDown: [] } }
  const latestAudit = getLatestSiteAudit(db, workspace.id)
  const groupedFindings = summarizeGroupedFindingsForReport(latestAudit?.issues || [])
  const lighthouseSummary = summarizeLighthouseForReport(latestAudit?.details?.pageSpeed || {})

  const organicMetrics = summarizeRankModeForReport(rankSummary, 'organic')
  const mapPackMetrics = summarizeRankModeForReport(mapPackSummary, 'mapPack')
  const reportHeading = reportType === 'custom'
    ? 'Custom'
    : `${reportType[0].toUpperCase()}${reportType.slice(1)}`
  const headline = buildReportHeadline({
    days,
    latestAudit,
    lighthouseSummary,
    mapPackMetrics,
    organicMetrics,
    summary,
  })
  const nextActions = buildReportNextActions({
    groupedFindings,
    lighthouseSummary,
    latestAudit,
    mapPackMetrics,
    organicMetrics,
    summary,
  })
  const presentation = buildReportPresentation({
    generatedAt,
    groupedFindings,
    headline,
    latestAudit,
    lighthouseSummary,
    mapPackMetrics,
    nextActions,
    organicMetrics,
    reportHeading,
    reportType,
    sectionsIncluded,
    startDate,
    endDate,
    summary,
    workspace,
  })
  const markdown = buildReportMarkdown({
    generatedAt,
    groupedFindings,
    headline,
    latestAudit,
    lighthouseSummary,
    mapPackMetrics,
    nextActions,
    organicMetrics,
    reportHeading,
    sectionsIncluded,
    startDate,
    endDate,
    summary,
    workspace,
  })

  const reportSummary = {
    reportType,
    periodStart: startDate,
    periodEnd: endDate,
    dateRangeLabel: `${startDate} to ${endDate}`,
    sectionsIncluded,
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
    technical: {
      latestAuditDate: latestAudit?.createdAt || null,
      findingsCount: (latestAudit?.issues || []).length,
      groupedFindingsCount: groupedFindings.totalGroups,
      healthScore: latestAudit ? Math.round(latestAudit.healthScore) : null,
      pageSpeed: lighthouseSummary.summary,
    },
    pageSpeed: lighthouseSummary.summary,
    presentation,
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

function buildReportHeadline({ days, latestAudit, lighthouseSummary, mapPackMetrics, organicMetrics, summary }) {
  return [
    `Clicks ${Math.round(summary.gsc.clicks || 0)} and sessions ${Math.round(summary.ga4.sessions || 0)} over the last ${days} days.`,
    `Organic rank coverage: ${organicMetrics.rankedCount}/${organicMetrics.trackedKeywords || 0} keywords ranked, with ${organicMetrics.top10Count} in the top 10.`,
    `Map-pack coverage: ${mapPackMetrics.rankedCount}/${mapPackMetrics.trackedKeywords || 0} tracked keywords matched locally, with ${mapPackMetrics.top3Count} in the top 3.`,
    latestAudit
      ? `Latest technical health score ${Math.round(latestAudit.healthScore)} with ${(latestAudit.issues || []).length} tracked findings.`
      : 'No recent technical audit baseline is available yet.',
    formatLighthouseHeadline(lighthouseSummary),
  ].filter(Boolean).join(' ')
}

function buildReportPresentation({
  generatedAt,
  groupedFindings,
  headline,
  latestAudit,
  lighthouseSummary,
    mapPackMetrics,
    nextActions,
    organicMetrics,
    reportHeading,
    reportType,
    sectionsIncluded,
    startDate,
    endDate,
    summary,
  workspace,
}) {
  const presentation = {
    version: 2,
    meta: {
      title: `${workspace.name} ${reportHeading} SEO Report`,
      workspaceName: workspace.name,
      reportType,
      reportHeading,
      generatedAt,
      periodStart: startDate,
      periodEnd: endDate,
      dateRangeLabel: `${startDate} to ${endDate}`,
      headline,
      sectionsIncluded,
    },
  }

  if (hasReportSection(sectionsIncluded, 'executive')) {
    presentation.executive = {
      headline,
      kpis: buildExecutiveMetrics(summary, organicMetrics, mapPackMetrics, latestAudit),
    }
  }

  if (hasReportSection(sectionsIncluded, 'performance')) {
    presentation.charts = buildPerformanceCharts(summary, organicMetrics)
  }

  if (hasReportSection(sectionsIncluded, 'ads')) {
    presentation.ads = buildAdsPresentation(summary)
  }

  if (hasReportSection(sectionsIncluded, 'rankings')) {
    presentation.rankings = buildRankingsPresentation(organicMetrics, mapPackMetrics)
  }

  if (hasReportSection(sectionsIncluded, 'lighthouse')) {
    presentation.lighthouse = lighthouseSummary
  }

  if (hasReportSection(sectionsIncluded, 'findings')) {
    presentation.groupedFindings = {
      ...groupedFindings,
      latestAuditDate: latestAudit?.createdAt || null,
      healthScore: latestAudit ? Math.round(latestAudit.healthScore) : null,
    }
  }

  if (hasReportSection(sectionsIncluded, 'actions')) {
    presentation.nextActions = nextActions
  }

  return presentation
}

function buildReportMarkdown({
  generatedAt,
  groupedFindings,
  headline,
  latestAudit,
  lighthouseSummary,
  mapPackMetrics,
  nextActions,
  organicMetrics,
  reportHeading,
  sectionsIncluded,
  startDate,
  endDate,
  summary,
  workspace,
}) {
  const parts = [
    `# ${workspace.name} ${reportHeading} SEO Report`,
    `Generated: ${generatedAt}`,
    `Period: ${startDate} to ${endDate}`,
  ]

  if (hasReportSection(sectionsIncluded, 'executive')) {
    parts.push([
      '## Executive Snapshot',
      headline,
      formatMetricListMarkdown(buildExecutiveMetrics(summary, organicMetrics, mapPackMetrics, latestAudit)),
    ].filter(Boolean).join('\n\n'))
  }

  if (hasReportSection(sectionsIncluded, 'performance')) {
    parts.push([
      '## Performance Overview',
      `- Search clicks: ${Math.round(summary.gsc.clicks || 0)}`,
      `- Search impressions: ${Math.round(summary.gsc.impressions || 0)}`,
      `- Search CTR: ${((summary.gsc.ctr || 0) * 100).toFixed(2)}%`,
      `- Sessions: ${Math.round(summary.ga4.sessions || 0)}`,
      `- Users: ${Math.round(summary.ga4.users || 0)}`,
      `- Conversions: ${Math.round(summary.ga4.conversions || 0)}`,
      `- Engagement rate: ${((summary.ga4.engagementRate || 0) * 100).toFixed(2)}%`,
    ].join('\n'))
  }

  if (hasReportSection(sectionsIncluded, 'ads')) {
    parts.push([
      '## Google Ads / Paid Media',
      `- Ad clicks: ${Math.round(summary.ads.clicks || 0)}`,
      `- Ad impressions: ${Math.round(summary.ads.impressions || 0)}`,
      `- Ad CTR: ${((summary.ads.ctr || 0) * 100).toFixed(2)}%`,
      `- Ad conversions: ${Math.round(summary.ads.conversions || 0)}`,
      `- Ad spend: $${Number(summary.ads.cost || 0).toFixed(2)}`,
    ].join('\n'))
  }

  if (hasReportSection(sectionsIncluded, 'rankings')) {
    parts.push([
      '## Rankings Summary',
      '### Organic Search',
      `- Visibility score: ${organicMetrics.visibilityScore}`,
      `- Ranked keywords: ${organicMetrics.rankedCount}/${organicMetrics.trackedKeywords || 0}`,
      `- Top 10 keywords: ${organicMetrics.top10Count}`,
      `- Latest rank date: ${organicMetrics.latestDate || 'n/a'}`,
      `- Narrative: ${organicMetrics.narrative || 'No organic movement captured in the current range.'}`,
      '### Organic winners',
      formatReportMovementLines(organicMetrics.moversUp, '- No positive movers in the current comparison window.'),
      '### Organic decliners',
      formatReportMovementLines(organicMetrics.moversDown, '- No negative movers in the current comparison window.'),
      '### Map Pack',
      `- Map visibility score: ${mapPackMetrics.visibilityScore}`,
      `- Ranked in pack: ${mapPackMetrics.rankedCount}/${mapPackMetrics.trackedKeywords || 0}`,
      `- Top 3 map pack results: ${mapPackMetrics.top3Count}`,
      `- Latest map pack date: ${mapPackMetrics.latestDate || 'n/a'}`,
      `- Narrative: ${mapPackMetrics.narrative || 'No map pack movement captured in the current range.'}`,
      '### Map pack winners',
      formatReportMovementLines(mapPackMetrics.moversUp, '- No positive map-pack movers in the current comparison window.'),
      '### Map pack decliners',
      formatReportMovementLines(mapPackMetrics.moversDown, '- No negative map-pack movers in the current comparison window.'),
      '### Current matched listings',
      formatMapPackListingLines(mapPackMetrics.items),
    ].join('\n\n'))
  }

  if (hasReportSection(sectionsIncluded, 'lighthouse') || hasReportSection(sectionsIncluded, 'findings')) {
    const technicalBlocks = [
      '## Technical SEO',
      `- Latest health score: ${latestAudit ? Math.round(latestAudit.healthScore) : 'n/a'}`,
      `- Latest audit date: ${latestAudit?.createdAt || 'n/a'}`,
      `- Open findings: ${(latestAudit?.issues || []).length}`,
    ]

    if (hasReportSection(sectionsIncluded, 'lighthouse')) {
      technicalBlocks.push(formatLighthouseMarkdown(lighthouseSummary))
    }
    if (hasReportSection(sectionsIncluded, 'findings')) {
      technicalBlocks.push(formatGroupedFindingsMarkdown(groupedFindings))
    }

    parts.push(technicalBlocks.filter(Boolean).join('\n\n'))
  }

  if (hasReportSection(sectionsIncluded, 'actions')) {
    parts.push([
      '## Recommended Next Actions',
      nextActions.map((item) => `- ${item}`).join('\n') || '- Continue monitoring the workspace and maintain the current reporting cadence.',
    ].join('\n\n'))
  }

  return parts.join('\n\n')
}

function buildExecutiveMetrics(summary, organicMetrics, mapPackMetrics, latestAudit) {
  return [
    createReportMetric('Organic visibility', organicMetrics.visibilityScore, { tone: 'accent' }),
    createReportMetric('Map visibility', mapPackMetrics.visibilityScore),
    createReportMetric('Search clicks', Math.round(summary.gsc.clicks || 0)),
    createReportMetric('Sessions', Math.round(summary.ga4.sessions || 0)),
    createReportMetric('Conversions', Math.round(summary.ga4.conversions || 0), { tone: 'warning' }),
    createReportMetric('Health score', latestAudit ? Math.round(latestAudit.healthScore) : null, { tone: latestAudit ? 'subtle' : 'default' }),
  ]
}

function buildPerformanceCharts(summary, organicMetrics) {
  const label = summary?.range?.label || 'Selected range'

  return [
    {
      id: 'search-visibility',
      title: 'Search visibility',
      subtitle: label,
      rows: summary?.gsc?.points || [],
      series: [
        { key: 'clicks', label: 'Clicks', color: '#0f766e' },
        { key: 'impressions', label: 'Impressions', color: '#1d4ed8' },
      ],
    },
    {
      id: 'engagement',
      title: 'Engagement',
      subtitle: label,
      rows: summary?.ga4?.points || [],
      series: [
        { key: 'sessions', label: 'Sessions', color: '#b45309' },
        { key: 'conversions', label: 'Conversions', color: '#059669' },
      ],
    },
    {
      id: 'rankings-movement',
      title: 'Rankings movement',
      subtitle: organicMetrics.latestDate ? `Latest baseline ${organicMetrics.latestDate}` : label,
      rows: organicMetrics.trendRows || [],
      series: [
        { key: 'top10', label: 'Top 10', color: '#7c3aed' },
        { key: 'ranked', label: 'Ranked', color: '#0f172a' },
      ],
    },
  ]
}

function buildAdsPresentation(summary = {}) {
  const label = summary?.range?.label || 'Selected range'

  return {
    title: 'Google Ads / Paid media',
    narrative: 'Paid media metrics are included only when Google Ads reporting is relevant to the client workspace.',
    kpis: [
      createReportMetric('Ad clicks', Math.round(summary?.ads?.clicks || 0), { tone: 'accent' }),
      createReportMetric('Ad impressions', Math.round(summary?.ads?.impressions || 0)),
      createReportMetric('Ad conversions', Math.round(summary?.ads?.conversions || 0), { tone: 'warning' }),
      createReportMetric('Ad spend', Number(summary?.ads?.cost || 0), {
        tone: 'subtle',
        displayValue: `$${Number(summary?.ads?.cost || 0).toFixed(2)}`,
      }),
    ],
    charts: [
      {
        id: 'paid-performance',
        title: 'Paid performance',
        subtitle: label,
        rows: summary?.ads?.points || [],
        series: [
          { key: 'clicks', label: 'Ad clicks', color: '#ea580c' },
          { key: 'conversions', label: 'Ad conversions', color: '#2563eb' },
        ],
      },
    ],
  }
}

function buildRankingsPresentation(organicMetrics, mapPackMetrics) {
  return {
    organic: {
      title: 'Organic search',
      narrative: organicMetrics.narrative || 'No organic movement captured in the current range.',
      latestDate: organicMetrics.latestDate || null,
      metrics: [
        createReportMetric('Visibility score', organicMetrics.visibilityScore, { tone: 'accent' }),
        createReportMetric('Ranked keywords', organicMetrics.rankedCount),
        createReportMetric('Top 10 keywords', organicMetrics.top10Count),
        createReportMetric('Tracked keywords', organicMetrics.trackedKeywords),
      ],
      winners: organicMetrics.moversUp.slice(0, 5),
      decliners: organicMetrics.moversDown.slice(0, 5),
    },
    mapPack: {
      title: 'Map pack',
      narrative: mapPackMetrics.narrative || 'No map pack movement captured in the current range.',
      latestDate: mapPackMetrics.latestDate || null,
      metrics: [
        createReportMetric('Map visibility', mapPackMetrics.visibilityScore, { tone: 'accent' }),
        createReportMetric('Ranked in pack', mapPackMetrics.rankedCount),
        createReportMetric('Top 3 pack', mapPackMetrics.top3Count),
        createReportMetric('Tracked keywords', mapPackMetrics.trackedKeywords),
      ],
      winners: mapPackMetrics.moversUp.slice(0, 5),
      decliners: mapPackMetrics.moversDown.slice(0, 5),
      matchedListings: getCurrentMatchedListings(mapPackMetrics.items),
    },
  }
}

function buildReportNextActions({ groupedFindings, lighthouseSummary, latestAudit, mapPackMetrics, organicMetrics, summary }) {
  const actions = []
  const highAndMediumCount = Number(groupedFindings.counts.high || 0) + Number(groupedFindings.counts.medium || 0)

  if (highAndMediumCount > 0) {
    actions.push(`Address ${highAndMediumCount} high and medium technical findings on revenue-driving pages first.`)
  }
  if (organicMetrics.moversDown.length) {
    actions.push('Review the biggest organic decliners and refresh the pages that slipped from prior winning positions.')
  }
  if ((mapPackMetrics.trackedKeywords || 0) > (mapPackMetrics.rankedCount || 0)) {
    const uncovered = Math.max(0, Number(mapPackMetrics.trackedKeywords || 0) - Number(mapPackMetrics.rankedCount || 0))
    actions.push(`Improve local landing page and GBP alignment for ${uncovered} tracked terms that are not yet holding a pack result.`)
  }
  if ((summary?.gsc?.impressions || 0) > 0 && (summary?.gsc?.ctr || 0) < 0.03) {
    actions.push('Tighten titles and descriptions on high-impression pages with below-target CTR.')
  }
  if (latestAudit && Number(lighthouseSummary?.summary?.mobile?.performance) > 0 && Number(lighthouseSummary.summary.mobile.performance) < 90) {
    actions.push(`Prioritize mobile performance work to lift the Lighthouse performance score from ${Math.round(lighthouseSummary.summary.mobile.performance)}.`)
  }
  if (!actions.length) {
    actions.push('Maintain the current reporting cadence and continue monitoring for new movement or technical regressions.')
  }

  return actions.slice(0, 4)
}

function summarizeGroupedFindingsForReport(issues = []) {
  const counts = issues.reduce((accumulator, issue) => {
    const severity = String(issue?.severity || 'low').toLowerCase()
    accumulator[severity] = Number(accumulator[severity] || 0) + 1
    return accumulator
  }, { high: 0, medium: 0, low: 0 })

  const items = groupAuditIssues(issues)
    .map((issue) => ({
      code: issue.code,
      title: humanizeIssueCode(issue.code),
      severity: issue.severity,
      message: issue.message || '',
      urls: issue.urls || [],
      urlCount: (issue.urls || []).length,
    }))
    .sort((left, right) => {
      const severityDelta = reportSeverityRank(left.severity) - reportSeverityRank(right.severity)
      if (severityDelta !== 0) return severityDelta
      if (right.urlCount !== left.urlCount) return right.urlCount - left.urlCount
      return left.title.localeCompare(right.title)
    })

  return {
    counts,
    totalIssues: issues.length,
    totalGroups: items.length,
    totalUrls: items.reduce((sum, item) => sum + item.urlCount, 0),
    items,
  }
}

function summarizeLighthouseForReport(pageSpeed = {}) {
  const byStrategy = {
    mobile: normalizeLighthouseStrategyForReport('mobile', pageSpeed?.mobile),
    desktop: normalizeLighthouseStrategyForReport('desktop', pageSpeed?.desktop),
  }

  return {
    error: String(pageSpeed?.error || '').trim(),
    strategies: Object.values(byStrategy).filter((item) => item.available),
    summary: {
      error: String(pageSpeed?.error || '').trim(),
      mobile: summarizeLighthouseStrategyPayload(byStrategy.mobile),
      desktop: summarizeLighthouseStrategyPayload(byStrategy.desktop),
    },
  }
}

function normalizeLighthouseStrategyForReport(strategy, payload) {
  const metrics = Array.isArray(payload?.metrics) ? payload.metrics : []
  const available = Boolean(payload && typeof payload === 'object' && (
    metrics.length ||
    payload.reportUrl ||
    Number.isFinite(Number(payload.performance)) ||
    Number.isFinite(Number(payload.seo)) ||
    Number.isFinite(Number(payload.accessibility)) ||
    Number.isFinite(Number(payload.bestPractices))
  ))

  return {
    id: strategy,
    label: strategy === 'desktop' ? 'Desktop' : 'Mobile',
    available,
    reportUrl: String(payload?.reportUrl || ''),
    performance: normalizeLighthouseScore(payload?.performance),
    seo: normalizeLighthouseScore(payload?.seo),
    accessibility: normalizeLighthouseScore(payload?.accessibility),
    bestPractices: normalizeLighthouseScore(payload?.bestPractices),
    metrics: metrics.map((metric) => ({
      id: metric.id,
      title: metric.title,
      displayValue: metric.displayValue || formatLighthouseMetricValue(metric.value, metric.unit),
      description: String(metric.description || '').trim(),
    })),
  }
}

function summarizeLighthouseStrategyPayload(strategy = {}) {
  if (!strategy.available) return null

  return {
    label: strategy.label,
    reportUrl: strategy.reportUrl || '',
    performance: strategy.performance,
    seo: strategy.seo,
    accessibility: strategy.accessibility,
    bestPractices: strategy.bestPractices,
    metrics: strategy.metrics || [],
  }
}

function normalizeLighthouseScore(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function formatLighthouseHeadline(lighthouse = {}) {
  if (!Array.isArray(lighthouse.strategies) || !lighthouse.strategies.length) return ''

  const summary = lighthouse.strategies.map((strategy) => (
    `${strategy.label.toLowerCase()} Lighthouse overview: performance ${formatScoreValue(strategy.performance)}, SEO ${formatScoreValue(strategy.seo)}, accessibility ${formatScoreValue(strategy.accessibility)}, best practices ${formatScoreValue(strategy.bestPractices)}`
  ))

  return `${summary.join('; ')}.`
}

function formatLighthouseMarkdown(lighthouse = {}) {
  const sections = ['### Lighthouse Overview']

  if (lighthouse.error) {
    sections.push(`- PageSpeed note: ${lighthouse.error}`)
  }

  if (!Array.isArray(lighthouse.strategies) || !lighthouse.strategies.length) {
    sections.push('- Lighthouse details are not available for the latest audit.')
    return sections.join('\n\n')
  }

  for (const strategy of lighthouse.strategies) {
    sections.push(formatLighthouseStrategyMarkdown(strategy))
  }

  return sections.join('\n\n')
}

function formatLighthouseStrategyMarkdown(strategy) {
  return [
    `### ${strategy.label} Lighthouse`,
    `- Overview: Performance ${formatScoreValue(strategy.performance)}, SEO ${formatScoreValue(strategy.seo)}, Accessibility ${formatScoreValue(strategy.accessibility)}, Best practices ${formatScoreValue(strategy.bestPractices)}`,
    strategy.reportUrl ? `- Full PageSpeed report: [Open ${strategy.label.toLowerCase()} report](${strategy.reportUrl})` : '- Full PageSpeed report: n/a',
    formatLighthouseMetricLines(strategy.metrics, '- No core metrics captured.'),
  ].filter(Boolean).join('\n')
}

function formatLighthouseMetricLines(metrics = [], fallback = '- No core metrics captured.') {
  if (!metrics.length) return fallback

  return metrics.map((metric) => {
    const description = String(metric.description || '').trim()
    return `- ${metric.title}: ${metric.displayValue}${description ? ` - ${description}` : ''}`
  }).join('\n')
}

function formatLighthouseMetricValue(value, unit = '') {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 'n/a'

  if (unit === 'ms') return `${Math.round(numeric)} ms`
  if (unit === 's') return `${numeric.toFixed(2)} s`
  if (unit === 'bytes') return `${Math.round(numeric)} bytes`
  if (!unit) {
    if (Math.abs(numeric) < 10) return Number(numeric.toFixed(3)).toString()
    return Number(numeric.toFixed(1)).toString()
  }

  return `${numeric} ${unit}`.trim()
}

function formatGroupedFindingsMarkdown(groupedFindings = {}) {
  if (!groupedFindings.items?.length) {
    return '### Grouped Findings\n\n- No grouped audit findings captured yet.'
  }

  const sections = ['### Grouped Findings']

  for (const item of groupedFindings.items) {
    sections.push([
      `### [${String(item.severity || 'low').toUpperCase()}] ${item.title} (${item.urlCount} URLs)`,
      `- Code: ${item.code}`,
      `- Message: ${item.message || 'No description available.'}`,
      ...item.urls.map((url) => `- URL: ${url}`),
    ].join('\n'))
  }

  return sections.join('\n\n')
}

function createReportMetric(label, value, options = {}) {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : null
  return {
    id: options.id || label.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    label,
    tone: options.tone || 'default',
    value: numeric,
    displayValue: options.displayValue || (numeric == null ? 'n/a' : String(numeric)),
  }
}

function formatMetricListMarkdown(metrics = []) {
  return metrics.map((metric) => `- ${metric.label}: ${metric.displayValue}`).join('\n')
}

function getCurrentMatchedListings(items = []) {
  return items
    .filter((item) => Number.isInteger(item.position))
    .sort((left, right) => left.position - right.position || left.keyword.localeCompare(right.keyword))
    .slice(0, 8)
    .map((item) => ({
      keyword: item.keyword,
      position: item.position,
      foundName: item.foundName || '',
      foundUrl: item.foundUrl || '',
    }))
}

function humanizeIssueCode(code = '') {
  return String(code || 'unknown')
    .replaceAll(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function reportSeverityRank(severity = 'low') {
  const normalized = String(severity || 'low').toLowerCase()
  if (normalized === 'high') return 0
  if (normalized === 'medium') return 1
  return 2
}

function hasReportSection(sectionsIncluded = [], sectionId = '') {
  return sectionsIncluded.includes(sectionId)
}

function formatScoreValue(value) {
  return Number.isFinite(Number(value)) ? String(Math.round(Number(value))) : 'n/a'
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
    narrative: String(insights.narrative || '').trim(),
    trendRows: Array.isArray(insights.trendRows) ? insights.trendRows : [],
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
