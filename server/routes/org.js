import express from 'express'

import {
  createApiToken,
  deleteOrgCredential,
  getWorkspaceById,
  listOrgCredentials,
  listApiTokens,
  listOrganizationAlerts,
  revokeApiToken,
  updateWorkspaceAlertStatus,
  upsertOrgCredential,
} from '../lib/data.js'
import { asyncHandler, createError, requireAuth, requireRole, requireSessionAuth } from '../lib/http.js'
import {
  disconnectGoogle,
  exchangeGoogleCallback,
  generateGoogleAuthUrl,
  getGoogleStatus,
  listAdsCustomers,
  listGa4Properties,
  listGscSites,
} from '../lib/integrations.js'
import { getPortfolioSummary } from '../lib/operations.js'
import {
  validateAlertStatus,
  validateApiTokenExpiry,
  validateApiTokenLabel,
  validateApiTokenScopes,
  validateApiTokenWorkspaceIds,
  validateEmail,
  validateOrganizationName,
  validateRole,
} from '../lib/validation.js'
import { normalizeCredentialLabel } from '../../shared/workspaceCredentialProviders.js'

export function createOrgRouter(context) {
  const router = express.Router()

  router.get('/google/callback', asyncHandler(async (req, res) => {
    try {
      await exchangeGoogleCallback(context, req.query.code, req.query.state)
      res.redirect(`${context.config.webOrigin}/app/settings/organization?connected=google`)
    } catch (error) {
      res.redirect(`${context.config.webOrigin}/app/settings/organization?error=${encodeURIComponent(error.message)}`)
    }
  }))

  router.use(requireAuth, requireSessionAuth)

  router.get('/', asyncHandler(async (req, res) => {
    const organization = context.db.prepare('SELECT id, name, slug, status, created_at FROM organizations WHERE id = ?').get(req.auth.organizationId)
    res.json({
      organization: {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        status: organization.status,
        createdAt: organization.created_at,
      },
      role: req.auth.role,
      google: getGoogleStatus(context, req.auth.organizationId),
    })
  }))

  router.patch('/', requireRole('owner', 'admin'), asyncHandler(async (req, res) => {
    const name = validateOrganizationName(req.body?.name)
    context.db.prepare('UPDATE organizations SET name = ? WHERE id = ?').run(name, req.auth.organizationId)
    res.json({ ok: true })
  }))

  router.get('/portfolio', asyncHandler(async (req, res) => {
    res.json(getPortfolioSummary(context.db, req.auth.organizationId, req.query))
  }))

  router.get('/alerts', asyncHandler(async (req, res) => {
    const status = req.query.status ? validateAlertStatus(req.query.status) : ''
    const workspaceId = req.query.workspaceId == null || req.query.workspaceId === '' ? null : Number(req.query.workspaceId)
    res.json({
      items: listOrganizationAlerts(context.db, req.auth.organizationId, {
        status,
        workspaceId,
        limit: Number(req.query.limit || 60),
      }),
    })
  }))

  router.patch('/alerts/:alertId', asyncHandler(async (req, res) => {
    const status = validateAlertStatus(req.body?.status || 'resolved')
    const updated = updateWorkspaceAlertStatus(context.db, req.auth.organizationId, req.params.alertId, status)
    if (!updated) throw createError(404, 'Alert not found.')
    res.json({ ok: true })
  }))

  router.get('/members', asyncHandler(async (_req, res) => {
    const items = context.db.prepare(`
      SELECT u.id, u.email, u.display_name, u.status, u.last_login_at, om.role, om.joined_at
      FROM organization_members om
      JOIN users u ON u.id = om.user_id
      WHERE om.organization_id = ?
      ORDER BY CASE om.role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.display_name COLLATE NOCASE
    `).all(_req.auth.organizationId).map((row) => ({
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      status: row.status,
      lastLoginAt: row.last_login_at || null,
      role: row.role,
      joinedAt: row.joined_at,
    }))
    res.json({ items })
  }))

  router.get('/invitations', asyncHandler(async (req, res) => {
    const items = context.db.prepare(`
      SELECT id, email, role, status, expires_at, accepted_at, created_at
      FROM invitations
      WHERE organization_id = ?
      ORDER BY id DESC
    `).all(req.auth.organizationId).map((row) => ({
      id: row.id,
      email: row.email,
      role: row.role,
      status: row.status,
      expiresAt: row.expires_at,
      acceptedAt: row.accepted_at || null,
      createdAt: row.created_at,
    }))
    res.json({ items })
  }))

  router.post('/invitations', requireRole('owner', 'admin'), asyncHandler(async (req, res) => {
    const email = validateEmail(req.body?.email)
    const role = validateRole(req.body?.role || 'member')
    const token = context.security.createOpaqueToken()
    const tokenHash = context.security.hashToken(token)
    const expiresAt = new Date(Date.now() + (7 * 24 * 60 * 60 * 1000)).toISOString()

    context.db.prepare(`
      INSERT INTO invitations (organization_id, email, role, token_hash, invited_by_user_id, expires_at, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', datetime('now'))
    `).run(req.auth.organizationId, email, role, tokenHash, req.auth.userId, expiresAt)

    const acceptUrl = `${context.config.webOrigin}/accept-invite?token=${encodeURIComponent(token)}`
    res.json({ ok: true, delivery: 'preview', acceptUrl, email, role, expiresAt })
  }))

  router.get('/credentials', asyncHandler(async (req, res) => {
    res.json({ items: listOrgCredentials(context.db, context.security, req.auth.organizationId) })
  }))

  router.get('/api-tokens', requireRole('owner', 'admin'), asyncHandler(async (req, res) => {
    res.json({ items: listApiTokens(context.db, req.auth.organizationId) })
  }))

  router.post('/api-tokens', requireRole('owner', 'admin'), asyncHandler(async (req, res) => {
    const label = validateApiTokenLabel(req.body?.label)
    const scopes = validateApiTokenScopes(req.body?.scopes)
    const workspaceIds = validateApiTokenWorkspaceIds(req.body?.workspaceIds)
    const requestedExpiry = Object.prototype.hasOwnProperty.call(req.body || {}, 'expiresAt')
      ? req.body.expiresAt
      : new Date(Date.now() + (90 * 24 * 60 * 60 * 1000)).toISOString()
    const expiresAt = validateApiTokenExpiry(requestedExpiry)

    for (const workspaceId of workspaceIds) {
      if (!getWorkspaceById(context.db, req.auth.organizationId, workspaceId)) {
        throw createError(404, 'One or more selected workspaces were not found.')
      }
    }

    const { token, tokenPrefix } = context.security.createApiTokenValue()
    const item = createApiToken(context.db, {
      organizationId: req.auth.organizationId,
      label,
      tokenPrefix,
      tokenHash: context.security.hashToken(token),
      scopes,
      workspaceIds,
      expiresAt,
      createdByUserId: req.auth.userId,
    })

    res.json({ ok: true, token, item })
  }))

  router.post('/api-tokens/:tokenId/revoke', requireRole('owner', 'admin'), asyncHandler(async (req, res) => {
    const revoked = revokeApiToken(context.db, req.auth.organizationId, req.params.tokenId)
    if (!revoked) throw createError(404, 'API token not found.')
    res.json({ ok: true })
  }))

  router.post('/credentials', requireRole('owner', 'admin'), asyncHandler(async (req, res) => {
    const provider = String(req.body?.provider || '').trim()
    const label = String(req.body?.label || 'default').trim() || 'default'
    const value = String(req.body?.value || '').trim()
    if (!provider || !value) throw createError(400, 'Provider and value are required.')
    upsertOrgCredential(context.db, context.security, req.auth.organizationId, { provider, label, value, metadata: req.body?.metadata || {} })
    res.json({ ok: true })
  }))

  router.delete('/credentials/:id', requireRole('owner', 'admin'), asyncHandler(async (req, res) => {
    deleteOrgCredential(context.db, req.auth.organizationId, req.params.id)
    res.json({ ok: true })
  }))

  router.get('/google/status', asyncHandler(async (req, res) => {
    res.json(getGoogleStatus(context, req.auth.organizationId))
  }))

  router.get('/google/connect/start', requireRole('owner', 'admin'), asyncHandler(async (req, res) => {
    res.json(generateGoogleAuthUrl(context, req.auth.organizationId, req.auth.userId))
  }))

  router.post('/google/disconnect', requireRole('owner', 'admin'), asyncHandler(async (req, res) => {
    disconnectGoogle(context, req.auth.organizationId)
    res.json({ ok: true })
  }))

  router.get('/google/assets/gsc-sites', asyncHandler(async (req, res) => {
    res.json(await buildAssetResponse(() => listGscSites(context, req.auth.organizationId)))
  }))

  router.get('/google/assets/ga4-properties', asyncHandler(async (req, res) => {
    res.json(await buildAssetResponse(() => listGa4Properties(context, req.auth.organizationId)))
  }))

  router.get('/google/assets/ads-customers', asyncHandler(async (req, res) => {
    const workspaceId = req.query.workspaceId == null || req.query.workspaceId === '' ? null : Number(req.query.workspaceId)
    const workspace = workspaceId == null ? null : getWorkspaceById(context.db, req.auth.organizationId, workspaceId)
    if (workspaceId != null && !workspace) {
      throw createError(404, 'Workspace not found.')
    }

    const credentialLabel = Object.prototype.hasOwnProperty.call(req.query || {}, 'credentialLabel')
      ? normalizeCredentialLabel(req.query.credentialLabel)
      : undefined

    res.json(await buildAssetResponse(() => listAdsCustomers(context, req.auth.organizationId, {
      workspace,
      credentialLabel,
    })))
  }))

  return router
}

async function buildAssetResponse(loadItems) {
  try {
    const items = await loadItems()
    return {
      items,
      availability: {
        state: 'ready',
        message: items.length ? '' : 'No assets were returned for this connection.',
      },
    }
  } catch (error) {
    return {
      items: [],
      availability: resolveAssetAvailability(error),
    }
  }
}

function resolveAssetAvailability(error) {
  const message = String(error?.message || 'Provider request failed.')

  if (/not connected/i.test(message) || /Reconnect Google/i.test(message)) {
    return {
      state: 'missing_google_connection',
      message: 'Connect Google at the organization level before loading assets.',
    }
  }

  if (/developer token/i.test(message)) {
    return {
      state: 'missing_ads_developer_token',
      message,
    }
  }

  return {
    state: 'provider_error',
    message,
  }
}
