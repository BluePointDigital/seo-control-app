import { maskSecret, safeJsonParse, slugify } from './utils.js'
import { DEFAULT_CREDENTIAL_LABEL, normalizeCredentialLabel } from '../../shared/workspaceCredentialProviders.js'

export const DEFAULT_WORKSPACE_SETTINGS = {
  rank_gl: 'us',
  rank_hl: 'en',
  rank_sync_frequency: 'weekly',
  rank_sync_weekday: '1',
  rank_sync_hour: '6',
  audit_max_pages: '25',
  rank_api_credential_label: DEFAULT_CREDENTIAL_LABEL,
  google_pagespeed_api_label: DEFAULT_CREDENTIAL_LABEL,
  google_ads_developer_token_label: DEFAULT_CREDENTIAL_LABEL,
}

export function createScopedSlug(db, table, sourceValue, prefix, scopeColumn = null, scopeValue = null, excludeId = null) {
  const base = slugify(sourceValue, prefix)
  let candidate = base
  let suffix = 2

  while (slugExists(db, table, candidate, scopeColumn, scopeValue, excludeId)) {
    candidate = `${base}-${suffix++}`
  }

  return candidate
}

function slugExists(db, table, slug, scopeColumn, scopeValue, excludeId) {
  const params = [slug]
  let sql = `SELECT id FROM ${table} WHERE slug = ?`

  if (scopeColumn) {
    sql += ` AND ${scopeColumn} = ?`
    params.push(scopeValue)
  }

  if (excludeId != null) {
    sql += ' AND id != ?'
    params.push(Number(excludeId))
  }

  return Boolean(db.prepare(sql).get(...params))
}

export function getUserByEmail(db, email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email)
}

export function getUserById(db, userId) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(Number(userId))
}

export function getOrganizationById(db, organizationId) {
  return db.prepare('SELECT id, name, slug, status, created_at FROM organizations WHERE id = ?').get(Number(organizationId))
}

export function getMembershipByUserId(db, userId) {
  return db.prepare(`
    SELECT organization_id, user_id, role, status, joined_at
    FROM organization_members
    WHERE user_id = ?
  `).get(Number(userId))
}

export function listWorkspaces(db, organizationId, options = {}) {
  const workspaceIds = normalizeIdList(options.workspaceIds)
  if (workspaceIds && !workspaceIds.length) return []

  const params = [Number(organizationId)]
  let sql = `
    SELECT
      w.id,
      w.organization_id,
      w.name,
      w.slug,
      w.status,
      w.created_at,
      (SELECT COUNT(*) FROM rank_keywords rk WHERE rk.workspace_id = w.id AND rk.active = 1) AS keyword_count,
      (SELECT COUNT(*) FROM workspace_competitors wc WHERE wc.workspace_id = w.id) AS competitor_count,
      (SELECT COUNT(*) FROM report_runs rr WHERE rr.workspace_id = w.id) AS report_count,
      (SELECT MAX(updated_at) FROM jobs j WHERE j.workspace_id = w.id) AS last_activity_at,
      (SELECT COUNT(*) FROM workspace_alerts wa WHERE wa.workspace_id = w.id AND wa.status = 'open') AS open_alert_count
    FROM workspaces w
    WHERE w.organization_id = ?
  `

  if (workspaceIds) {
    sql += ` AND w.id IN (${workspaceIds.map(() => '?').join(', ')})`
    params.push(...workspaceIds)
  }

  sql += ' ORDER BY w.name COLLATE NOCASE'

  return db.prepare(sql).all(...params).map((workspace) => ({
    id: workspace.id,
    organizationId: workspace.organization_id,
    name: workspace.name,
    slug: workspace.slug,
    status: workspace.status,
    createdAt: workspace.created_at,
    keywordCount: Number(workspace.keyword_count || 0),
    competitorCount: Number(workspace.competitor_count || 0),
    reportCount: Number(workspace.report_count || 0),
    openAlertCount: Number(workspace.open_alert_count || 0),
    lastActivityAt: workspace.last_activity_at || null,
  }))
}

export function getWorkspaceById(db, organizationId, workspaceId, options = {}) {
  const workspaceIds = normalizeIdList(options.workspaceIds)
  if (workspaceIds && !workspaceIds.includes(Number(workspaceId))) return null

  const params = [Number(organizationId), Number(workspaceId)]
  let sql = `
    SELECT id, organization_id, name, slug, status, created_at
    FROM workspaces
    WHERE organization_id = ? AND id = ?
  `

  if (workspaceIds) {
    sql += ` AND id IN (${workspaceIds.map(() => '?').join(', ')})`
    params.push(...workspaceIds)
  }

  const row = db.prepare(sql).get(...params)

  if (!row) return null
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    createdAt: row.created_at,
  }
}

export function getWorkspaceBySlug(db, organizationId, slug, options = {}) {
  const workspaceIds = normalizeIdList(options.workspaceIds)
  if (workspaceIds && !workspaceIds.length) return null

  const params = [Number(organizationId), String(slug || '')]
  let sql = `
    SELECT id, organization_id, name, slug, status, created_at
    FROM workspaces
    WHERE organization_id = ? AND slug = ?
  `

  if (workspaceIds) {
    sql += ` AND id IN (${workspaceIds.map(() => '?').join(', ')})`
    params.push(...workspaceIds)
  }

  const row = db.prepare(sql).get(...params)

  if (!row) return null
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    createdAt: row.created_at,
  }
}

export function getWorkspaceSetting(db, workspaceId, keyName, fallback = '') {
  const row = db.prepare('SELECT value FROM workspace_settings WHERE workspace_id = ? AND key = ?').get(Number(workspaceId), keyName)
  return row?.value ?? fallback
}

export function getWorkspaceSettingsMap(db, workspaceId) {
  const rows = db.prepare('SELECT key, value FROM workspace_settings WHERE workspace_id = ?').all(Number(workspaceId))
  return rows.reduce((acc, row) => {
    acc[row.key] = row.value
    return acc
  }, {})
}

export function setWorkspaceSetting(db, workspaceId, keyName, value) {
  const normalized = value == null ? '' : String(value)
  db.prepare(`
    INSERT INTO workspace_settings (workspace_id, key, value, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(workspace_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).run(Number(workspaceId), keyName, normalized)
}

export function setWorkspaceSettings(db, workspaceId, entries) {
  for (const [keyName, value] of Object.entries(entries || {})) {
    if (value === undefined) continue
    setWorkspaceSetting(db, workspaceId, keyName, value)
  }
}

export function initializeWorkspaceDefaults(db, workspaceId, overrides = {}) {
  setWorkspaceSettings(db, workspaceId, { ...DEFAULT_WORKSPACE_SETTINGS, ...overrides })
}

export function getOrgCredential(db, security, organizationId, provider, label = 'default') {
  let row = db.prepare(`
    SELECT encrypted_value
    FROM organization_credentials
    WHERE organization_id = ? AND provider = ? AND label = ?
  `).get(Number(organizationId), provider, label)

  if (!row) {
    row = db.prepare(`
      SELECT encrypted_value
      FROM organization_credentials
      WHERE organization_id = ? AND provider = ?
      ORDER BY updated_at DESC, id DESC
      LIMIT 1
    `).get(Number(organizationId), provider)
  }

  if (!row) return null
  return security.decryptSecret(row.encrypted_value)
}

export function tryGetOrgCredential(db, security, organizationId, provider, label = 'default') {
  try {
    return { value: getOrgCredential(db, security, organizationId, provider, label), error: '' }
  } catch {
    return { value: null, error: 'Saved credential could not be decrypted. Re-save it in the organization vault.' }
  }
}

export function tryGetOrgCredentialByLabel(db, security, organizationId, provider, label = DEFAULT_CREDENTIAL_LABEL) {
  const normalizedLabel = normalizeCredentialLabel(label)
  const row = db.prepare(`
    SELECT encrypted_value
    FROM organization_credentials
    WHERE organization_id = ? AND provider = ? AND label = ?
  `).get(Number(organizationId), provider, normalizedLabel)

  if (!row) {
    return {
      label: normalizedLabel,
      exists: false,
      value: null,
      error: '',
    }
  }

  try {
    return {
      label: normalizedLabel,
      exists: true,
      value: security.decryptSecret(row.encrypted_value),
      error: '',
    }
  } catch {
    return {
      label: normalizedLabel,
      exists: true,
      value: null,
      error: 'Saved credential could not be decrypted. Re-save it in the organization vault.',
    }
  }
}

export function listOrgCredentials(db, security, organizationId) {
  return db.prepare(`
    SELECT id, provider, label, encrypted_value, metadata_json, created_at, updated_at
    FROM organization_credentials
    WHERE organization_id = ?
    ORDER BY provider, label
  `).all(Number(organizationId)).map((row) => {
    const decrypted = tryGetDecryptedCredential(security, row.encrypted_value)
    return {
      id: row.id,
      provider: row.provider,
      label: row.label,
      maskedValue: decrypted.invalid ? 'Unreadable secret' : maskSecret(decrypted.value),
      invalid: decrypted.invalid,
      error: decrypted.error,
      metadata: safeJsonParse(row.metadata_json, {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  })
}

function tryGetDecryptedCredential(security, encryptedValue) {
  try {
    return { value: security.decryptSecret(encryptedValue), invalid: false, error: '' }
  } catch {
    return {
      value: '',
      invalid: true,
      error: 'Saved credential could not be decrypted. Re-save it in the organization vault.',
    }
  }
}

export function upsertOrgCredential(db, security, organizationId, { provider, label = 'default', value, metadata = {} }) {
  const encryptedValue = security.encryptSecret(value)
  db.prepare(`
    INSERT INTO organization_credentials (organization_id, provider, label, encrypted_value, metadata_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(organization_id, provider, label) DO UPDATE
      SET encrypted_value = excluded.encrypted_value,
          metadata_json = excluded.metadata_json,
          updated_at = datetime('now')
  `).run(Number(organizationId), provider, label, encryptedValue, JSON.stringify(metadata || {}))
}

export function deleteOrgCredential(db, organizationId, credentialId) {
  db.prepare('DELETE FROM organization_credentials WHERE organization_id = ? AND id = ?').run(Number(organizationId), Number(credentialId))
}

export function createRankProfile(db, workspaceId, {
  name,
  locationLabel = '',
  searchLocationId = '',
  searchLocationName = '',
  businessName = '',
  gl = '',
  hl = '',
  device = 'desktop',
  active = true,
  slug = '',
}) {
  const effectiveGl = String(gl || getWorkspaceSetting(db, workspaceId, 'rank_gl', DEFAULT_WORKSPACE_SETTINGS.rank_gl) || DEFAULT_WORKSPACE_SETTINGS.rank_gl)
  const effectiveHl = String(hl || getWorkspaceSetting(db, workspaceId, 'rank_hl', DEFAULT_WORKSPACE_SETTINGS.rank_hl) || DEFAULT_WORKSPACE_SETTINGS.rank_hl)
  const profileSlug = createScopedSlug(db, 'rank_profiles', slug || name, 'profile', 'workspace_id', workspaceId)
  const result = db.prepare(`
    INSERT INTO rank_profiles (workspace_id, name, slug, location_label, search_location_id, search_location_name, business_name, gl, hl, device, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    Number(workspaceId),
    name,
    profileSlug,
    locationLabel,
    String(searchLocationId || ''),
    String(searchLocationName || ''),
    String(businessName || name),
    effectiveGl,
    effectiveHl,
    device,
    active ? 1 : 0,
  )
  return getRankProfileById(db, workspaceId, Number(result.lastInsertRowid))
}

export function getOrCreatePrimaryRankProfile(db, workspaceId) {
  const existing = db.prepare(`
    SELECT id
    FROM rank_profiles
    WHERE workspace_id = ? AND slug = 'primary-market'
    LIMIT 1
  `).get(Number(workspaceId))

  if (existing) return Number(existing.id)
  const profile = createRankProfile(db, workspaceId, {
    name: 'Primary Market',
    slug: 'primary-market',
    locationLabel: '',
    searchLocationId: '',
    searchLocationName: '',
    businessName: 'Primary Market',
    gl: getWorkspaceSetting(db, workspaceId, 'rank_gl', DEFAULT_WORKSPACE_SETTINGS.rank_gl),
    hl: getWorkspaceSetting(db, workspaceId, 'rank_hl', DEFAULT_WORKSPACE_SETTINGS.rank_hl),
    device: 'desktop',
  })
  return Number(profile.id)
}

export function listRankProfiles(db, workspaceId) {
  return db.prepare(`
    SELECT
      rp.id,
      rp.workspace_id,
      rp.name,
      rp.slug,
      rp.location_label,
      rp.search_location_id,
      rp.search_location_name,
      rp.business_name,
      rp.gl,
      rp.hl,
      rp.device,
      rp.active,
      rp.created_at,
      (SELECT COUNT(*) FROM rank_keywords rk WHERE rk.profile_id = rp.id AND rk.active = 1) AS keyword_count,
      (SELECT COUNT(*) FROM workspace_alerts wa WHERE wa.profile_id = rp.id AND wa.status = 'open') AS open_alert_count,
      (SELECT MAX(date) FROM rank_daily rd WHERE rd.profile_id = rp.id) AS latest_rank_date
    FROM rank_profiles rp
    WHERE rp.workspace_id = ?
    ORDER BY rp.active DESC, rp.name COLLATE NOCASE
  `).all(Number(workspaceId)).map((row) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    slug: row.slug,
    locationLabel: row.location_label || '',
    searchLocationId: row.search_location_id || '',
    searchLocationName: row.search_location_name || '',
    businessName: row.business_name || row.name,
    gl: row.gl,
    hl: row.hl,
    device: row.device,
    active: Boolean(row.active),
    createdAt: row.created_at,
    keywordCount: Number(row.keyword_count || 0),
    openAlertCount: Number(row.open_alert_count || 0),
    latestRankDate: row.latest_rank_date || null,
  }))
}

export function getRankProfileById(db, workspaceId, profileId) {
  const row = db.prepare(`
    SELECT id, workspace_id, name, slug, location_label, search_location_id, search_location_name, business_name, gl, hl, device, active, created_at
    FROM rank_profiles
    WHERE workspace_id = ? AND id = ?
  `).get(Number(workspaceId), Number(profileId))

  if (!row) return null
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    slug: row.slug,
    locationLabel: row.location_label || '',
    searchLocationId: row.search_location_id || '',
    searchLocationName: row.search_location_name || '',
    businessName: row.business_name || row.name,
    gl: row.gl,
    hl: row.hl,
    device: row.device,
    active: Boolean(row.active),
    createdAt: row.created_at,
  }
}

export function updateRankProfile(db, workspaceId, profileId, updates = {}) {
  const current = getRankProfileById(db, workspaceId, profileId)
  if (!current) return null

  const name = updates.name ?? current.name
  const slug = createScopedSlug(db, 'rank_profiles', updates.slug || name, 'profile', 'workspace_id', workspaceId, profileId)
  db.prepare(`
    UPDATE rank_profiles
    SET name = ?, slug = ?, location_label = ?, search_location_id = ?, search_location_name = ?, business_name = ?, gl = ?, hl = ?, device = ?, active = ?
    WHERE workspace_id = ? AND id = ?
  `).run(
    name,
    slug,
    updates.locationLabel ?? current.locationLabel,
    updates.searchLocationId ?? current.searchLocationId,
    updates.searchLocationName ?? current.searchLocationName,
    updates.businessName ?? current.businessName,
    updates.gl ?? current.gl,
    updates.hl ?? current.hl,
    updates.device ?? current.device,
    updates.active == null ? (current.active ? 1 : 0) : (updates.active ? 1 : 0),
    Number(workspaceId),
    Number(profileId),
  )

  return getRankProfileById(db, workspaceId, profileId)
}

export function deleteRankProfile(db, workspaceId, profileId) {
  db.prepare('DELETE FROM rank_profiles WHERE workspace_id = ? AND id = ?').run(Number(workspaceId), Number(profileId))
}

export function listRankKeywords(db, workspaceId, options = {}) {
  const params = [Number(workspaceId)]
  let sql = `
    SELECT rk.id, rk.workspace_id, rk.profile_id, rk.keyword, rk.landing_page, rk.intent, rk.priority, rk.active, rk.created_at,
           rp.name AS profile_name, rp.slug AS profile_slug
    FROM rank_keywords rk
    JOIN rank_profiles rp ON rp.id = rk.profile_id
    WHERE rk.workspace_id = ?
  `

  if (options.profileId != null) {
    sql += ' AND rk.profile_id = ?'
    params.push(Number(options.profileId))
  }

  sql += ' ORDER BY rp.name COLLATE NOCASE, rk.keyword COLLATE NOCASE'

  return db.prepare(sql).all(...params).map((row) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    profileId: row.profile_id,
    profileName: row.profile_name,
    profileSlug: row.profile_slug,
    keyword: row.keyword,
    landingPage: row.landing_page || '',
    intent: row.intent || '',
    priority: row.priority || 'medium',
    active: Boolean(row.active),
    createdAt: row.created_at,
  }))
}

export function upsertRankKeyword(db, workspaceId, { profileId, keyword, landingPage = '', intent = '', priority = 'medium', active = true }) {
  db.prepare(`
    INSERT INTO rank_keywords (workspace_id, profile_id, keyword, landing_page, intent, priority, active)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(profile_id, keyword) DO UPDATE SET
      landing_page = excluded.landing_page,
      intent = excluded.intent,
      priority = excluded.priority,
      active = excluded.active
  `).run(Number(workspaceId), Number(profileId), keyword, landingPage, intent, priority, active ? 1 : 0)
}

export function deleteRankKeyword(db, workspaceId, keywordId) {
  db.prepare('DELETE FROM rank_keywords WHERE workspace_id = ? AND id = ?').run(Number(workspaceId), Number(keywordId))
}

export function createWorkspaceAlert(db, alert) {
  const detectedAt = alert.detectedAt || new Date().toISOString()
  const keyword = String(alert.keyword || '')
  const source = String(alert.source || 'rank')
  const alertType = String(alert.alertType || 'event')
  const profileId = alert.profileId == null ? null : Number(alert.profileId)
  const existing = db.prepare(`
    SELECT id
    FROM workspace_alerts
    WHERE workspace_id = ?
      AND COALESCE(profile_id, 0) = COALESCE(?, 0)
      AND keyword = ?
      AND source = ?
      AND alert_type = ?
      AND date(detected_at) = date(?)
    LIMIT 1
  `).get(Number(alert.workspaceId), profileId, keyword, source, alertType, detectedAt)

  if (existing) {
    db.prepare(`
      UPDATE workspace_alerts
      SET severity = ?, title = ?, message = ?, payload_json = ?, status = 'open', detected_at = ?, resolved_at = NULL
      WHERE id = ?
    `).run(alert.severity, alert.title, alert.message, JSON.stringify(alert.payload || {}), detectedAt, Number(existing.id))
    return Number(existing.id)
  }

  const result = db.prepare(`
    INSERT INTO workspace_alerts (workspace_id, profile_id, keyword, source, alert_type, severity, title, message, payload_json, status, detected_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)
  `).run(Number(alert.workspaceId), profileId, keyword, source, alertType, alert.severity, alert.title, alert.message, JSON.stringify(alert.payload || {}), detectedAt)
  return Number(result.lastInsertRowid)
}

export function listWorkspaceAlerts(db, organizationId, workspaceId, options = {}) {
  const params = [Number(organizationId), Number(workspaceId)]
  let sql = `
    SELECT wa.id, wa.workspace_id, wa.profile_id, wa.keyword, wa.source, wa.alert_type, wa.severity, wa.title, wa.message, wa.payload_json, wa.status, wa.detected_at, wa.resolved_at, wa.created_at,
           rp.name AS profile_name,
           w.name AS workspace_name,
           w.slug AS workspace_slug
    FROM workspace_alerts wa
    JOIN workspaces w ON w.id = wa.workspace_id
    LEFT JOIN rank_profiles rp ON rp.id = wa.profile_id
    WHERE w.organization_id = ? AND wa.workspace_id = ?
  `

  if (options.status) {
    sql += ' AND wa.status = ?'
    params.push(String(options.status))
  }
  if (options.profileId != null) {
    sql += ' AND wa.profile_id = ?'
    params.push(Number(options.profileId))
  }

  sql += ' ORDER BY wa.detected_at DESC LIMIT ?'
  params.push(Number(options.limit || 30))

  return db.prepare(sql).all(...params).map(mapAlertRow)
}

export function listOrganizationAlerts(db, organizationId, options = {}) {
  const params = [Number(organizationId)]
  let sql = `
    SELECT wa.id, wa.workspace_id, wa.profile_id, wa.keyword, wa.source, wa.alert_type, wa.severity, wa.title, wa.message, wa.payload_json, wa.status, wa.detected_at, wa.resolved_at, wa.created_at,
           rp.name AS profile_name,
           w.name AS workspace_name,
           w.slug AS workspace_slug
    FROM workspace_alerts wa
    JOIN workspaces w ON w.id = wa.workspace_id
    LEFT JOIN rank_profiles rp ON rp.id = wa.profile_id
    WHERE w.organization_id = ?
  `

  if (options.status) {
    sql += ' AND wa.status = ?'
    params.push(String(options.status))
  }
  if (options.workspaceId != null) {
    sql += ' AND wa.workspace_id = ?'
    params.push(Number(options.workspaceId))
  }

  sql += ' ORDER BY wa.detected_at DESC LIMIT ?'
  params.push(Number(options.limit || 60))

  return db.prepare(sql).all(...params).map(mapAlertRow)
}

export function updateWorkspaceAlertStatus(db, organizationId, alertId, status) {
  const row = db.prepare(`
    SELECT wa.id
    FROM workspace_alerts wa
    JOIN workspaces w ON w.id = wa.workspace_id
    WHERE wa.id = ? AND w.organization_id = ?
  `).get(Number(alertId), Number(organizationId))

  if (!row) return false

  db.prepare(`
    UPDATE workspace_alerts
    SET status = ?,
        resolved_at = CASE WHEN ? = 'resolved' THEN datetime('now') ELSE NULL END
    WHERE id = ?
  `).run(status, status, Number(alertId))

  return true
}

function mapAlertRow(row) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    workspaceSlug: row.workspace_slug,
    profileId: row.profile_id == null ? null : Number(row.profile_id),
    profileName: row.profile_name || '',
    keyword: row.keyword,
    source: row.source,
    alertType: row.alert_type,
    severity: row.severity,
    title: row.title,
    message: row.message,
    payload: safeJsonParse(row.payload_json, {}),
    status: row.status,
    detectedAt: row.detected_at,
    resolvedAt: row.resolved_at || null,
    createdAt: row.created_at,
  }
}

export function createSession(db, { tokenHash, userId, organizationId, expiresAt }) {
  const result = db.prepare(`
    INSERT INTO sessions (token_hash, user_id, organization_id, expires_at, last_seen_at, created_at)
    VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(tokenHash, Number(userId), Number(organizationId), expiresAt)
  return Number(result.lastInsertRowid)
}

export function getSessionByTokenHash(db, tokenHash) {
  return db.prepare(`
    SELECT
      s.id AS session_id,
      s.token_hash,
      s.user_id,
      s.organization_id,
      s.expires_at,
      s.last_seen_at,
      u.email,
      u.display_name,
      u.status AS user_status,
      u.last_login_at,
      om.role,
      om.status AS membership_status,
      o.name AS organization_name,
      o.slug AS organization_slug,
      o.status AS organization_status,
      o.created_at AS organization_created_at
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    JOIN organization_members om ON om.organization_id = s.organization_id AND om.user_id = s.user_id
    JOIN organizations o ON o.id = s.organization_id
    WHERE s.token_hash = ?
  `).get(tokenHash)
}

export function touchSession(db, tokenHash) {
  db.prepare(`
    UPDATE sessions
    SET last_seen_at = datetime('now')
    WHERE token_hash = ?
  `).run(tokenHash)
}

export function deleteSession(db, tokenHash) {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash)
}

export function getApiTokenByTokenHash(db, tokenHash) {
  const row = db.prepare(`
    SELECT
      t.id,
      t.organization_id,
      t.label,
      t.token_prefix,
      t.token_hash,
      t.scopes_json,
      t.expires_at,
      t.last_used_at,
      t.revoked_at,
      t.created_by_user_id,
      t.created_at,
      t.updated_at,
      o.name AS organization_name,
      o.slug AS organization_slug,
      o.status AS organization_status,
      o.created_at AS organization_created_at
    FROM api_tokens t
    JOIN organizations o ON o.id = t.organization_id
    WHERE t.token_hash = ?
  `).get(String(tokenHash || ''))

  return row ? mapApiTokenRow(db, row) : null
}

export function listApiTokens(db, organizationId) {
  return db.prepare(`
    SELECT
      t.id,
      t.organization_id,
      t.label,
      t.token_prefix,
      t.token_hash,
      t.scopes_json,
      t.expires_at,
      t.last_used_at,
      t.revoked_at,
      t.created_by_user_id,
      t.created_at,
      t.updated_at,
      o.name AS organization_name,
      o.slug AS organization_slug,
      o.status AS organization_status,
      o.created_at AS organization_created_at
    FROM api_tokens t
    JOIN organizations o ON o.id = t.organization_id
    WHERE t.organization_id = ?
    ORDER BY t.id DESC
  `).all(Number(organizationId)).map((row) => mapApiTokenRow(db, row))
}

export function createApiToken(db, { organizationId, label, tokenPrefix, tokenHash, scopes, workspaceIds, expiresAt = null, createdByUserId }) {
  let tokenId = null
  db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO api_tokens (
        organization_id,
        label,
        token_prefix,
        token_hash,
        scopes_json,
        expires_at,
        created_by_user_id,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(
      Number(organizationId),
      String(label || ''),
      String(tokenPrefix || ''),
      String(tokenHash || ''),
      JSON.stringify(scopes || []),
      expiresAt || null,
      Number(createdByUserId),
    )

    tokenId = Number(result.lastInsertRowid)
    for (const workspaceId of normalizeIdList(workspaceIds) || []) {
      db.prepare(`
        INSERT INTO api_token_workspaces (token_id, workspace_id, created_at)
        VALUES (?, ?, datetime('now'))
      `).run(tokenId, Number(workspaceId))
    }
  })()

  return listApiTokens(db, organizationId).find((item) => item.id === tokenId) || null
}

export function revokeApiToken(db, organizationId, tokenId) {
  const result = db.prepare(`
    UPDATE api_tokens
    SET revoked_at = COALESCE(revoked_at, datetime('now')),
        updated_at = datetime('now')
    WHERE organization_id = ? AND id = ?
  `).run(Number(organizationId), Number(tokenId))

  return Number(result.changes || 0) > 0
}

export function touchApiToken(db, tokenId) {
  db.prepare(`
    UPDATE api_tokens
    SET last_used_at = datetime('now'),
        updated_at = datetime('now')
    WHERE id = ?
  `).run(Number(tokenId))
}

export function createJob(db, {
  organizationId,
  workspaceId = null,
  triggeredByUserId = null,
  triggeredByApiTokenId = null,
  jobType,
  details = {},
}) {
  const result = db.prepare(`
    INSERT INTO jobs (organization_id, workspace_id, triggered_by_user_id, triggered_by_api_token_id, job_type, status, details)
    VALUES (?, ?, ?, ?, ?, 'queued', ?)
  `).run(
    Number(organizationId),
    workspaceId ? Number(workspaceId) : null,
    triggeredByUserId ? Number(triggeredByUserId) : null,
    triggeredByApiTokenId ? Number(triggeredByApiTokenId) : null,
    jobType,
    JSON.stringify(details || {}),
  )
  return Number(result.lastInsertRowid)
}

export function updateJob(db, jobId, status, details = {}) {
  db.prepare(`
    UPDATE jobs
    SET status = ?, details = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(status, JSON.stringify(details || {}), Number(jobId))
}

export function listWorkspaceJobs(db, organizationId, workspaceId, limit = 25) {
  return db.prepare(`
    SELECT id, job_type, status, details, created_at, updated_at
    FROM jobs
    WHERE organization_id = ? AND workspace_id = ?
    ORDER BY id DESC
    LIMIT ?
  `).all(Number(organizationId), Number(workspaceId), Number(limit)).map((row) => ({
    id: row.id,
    jobType: row.job_type,
    status: row.status,
    details: safeJsonParse(row.details, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
}

export function buildAuthPayload(db, security, userId, options = {}) {
  const user = getUserById(db, userId)
  if (!user) return null

  const membership = getMembershipByUserId(db, userId)
  if (!membership || membership.status !== 'active') return null

  const organization = getOrganizationById(db, membership.organization_id)
  if (!organization || organization.status !== 'active') return null

  const workspaces = listWorkspaces(db, organization.id, { workspaceIds: options.workspaceIds })
  const firstWorkspace = workspaces[0] || null
  const firstSettings = firstWorkspace ? getWorkspaceSettingsMap(db, firstWorkspace.id) : {}
  const pendingInvites = db.prepare(`
    SELECT COUNT(*) AS count
    FROM invitations
    WHERE organization_id = ? AND status = 'pending' AND datetime(expires_at) > datetime('now')
  `).get(organization.id).count
  const googleConnection = tryGetOrgCredential(db, security, organization.id, 'google_oauth_tokens')

  return {
    authenticated: true,
    authType: 'session',
    publicSignupEnabled: false,
    principal: {
      type: 'user',
      userId: user.id,
      email: user.email,
      role: membership.role,
    },
    user: {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      status: user.status,
      lastLoginAt: user.last_login_at || null,
      createdAt: user.created_at,
    },
    organization: {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      status: organization.status,
      createdAt: organization.created_at,
    },
    role: membership.role,
    workspaces,
    onboarding: {
      hasWorkspace: Boolean(firstWorkspace),
      googleConnected: Boolean(googleConnection.value),
      workspaceConfigured: Boolean(
        firstSettings.gsc_site_url ||
        firstSettings.ga4_property_id ||
        firstSettings.rank_domain ||
        firstSettings.google_ads_customer_id
      ),
      invitedTeam: Number(pendingInvites || 0) > 0,
    },
  }
}

export function buildApiTokenAuthPayload(db, security, apiToken) {
  if (!apiToken || apiToken.organizationStatus !== 'active') return null

  const workspaces = listWorkspaces(db, apiToken.organizationId, { workspaceIds: apiToken.workspaceIds })
  const firstWorkspace = workspaces[0] || null
  const firstSettings = firstWorkspace ? getWorkspaceSettingsMap(db, firstWorkspace.id) : {}
  const googleConnection = tryGetOrgCredential(db, security, apiToken.organizationId, 'google_oauth_tokens')

  return {
    authenticated: true,
    authType: 'api_token',
    publicSignupEnabled: false,
    principal: {
      type: 'api_token',
      tokenId: apiToken.id,
      label: apiToken.label,
      scopes: apiToken.scopes,
      workspaceIds: apiToken.workspaceIds,
    },
    user: null,
    organization: {
      id: apiToken.organizationId,
      name: apiToken.organizationName,
      slug: apiToken.organizationSlug,
      status: apiToken.organizationStatus,
      createdAt: apiToken.organizationCreatedAt,
    },
    role: 'api_token',
    apiToken: {
      id: apiToken.id,
      label: apiToken.label,
      scopes: apiToken.scopes,
      workspaceIds: apiToken.workspaceIds,
      expiresAt: apiToken.expiresAt,
      lastUsedAt: apiToken.lastUsedAt,
      revokedAt: apiToken.revokedAt,
    },
    workspaces,
    onboarding: {
      hasWorkspace: Boolean(firstWorkspace),
      googleConnected: Boolean(googleConnection.value),
      workspaceConfigured: Boolean(
        firstSettings.gsc_site_url ||
        firstSettings.ga4_property_id ||
        firstSettings.rank_domain ||
        firstSettings.google_ads_customer_id
      ),
      invitedTeam: false,
    },
  }
}

function mapApiTokenRow(db, row) {
  const workspaceAssignments = db.prepare(`
    SELECT w.id, w.name, w.slug
    FROM api_token_workspaces atw
    JOIN workspaces w ON w.id = atw.workspace_id
    WHERE atw.token_id = ?
    ORDER BY w.name COLLATE NOCASE
  `).all(Number(row.id)).map((workspace) => ({
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
  }))

  const expiresAt = row.expires_at || null
  const revokedAt = row.revoked_at || null
  const status = revokedAt
    ? 'revoked'
    : (expiresAt && new Date(expiresAt).getTime() <= Date.now() ? 'expired' : 'active')

  return {
    id: row.id,
    organizationId: row.organization_id,
    label: row.label,
    tokenPrefix: row.token_prefix,
    maskedToken: `${row.token_prefix}****`,
    scopes: safeJsonParse(row.scopes_json, []),
    expiresAt,
    lastUsedAt: row.last_used_at || null,
    revokedAt,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    status,
    workspaces: workspaceAssignments,
    workspaceIds: workspaceAssignments.map((workspace) => Number(workspace.id)),
    organizationName: row.organization_name,
    organizationSlug: row.organization_slug,
    organizationStatus: row.organization_status,
    organizationCreatedAt: row.organization_created_at,
  }
}

function normalizeIdList(values) {
  if (values == null) return null
  return [...new Set((Array.isArray(values) ? values : [values])
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0))]
}
