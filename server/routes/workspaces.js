import express from 'express'

import {
  createRankProfile,
  createScopedSlug,
  getWorkspaceById,
  getWorkspaceSettingsMap,
  initializeWorkspaceDefaults,
  listWorkspaces,
  setWorkspaceSettings,
} from '../lib/data.js'
import { asyncHandler, createError, requireApiScope, requireAuth, requireRole, requireSessionAuth } from '../lib/http.js'
import {
  normalizeCustomerId,
  normalizePropertyId,
  validateAuditEntryUrl,
  validateAuditMaxPages,
  validateRankDomain,
  validateSiteUrl,
  validateWorkspaceName,
} from '../lib/validation.js'
import { WORKSPACE_CREDENTIAL_PROVIDERS, normalizeCredentialLabel } from '../../shared/workspaceCredentialProviders.js'

export function createWorkspaceRouter(context) {
  const router = express.Router()

  router.use(requireAuth)

  router.get('/', requireApiScope('read'), asyncHandler(async (req, res) => {
    res.json({
      items: listWorkspaces(context.db, req.auth.organizationId, {
        workspaceIds: req.auth.allowedWorkspaceIds,
      }),
    })
  }))

  router.post('/', requireSessionAuth, requireRole('owner', 'admin'), asyncHandler(async (req, res) => {
    const name = validateWorkspaceName(req.body?.name)
    const slug = createScopedSlug(context.db, 'workspaces', name, 'workspace', 'organization_id', req.auth.organizationId)
    const result = context.db.prepare(`
      INSERT INTO workspaces (organization_id, name, slug, status)
      VALUES (?, ?, ?, 'active')
    `).run(req.auth.organizationId, name, slug)
    const workspaceId = Number(result.lastInsertRowid)
    initializeWorkspaceDefaults(context.db, workspaceId)
    createRankProfile(context.db, workspaceId, { name: 'Primary Market', locationLabel: '' })
    res.json({ ok: true, id: workspaceId, slug })
  }))

  router.delete('/:workspaceId', requireSessionAuth, requireRole('owner', 'admin'), asyncHandler(async (req, res) => {
    const workspace = requireWorkspace(context, req.auth, req.params.workspaceId)
    const total = context.db.prepare('SELECT COUNT(*) AS count FROM workspaces WHERE organization_id = ?').get(req.auth.organizationId).count
    if (Number(total || 0) <= 1) throw createError(400, 'At least one workspace must remain.')
    context.db.prepare('DELETE FROM workspaces WHERE id = ? AND organization_id = ?').run(workspace.id, req.auth.organizationId)
    res.json({ ok: true })
  }))

  router.get('/:workspaceId', requireApiScope('read'), asyncHandler(async (req, res) => {
    const workspace = requireWorkspace(context, req.auth, req.params.workspaceId)
    res.json({ workspace, settings: getWorkspaceSettingsMap(context.db, workspace.id) })
  }))

  router.get('/:workspaceId/settings', requireApiScope('read'), asyncHandler(async (req, res) => {
    const workspace = requireWorkspace(context, req.auth, req.params.workspaceId)
    res.json(getWorkspaceSettingsMap(context.db, workspace.id))
  }))

  router.patch('/:workspaceId/settings', requireApiScope('write'), asyncHandler(async (req, res) => {
    const workspace = requireWorkspace(context, req.auth, req.params.workspaceId)
    const updates = {}

    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'gscSiteUrl')) updates.gsc_site_url = validateSiteUrl(req.body.gscSiteUrl)
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'ga4PropertyId')) updates.ga4_property_id = normalizePropertyId(req.body.ga4PropertyId)
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'googleAdsCustomerId')) updates.google_ads_customer_id = normalizeCustomerId(req.body.googleAdsCustomerId)
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'rankDomain')) updates.rank_domain = req.body.rankDomain ? validateRankDomain(req.body.rankDomain) : ''
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'auditEntryUrl')) updates.audit_entry_url = validateAuditEntryUrl(req.body.auditEntryUrl)
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'auditMaxPages')) updates.audit_max_pages = String(validateAuditMaxPages(req.body.auditMaxPages, 25))
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'rankGl')) updates.rank_gl = String(req.body.rankGl || 'us')
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'rankHl')) updates.rank_hl = String(req.body.rankHl || 'en')
    for (const provider of WORKSPACE_CREDENTIAL_PROVIDERS) {
      if (Object.prototype.hasOwnProperty.call(req.body || {}, provider.requestField)) {
        updates[provider.settingKey] = normalizeCredentialLabel(req.body?.[provider.requestField])
      }
    }

    setWorkspaceSettings(context.db, workspace.id, updates)
    res.json({ ok: true, settings: getWorkspaceSettingsMap(context.db, workspace.id) })
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
