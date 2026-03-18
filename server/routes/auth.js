import express from 'express'

import { buildAuthPayload, createRankProfile, createScopedSlug, createSession, getMembershipByUserId, getUserByEmail, initializeWorkspaceDefaults } from '../lib/data.js'
import { asyncHandler, createError, createIpRateLimiter, disallowApiTokenAuth, requireAuth, requireSessionAuth } from '../lib/http.js'
import {
  validateDisplayName,
  validateEmail,
  validateOrganizationName,
  validatePassword,
  validateWorkspaceName,
} from '../lib/validation.js'

const DAY_MS = 24 * 60 * 60 * 1000

export function createAuthRouter(context) {
  const router = express.Router()
  const loginRateLimiter = createIpRateLimiter({ key: 'auth-login', windowMs: 15 * 60 * 1000, max: 10 })
  const passwordRateLimiter = createIpRateLimiter({ key: 'auth-password', windowMs: 15 * 60 * 1000, max: 8 })

  router.get('/me', asyncHandler(async (req, res) => {
    if (!req.auth) {
      res.json({ authenticated: false, authType: 'none', publicSignupEnabled: context.config.publicSignupEnabled })
      return
    }

    const payload = req.auth.snapshot()
    res.json({ ...(payload || {}), publicSignupEnabled: context.config.publicSignupEnabled })
  }))

  router.post('/register', disallowApiTokenAuth, asyncHandler(async (req, res) => {
    const existingUsers = context.db.prepare('SELECT COUNT(*) AS count FROM users').get().count
    if (!context.config.publicSignupEnabled && Number(existingUsers || 0) > 0) {
      throw createError(403, 'Public signup is disabled for this deployment.')
    }

    const email = validateEmail(req.body?.email)
    const displayName = validateDisplayName(req.body?.displayName)
    const password = validatePassword(req.body?.password)
    const organizationName = validateOrganizationName(req.body?.organizationName)
    const workspaceName = validateWorkspaceName(req.body?.workspaceName)

    if (getUserByEmail(context.db, email)) {
      throw createError(409, 'An account already exists for that email address.')
    }

    let userId = null
    let organizationId = null
    const tx = context.db.transaction(() => {
      const passwordState = context.security.hashPassword(password)
      const userResult = context.db.prepare(`
        INSERT INTO users (email, display_name, password_hash, password_salt, password_version, status, last_login_at)
        VALUES (?, ?, ?, ?, ?, 'active', datetime('now'))
      `).run(email, displayName, passwordState.hash, passwordState.salt, passwordState.version)
      userId = Number(userResult.lastInsertRowid)

      const organizationSlug = createScopedSlug(context.db, 'organizations', organizationName, 'org')
      const organizationResult = context.db.prepare(`
        INSERT INTO organizations (name, slug, status)
        VALUES (?, ?, 'active')
      `).run(organizationName, organizationSlug)
      organizationId = Number(organizationResult.lastInsertRowid)

      context.db.prepare(`
        INSERT INTO organization_members (organization_id, user_id, role, status)
        VALUES (?, ?, 'owner', 'active')
      `).run(organizationId, userId)

      const workspaceSlug = createScopedSlug(context.db, 'workspaces', workspaceName, 'workspace', 'organization_id', organizationId)
      const workspaceResult = context.db.prepare(`
        INSERT INTO workspaces (organization_id, name, slug, status)
        VALUES (?, ?, ?, 'active')
      `).run(organizationId, workspaceName, workspaceSlug)
      const workspaceId = Number(workspaceResult.lastInsertRowid)

      initializeWorkspaceDefaults(context.db, workspaceId)
      createRankProfile(context.db, workspaceId, { name: 'Primary Market', locationLabel: '' })
    })
    tx()

    issueSession(res, context, userId, organizationId)
  }))

  router.post('/login', disallowApiTokenAuth, loginRateLimiter, asyncHandler(async (req, res) => {
    const email = validateEmail(req.body?.email)
    const password = validatePassword(req.body?.password)
    const user = getUserByEmail(context.db, email)
    if (!user || !context.security.verifyPassword(password, user)) {
      throw createError(401, 'Invalid email or password.')
    }

    const membership = getMembershipByUserId(context.db, user.id)
    if (!membership || membership.status !== 'active') {
      throw createError(403, 'This account does not have an active organization membership.')
    }

    context.db.prepare('UPDATE users SET last_login_at = datetime(\'now\') WHERE id = ?').run(user.id)
    issueSession(res, context, user.id, membership.organization_id)
  }))

  router.post('/logout', requireAuth, requireSessionAuth, asyncHandler(async (req, res) => {
    if (req.sessionTokenHash) {
      context.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(req.sessionTokenHash)
    }

    res.setHeader('Set-Cookie', context.security.clearSessionCookie({ secure: context.config.secureCookies }))
    res.json({ ok: true })
  }))

  router.get('/invite/:token', disallowApiTokenAuth, asyncHandler(async (req, res) => {
    const tokenHash = context.security.hashToken(String(req.params.token || ''))
    const invite = context.db.prepare(`
      SELECT i.id, i.email, i.role, i.expires_at, o.name AS organization_name
      FROM invitations i
      JOIN organizations o ON o.id = i.organization_id
      WHERE i.token_hash = ? AND i.status = 'pending'
    `).get(tokenHash)

    if (!invite || new Date(invite.expires_at).getTime() <= Date.now()) {
      throw createError(404, 'Invite is invalid or expired.')
    }

    res.json({
      email: invite.email,
      role: invite.role,
      organizationName: invite.organization_name,
      expiresAt: invite.expires_at,
    })
  }))

  router.post('/accept-invite', disallowApiTokenAuth, asyncHandler(async (req, res) => {
    const token = String(req.body?.token || '')
    const tokenHash = context.security.hashToken(token)
    const displayName = validateDisplayName(req.body?.displayName)
    const password = validatePassword(req.body?.password)
    const invite = context.db.prepare("SELECT * FROM invitations WHERE token_hash = ? AND status = 'pending'").get(tokenHash)

    if (!invite || new Date(invite.expires_at).getTime() <= Date.now()) {
      throw createError(404, 'Invite is invalid or expired.')
    }

    let user = getUserByEmail(context.db, invite.email)
    let organizationId = invite.organization_id
    const tx = context.db.transaction(() => {
      const passwordState = context.security.hashPassword(password)
      if (!user) {
        const result = context.db.prepare(`
          INSERT INTO users (email, display_name, password_hash, password_salt, password_version, status, last_login_at)
          VALUES (?, ?, ?, ?, ?, 'active', datetime('now'))
        `).run(invite.email, displayName, passwordState.hash, passwordState.salt, passwordState.version)
        user = context.db.prepare('SELECT * FROM users WHERE id = ?').get(Number(result.lastInsertRowid))
      } else {
        const existingMembership = getMembershipByUserId(context.db, user.id)
        if (existingMembership && existingMembership.organization_id !== organizationId) {
          throw createError(409, 'This user is already attached to another organization.')
        }
        context.db.prepare(`
          UPDATE users
          SET display_name = ?, password_hash = ?, password_salt = ?, password_version = ?, last_login_at = datetime('now')
          WHERE id = ?
        `).run(displayName, passwordState.hash, passwordState.salt, passwordState.version, user.id)
      }

      context.db.prepare(`
        INSERT INTO organization_members (organization_id, user_id, role, status)
        VALUES (?, ?, ?, 'active')
        ON CONFLICT(organization_id, user_id) DO UPDATE SET role = excluded.role, status = 'active', joined_at = datetime('now')
      `).run(organizationId, user.id, invite.role)

      context.db.prepare(`
        UPDATE invitations
        SET status = 'accepted', accepted_at = datetime('now')
        WHERE id = ?
      `).run(invite.id)
    })
    tx()

    issueSession(res, context, user.id, organizationId)
  }))

  router.post('/password/request-reset', disallowApiTokenAuth, passwordRateLimiter, asyncHandler(async (req, res) => {
    const email = validateEmail(req.body?.email)
    const user = getUserByEmail(context.db, email)
    if (!user) {
      res.json({ ok: true })
      return
    }

    const token = context.security.createOpaqueToken()
    const tokenHash = context.security.hashToken(token)
    const expiresAt = new Date(Date.now() + (60 * 60 * 1000)).toISOString()
    context.db.prepare(`
      INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, created_at)
      VALUES (?, ?, ?, datetime('now'))
    `).run(user.id, tokenHash, expiresAt)

    const resetUrl = `${context.config.webOrigin}/reset-password?token=${encodeURIComponent(token)}`
    res.json({ ok: true, delivery: 'preview', resetUrl })
  }))

  router.post('/password/reset', disallowApiTokenAuth, passwordRateLimiter, asyncHandler(async (req, res) => {
    const tokenHash = context.security.hashToken(String(req.body?.token || ''))
    const password = validatePassword(req.body?.password)
    const resetToken = context.db.prepare(`
      SELECT *
      FROM password_reset_tokens
      WHERE token_hash = ? AND used_at IS NULL
      ORDER BY id DESC
      LIMIT 1
    `).get(tokenHash)

    if (!resetToken || new Date(resetToken.expires_at).getTime() <= Date.now()) {
      throw createError(404, 'Reset token is invalid or expired.')
    }

    const passwordState = context.security.hashPassword(password)
    context.db.prepare(`
      UPDATE users
      SET password_hash = ?, password_salt = ?, password_version = ?
      WHERE id = ?
    `).run(passwordState.hash, passwordState.salt, passwordState.version, resetToken.user_id)
    context.db.prepare('UPDATE password_reset_tokens SET used_at = datetime(\'now\') WHERE id = ?').run(resetToken.id)
    res.json({ ok: true })
  }))

  return router
}

function issueSession(res, context, userId, organizationId) {
  const token = context.security.createOpaqueToken()
  const expiresAt = new Date(Date.now() + (context.config.sessionDays * DAY_MS)).toISOString()
  createSession(context.db, {
    tokenHash: context.security.hashToken(token),
    userId,
    organizationId,
    expiresAt,
  })

  const payload = buildAuthPayload(context.db, context.security, userId)
  res.setHeader('Set-Cookie', context.security.serializeSessionCookie(token, {
    maxAgeSeconds: context.config.sessionDays * 24 * 60 * 60,
    secure: context.config.secureCookies,
  }))
  res.json({ ...payload, publicSignupEnabled: context.config.publicSignupEnabled })
}

