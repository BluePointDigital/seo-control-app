import express from 'express'

import {
  createJob,
  createRankProfile,
  deleteRankKeyword,
  deleteRankProfile,
  getOrCreatePrimaryRankProfile,
  getRankProfileById,
  getWorkspaceById,
  getWorkspaceSetting,
  listRankKeywords,
  listRankProfiles,
  listWorkspaceAlerts,
  listWorkspaceJobs,
  setWorkspaceSettings,
  updateJob,
  updateRankProfile,
  upsertRankKeyword,
} from '../lib/data.js'
import { asyncHandler, createError, requireApiScope, requireAuth } from '../lib/http.js'
import { runWorkspaceAudit, runWorkspaceSync } from '../lib/integrations.js'
import {
  createWorkspaceReport,
  getCompetitorOverlap,
  getLatestSiteAudit,
  getReportById,
  getSiteAuditDiff,
  getSiteAuditHistory,
  getWorkspaceRankSummary,
  getWorkspaceSummary,
  listReportHistory,
} from '../lib/operations.js'
import {
  validateAlertStatus,
  validateAuditEntryUrl,
  validateAuditMaxPages,
  validateCompetitorDomain,
  validateKeyword,
  validateKeywordIntent,
  validateKeywordPriority,
  validateLandingPageHint,
  validateRankDomain,
  validateRankProfileDevice,
  validateRankProfileName,
  validateRankSyncFrequency,
  validateRankSyncHour,
  validateRankSyncWeekday,
  validateReportType,
  validateSyncSource,
} from '../lib/validation.js'

export function createOperationsRouter(context) {
  const router = express.Router()

  router.use(requireAuth)

  router.get('/:workspaceId/jobs', requireApiScope('read'), asyncHandler(async (req, res) => {
    const workspace = requireWorkspace(context, req.auth, req.params.workspaceId)
    res.json({ items: listWorkspaceJobs(context.db, req.auth.organizationId, workspace.id) })
  }))

  router.post('/:workspaceId/jobs/run-sync', requireApiScope('run'), asyncHandler(async (req, res) => {
    const workspace = requireWorkspace(context, req.auth, req.params.workspaceId)
    const source = validateSyncSource(req.body?.source || 'all')
    const profileId = req.body?.profileId == null || req.body?.profileId === '' ? null : Number(req.body.profileId)
    if (profileId != null) requireProfile(context, workspace.id, profileId)

    const jobId = createJob(context.db, {
      organizationId: req.auth.organizationId,
      workspaceId: workspace.id,
      triggeredByUserId: req.auth.authType === 'session' ? req.auth.userId : null,
      triggeredByApiTokenId: req.auth.authType === 'api_token' ? req.auth.tokenId : null,
      jobType: 'workspace_sync',
      details: { source, profileId },
    })

    try {
      const result = await runWorkspaceSync(context, workspace, { source, profileId })
      updateJob(context.db, jobId, 'completed', { source, profileId, result })
      res.json({ ok: true, jobId, result })
    } catch (error) {
      updateJob(context.db, jobId, 'failed', { source, profileId, error: error.message })
      throw error
    }
  }))

  router.get('/:workspaceId/summary', requireApiScope('read'), asyncHandler(async (req, res) => {
    const workspace = requireWorkspace(context, req.auth, req.params.workspaceId)
    res.json(getWorkspaceSummary(context.db, workspace.id, req.query))
  }))

  router.get('/:workspaceId/rank/config', requireApiScope('read'), asyncHandler(async (req, res) => {
    const workspace = requireWorkspace(context, req.auth, req.params.workspaceId)
    res.json({
      domain: getWorkspaceSetting(context.db, workspace.id, 'rank_domain'),
      gl: getWorkspaceSetting(context.db, workspace.id, 'rank_gl', 'us'),
      hl: getWorkspaceSetting(context.db, workspace.id, 'rank_hl', 'en'),
      frequency: getWorkspaceSetting(context.db, workspace.id, 'rank_sync_frequency', 'weekly'),
      weekday: Number(getWorkspaceSetting(context.db, workspace.id, 'rank_sync_weekday', '1') || 1),
      hour: Number(getWorkspaceSetting(context.db, workspace.id, 'rank_sync_hour', '6') || 6),
      lastAttemptedAt: getWorkspaceSetting(context.db, workspace.id, 'rank_sync_last_attempted_at') || null,
      lastCompletedAt: getWorkspaceSetting(context.db, workspace.id, 'rank_sync_last_completed_at') || null,
      lastStatus: getWorkspaceSetting(context.db, workspace.id, 'rank_sync_last_status') || 'idle',
      lastError: getWorkspaceSetting(context.db, workspace.id, 'rank_sync_last_error') || '',
    })
  }))

  router.patch('/:workspaceId/rank/config', requireApiScope('write'), asyncHandler(async (req, res) => {
    const workspace = requireWorkspace(context, req.auth, req.params.workspaceId)
    const updates = {}

    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'domain')) updates.rank_domain = req.body.domain ? validateRankDomain(req.body.domain) : ''
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'gl')) updates.rank_gl = String(req.body.gl || 'us')
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'hl')) updates.rank_hl = String(req.body.hl || 'en')
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'frequency')) updates.rank_sync_frequency = validateRankSyncFrequency(req.body.frequency)
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'weekday')) updates.rank_sync_weekday = String(validateRankSyncWeekday(req.body.weekday))
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'hour')) updates.rank_sync_hour = String(validateRankSyncHour(req.body.hour))

    setWorkspaceSettings(context.db, workspace.id, updates)
    res.json({ ok: true })
  }))

  router.get('/:workspaceId/rank/profiles', requireApiScope('read'), asyncHandler(async (req, res) => {
    const workspace = requireWorkspace(context, req.auth, req.params.workspaceId)
    res.json({ items: listRankProfiles(context.db, workspace.id) })
  }))

  router.post('/:workspaceId/rank/profiles', requireApiScope('write'), asyncHandler(async (req, res) => {
    const workspace = requireWorkspace(context, req.auth, req.params.workspaceId)
    const item = createRankProfile(context.db, workspace.id, {
      name: validateRankProfileName(req.body?.name),
      locationLabel: String(req.body?.locationLabel || '').trim().slice(0, 120),
      gl: String(req.body?.gl || getWorkspaceSetting(context.db, workspace.id, 'rank_gl', 'us') || 'us'),
      hl: String(req.body?.hl || getWorkspaceSetting(context.db, workspace.id, 'rank_hl', 'en') || 'en'),
      device: validateRankProfileDevice(req.body?.device || 'desktop'),
      active: req.body?.active !== false,
    })
    res.json({ ok: true, item })
  }))

  router.patch('/:workspaceId/rank/profiles/:profileId', requireApiScope('write'), asyncHandler(async (req, res) => {
    const workspace = requireWorkspace(context, req.auth, req.params.workspaceId)
    const profile = requireProfile(context, workspace.id, req.params.profileId)
    const item = updateRankProfile(context.db, workspace.id, profile.id, {
      name: Object.prototype.hasOwnProperty.call(req.body || {}, 'name') ? validateRankProfileName(req.body?.name) : profile.name,
      locationLabel: Object.prototype.hasOwnProperty.call(req.body || {}, 'locationLabel') ? String(req.body?.locationLabel || '').trim().slice(0, 120) : profile.locationLabel,
      gl: Object.prototype.hasOwnProperty.call(req.body || {}, 'gl') ? String(req.body?.gl || 'us') : profile.gl,
      hl: Object.prototype.hasOwnProperty.call(req.body || {}, 'hl') ? String(req.body?.hl || 'en') : profile.hl,
      device: Object.prototype.hasOwnProperty.call(req.body || {}, 'device') ? validateRankProfileDevice(req.body?.device) : profile.device,
      active: Object.prototype.hasOwnProperty.call(req.body || {}, 'active') ? Boolean(req.body?.active) : profile.active,
    })
    res.json({ ok: true, item })
  }))

  router.delete('/:workspaceId/rank/profiles/:profileId', requireApiScope('write'), asyncHandler(async (req, res) => {
    const workspace = requireWorkspace(context, req.auth, req.params.workspaceId)
    requireProfile(context, workspace.id, req.params.profileId)
    const profileCount = listRankProfiles(context.db, workspace.id).length
    if (profileCount <= 1) throw createError(400, 'At least one rank profile must remain.')
    deleteRankProfile(context.db, workspace.id, Number(req.params.profileId))
    res.json({ ok: true })
  }))

  router.get('/:workspaceId/rank/keywords', requireApiScope('read'), asyncHandler(async (req, res) => {
    const workspace = requireWorkspace(context, req.auth, req.params.workspaceId)
    const profileId = req.query.profileId == null || req.query.profileId === '' ? null : Number(req.query.profileId)
    if (profileId != null) requireProfile(context, workspace.id, profileId)
    res.json({ items: listRankKeywords(context.db, workspace.id, { profileId }) })
  }))

  router.post('/:workspaceId/rank/keywords', requireApiScope('write'), asyncHandler(async (req, res) => {
    const workspace = requireWorkspace(context, req.auth, req.params.workspaceId)
    const profileId = req.body?.profileId == null || req.body?.profileId === ''
      ? getOrCreatePrimaryRankProfile(context.db, workspace.id)
      : requireProfile(context, workspace.id, req.body.profileId).id
    upsertRankKeyword(context.db, workspace.id, {
      profileId,
      keyword: validateKeyword(req.body?.keyword),
      landingPage: validateLandingPageHint(req.body?.landingPage || ''),
      intent: validateKeywordIntent(req.body?.intent || ''),
      priority: validateKeywordPriority(req.body?.priority || 'medium'),
      active: req.body?.active !== false,
    })
    res.json({ ok: true })
  }))

  router.post('/:workspaceId/rank/keywords/bulk', requireApiScope('write'), asyncHandler(async (req, res) => {
    const workspace = requireWorkspace(context, req.auth, req.params.workspaceId)
    const items = Array.isArray(req.body?.items) ? req.body.items : []
    if (!items.length) throw createError(400, 'Provide at least one keyword.')
    const profileId = req.body?.profileId == null || req.body?.profileId === ''
      ? getOrCreatePrimaryRankProfile(context.db, workspace.id)
      : requireProfile(context, workspace.id, req.body.profileId).id

    for (const item of items) {
      upsertRankKeyword(context.db, workspace.id, {
        profileId,
        keyword: validateKeyword(item?.keyword),
        landingPage: validateLandingPageHint(item?.landingPage || ''),
        intent: validateKeywordIntent(item?.intent || ''),
        priority: validateKeywordPriority(item?.priority || 'medium'),
        active: item?.active !== false,
      })
    }

    res.json({ ok: true, count: items.length })
  }))

  router.get('/:workspaceId/rank/profiles/:profileId/keywords', requireApiScope('read'), asyncHandler(async (req, res) => {
    const workspace = requireWorkspace(context, req.auth, req.params.workspaceId)
    const profile = requireProfile(context, workspace.id, req.params.profileId)
    res.json({ items: listRankKeywords(context.db, workspace.id, { profileId: profile.id }) })
  }))

  router.post('/:workspaceId/rank/profiles/:profileId/keywords', requireApiScope('write'), asyncHandler(async (req, res) => {
    const workspace = requireWorkspace(context, req.auth, req.params.workspaceId)
    const profile = requireProfile(context, workspace.id, req.params.profileId)
    upsertRankKeyword(context.db, workspace.id, {
      profileId: profile.id,
      keyword: validateKeyword(req.body?.keyword),
      landingPage: validateLandingPageHint(req.body?.landingPage || ''),
      intent: validateKeywordIntent(req.body?.intent || ''),
      priority: validateKeywordPriority(req.body?.priority || 'medium'),
      active: req.body?.active !== false,
    })
    res.json({ ok: true })
  }))

  router.delete('/:workspaceId/rank/keywords/:keywordId', requireApiScope('write'), asyncHandler(async (req, res) => {
    const workspace = requireWorkspace(context, req.auth, req.params.workspaceId)
    deleteRankKeyword(context.db, workspace.id, req.params.keywordId)
    res.json({ ok: true })
  }))

  router.get('/:workspaceId/rank/summary', requireApiScope('read'), asyncHandler(async (req, res) => {
    const workspace = requireWorkspace(context, req.auth, req.params.workspaceId)
    if (req.query.profileId != null && req.query.profileId !== '') requireProfile(context, workspace.id, req.query.profileId)
    res.json(getWorkspaceRankSummary(context.db, workspace.id, req.query))
  }))

  router.get('/:workspaceId/alerts', requireApiScope('read'), asyncHandler(async (req, res) => {
    const workspace = requireWorkspace(context, req.auth, req.params.workspaceId)
    const status = req.query.status ? validateAlertStatus(req.query.status) : ''
    const profileId = req.query.profileId == null || req.query.profileId === '' ? null : Number(req.query.profileId)
    if (profileId != null) requireProfile(context, workspace.id, profileId)
    res.json({
      items: listWorkspaceAlerts(context.db, req.auth.organizationId, workspace.id, {
        status,
        profileId,
        limit: Number(req.query.limit || 30),
      }),
    })
  }))

  router.get('/:workspaceId/audit/latest', requireApiScope('read'), asyncHandler(async (req, res) => {
    const workspace = requireWorkspace(context, req.auth, req.params.workspaceId)
    res.json({ item: getLatestSiteAudit(context.db, workspace.id) })
  }))

  router.get('/:workspaceId/audit/history', requireApiScope('read'), asyncHandler(async (req, res) => {
    const workspace = requireWorkspace(context, req.auth, req.params.workspaceId)
    res.json({ items: getSiteAuditHistory(context.db, workspace.id, Number(req.query.limit || 8)) })
  }))

  router.get('/:workspaceId/audit/diff', requireApiScope('read'), asyncHandler(async (req, res) => {
    const workspace = requireWorkspace(context, req.auth, req.params.workspaceId)
    res.json(getSiteAuditDiff(context.db, workspace.id))
  }))

  router.post('/:workspaceId/audit/run', requireApiScope('run'), asyncHandler(async (req, res) => {
    const workspace = requireWorkspace(context, req.auth, req.params.workspaceId)
    const storedEntryUrl = getWorkspaceSetting(context.db, workspace.id, 'audit_entry_url')
    const storedMaxPages = getWorkspaceSetting(context.db, workspace.id, 'audit_max_pages', '25')
    const entryUrl = Object.prototype.hasOwnProperty.call(req.body || {}, 'entryUrl')
      ? validateAuditEntryUrl(req.body?.entryUrl)
      : storedEntryUrl
    const maxPages = validateAuditMaxPages(
      Object.prototype.hasOwnProperty.call(req.body || {}, 'maxPages') ? req.body?.maxPages : storedMaxPages,
      25,
    )

    setWorkspaceSettings(context.db, workspace.id, {
      audit_entry_url: entryUrl,
      audit_max_pages: String(maxPages),
    })

    const jobId = createJob(context.db, {
      organizationId: req.auth.organizationId,
      workspaceId: workspace.id,
      triggeredByUserId: req.auth.authType === 'session' ? req.auth.userId : null,
      triggeredByApiTokenId: req.auth.authType === 'api_token' ? req.auth.tokenId : null,
      jobType: 'site_audit',
      details: { entryUrl, maxPages },
    })

    try {
      const item = await runWorkspaceAudit(context, workspace, { entryUrl, maxPages })
      updateJob(context.db, jobId, 'completed', { item })
      res.json({ ok: true, jobId, item })
    } catch (error) {
      updateJob(context.db, jobId, 'failed', { entryUrl, maxPages, error: error.message })
      throw error
    }
  }))

  router.get('/:workspaceId/competitors', requireApiScope('read'), asyncHandler(async (req, res) => {
    const workspace = requireWorkspace(context, req.auth, req.params.workspaceId)
    const items = context.db.prepare(`
      SELECT id, domain, created_at
      FROM workspace_competitors
      WHERE workspace_id = ?
      ORDER BY domain COLLATE NOCASE
    `).all(workspace.id).map((row) => ({
      id: row.id,
      domain: row.domain,
      createdAt: row.created_at,
    }))
    res.json({ items })
  }))

  router.post('/:workspaceId/competitors', requireApiScope('write'), asyncHandler(async (req, res) => {
    const workspace = requireWorkspace(context, req.auth, req.params.workspaceId)
    const domain = validateCompetitorDomain(req.body?.domain)
    context.db.prepare('INSERT OR IGNORE INTO workspace_competitors (workspace_id, domain) VALUES (?, ?)').run(workspace.id, domain)
    res.json({ ok: true })
  }))

  router.delete('/:workspaceId/competitors/:competitorId', requireApiScope('write'), asyncHandler(async (req, res) => {
    const workspace = requireWorkspace(context, req.auth, req.params.workspaceId)
    context.db.prepare('DELETE FROM workspace_competitors WHERE workspace_id = ? AND id = ?').run(workspace.id, Number(req.params.competitorId))
    res.json({ ok: true })
  }))

  router.get('/:workspaceId/competitors/overlap', requireApiScope('read'), asyncHandler(async (req, res) => {
    const workspace = requireWorkspace(context, req.auth, req.params.workspaceId)
    res.json(getCompetitorOverlap(context.db, workspace.id))
  }))

  router.post('/:workspaceId/reports/generate', requireApiScope('run'), asyncHandler(async (req, res) => {
    const workspace = requireWorkspace(context, req.auth, req.params.workspaceId)
    const reportType = validateReportType(req.body?.type || 'weekly')
    const jobId = createJob(context.db, {
      organizationId: req.auth.organizationId,
      workspaceId: workspace.id,
      triggeredByUserId: req.auth.authType === 'session' ? req.auth.userId : null,
      triggeredByApiTokenId: req.auth.authType === 'api_token' ? req.auth.tokenId : null,
      jobType: 'report_generate',
      details: { reportType },
    })

    try {
      const result = createWorkspaceReport(context.db, workspace, reportType, {
        startDate: req.body?.startDate,
        endDate: req.body?.endDate,
      })
      updateJob(context.db, jobId, 'completed', result)
      res.json({ ok: true, jobId, ...result })
    } catch (error) {
      updateJob(context.db, jobId, 'failed', { reportType, error: error.message })
      throw error
    }
  }))

  router.get('/:workspaceId/reports/history', requireApiScope('read'), asyncHandler(async (req, res) => {
    const workspace = requireWorkspace(context, req.auth, req.params.workspaceId)
    res.json({ items: listReportHistory(context.db, workspace.id) })
  }))

  router.get('/:workspaceId/reports/:reportId', requireApiScope('read'), asyncHandler(async (req, res) => {
    const workspace = requireWorkspace(context, req.auth, req.params.workspaceId)
    const report = getReportById(context.db, workspace.id, req.params.reportId)
    if (!report) throw createError(404, 'Report not found.')
    res.json(report)
  }))

  return router
}

function requireWorkspace(context, auth, workspaceId) {
  const workspace = getWorkspaceById(context.db, auth.organizationId, Number(workspaceId), {
    workspaceIds: auth.allowedWorkspaceIds,
  })
  if (!workspace) throw createError(404, 'Workspace not found.')
  return workspace
}

function requireProfile(context, workspaceId, profileId) {
  const profile = getRankProfileById(context.db, workspaceId, Number(profileId))
  if (!profile) throw createError(404, 'Rank profile not found.')
  return profile
}
