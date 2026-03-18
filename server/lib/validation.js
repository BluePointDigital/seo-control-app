import { clamp, normalizeDomain } from './utils.js'

const ALLOWED_SYNC_SOURCES = new Set(['all', 'gsc', 'ga4', 'rank', 'ads'])
const ALLOWED_REPORT_TYPES = new Set(['weekly', 'monthly', 'quarterly', 'custom'])
const ALLOWED_ROLES = new Set(['owner', 'admin', 'member'])
const ALLOWED_RANK_SYNC_FREQUENCIES = new Set(['manual', 'weekly', 'daily'])
const ALLOWED_KEYWORD_PRIORITIES = new Set(['low', 'medium', 'high'])
const ALLOWED_ALERT_STATUSES = new Set(['open', 'resolved'])
const ALLOWED_API_TOKEN_SCOPES = new Set(['read', 'write', 'run'])
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function validateEmail(email = '') {
  const normalized = String(email || '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error('Enter a valid email address.')
  }
  return normalized
}

export function validatePassword(password = '') {
  const normalized = String(password || '')
  if (normalized.length < 10) throw new Error('Password must be at least 10 characters.')
  return normalized
}

export function validateDisplayName(name = '') {
  const normalized = String(name || '').trim()
  if (normalized.length < 2) throw new Error('Display name must be at least 2 characters.')
  if (normalized.length > 80) throw new Error('Display name must be 80 characters or fewer.')
  return normalized
}

export function validateOrganizationName(name = '') {
  const normalized = String(name || '').trim()
  if (normalized.length < 2) throw new Error('Organization name must be at least 2 characters.')
  if (normalized.length > 100) throw new Error('Organization name must be 100 characters or fewer.')
  return normalized
}

export function validateWorkspaceName(name = '') {
  const normalized = String(name || '').trim()
  if (normalized.length < 2) throw new Error('Workspace name must be at least 2 characters.')
  if (normalized.length > 100) throw new Error('Workspace name must be 100 characters or fewer.')
  return normalized
}

export function validateRankProfileName(name = '') {
  const normalized = String(name || '').trim()
  if (normalized.length < 2) throw new Error('Profile name must be at least 2 characters.')
  if (normalized.length > 100) throw new Error('Profile name must be 100 characters or fewer.')
  return normalized
}

export function validateRole(role = 'member') {
  const normalized = String(role || 'member').trim().toLowerCase()
  if (!ALLOWED_ROLES.has(normalized)) {
    throw new Error('Role must be owner, admin, or member.')
  }
  return normalized
}

export function validateSyncSource(source = 'all') {
  const normalized = String(source || 'all').toLowerCase()
  if (!ALLOWED_SYNC_SOURCES.has(normalized)) {
    throw new Error('source must be one of all, gsc, ga4, rank, or ads')
  }
  return normalized
}

export function validateReportType(type = 'weekly') {
  const normalized = String(type || 'weekly').toLowerCase()
  if (!ALLOWED_REPORT_TYPES.has(normalized)) {
    throw new Error('type must be weekly, monthly, quarterly, or custom')
  }
  return normalized
}

export function normalizeKeyword(keyword = '') {
  return String(keyword || '').trim().replace(/\s+/g, ' ').slice(0, 120)
}

export function validateKeyword(keyword = '') {
  const normalized = normalizeKeyword(keyword)
  if (!normalized) throw new Error('keyword is required')
  if (normalized.length < 2) throw new Error('keyword must be at least 2 characters')
  return normalized
}

export function validateLandingPageHint(value = '') {
  const normalized = String(value || '').trim().slice(0, 240)
  if (!normalized) return ''

  if (/^https?:\/\//i.test(normalized)) {
    try {
      const parsed = new URL(normalized)
      parsed.hash = ''
      return parsed.toString()
    } catch {
      throw new Error('Landing page hint must be blank or a valid URL.')
    }
  }

  return normalized
}

export function validateKeywordIntent(intent = '') {
  return String(intent || '').trim().toLowerCase().slice(0, 80)
}

export function validateKeywordPriority(priority = 'medium') {
  const normalized = String(priority || 'medium').trim().toLowerCase()
  if (!ALLOWED_KEYWORD_PRIORITIES.has(normalized)) {
    throw new Error('priority must be low, medium, or high')
  }
  return normalized
}

export function validateRankDomain(domain = '') {
  const normalized = normalizeDomain(domain)
  if (!normalized) throw new Error('domain is required')
  return normalized
}

export function validateCompetitorDomain(domain = '') {
  const normalized = normalizeDomain(domain)
  if (!normalized) throw new Error('domain is required')
  return normalized
}

export function validateRankProfileDevice(device = 'desktop') {
  const normalized = String(device || 'desktop').trim().toLowerCase()
  if (normalized !== 'desktop') {
    throw new Error('Only desktop tracking is available in this release.')
  }
  return 'desktop'
}

export function validateRankSyncFrequency(value = 'weekly') {
  const normalized = String(value || 'weekly').trim().toLowerCase()
  if (!ALLOWED_RANK_SYNC_FREQUENCIES.has(normalized)) {
    throw new Error('rank sync frequency must be manual, weekly, or daily.')
  }
  return normalized
}

export function validateRankSyncWeekday(value = 1) {
  const normalized = Number(value)
  if (!Number.isInteger(normalized) || normalized < 0 || normalized > 6) {
    throw new Error('rank sync weekday must be between 0 and 6.')
  }
  return normalized
}

export function validateRankSyncHour(value = 6) {
  const normalized = Number(value)
  if (!Number.isInteger(normalized) || normalized < 0 || normalized > 23) {
    throw new Error('rank sync hour must be between 0 and 23.')
  }
  return normalized
}

export function validateAlertStatus(status = 'open') {
  const normalized = String(status || 'open').trim().toLowerCase()
  if (!ALLOWED_ALERT_STATUSES.has(normalized)) {
    throw new Error('alert status must be open or resolved.')
  }
  return normalized
}

export function validateApiTokenLabel(label = '') {
  const normalized = String(label || '').trim()
  if (normalized.length < 2) throw new Error('API token label must be at least 2 characters.')
  if (normalized.length > 80) throw new Error('API token label must be 80 characters or fewer.')
  return normalized
}

export function validateApiTokenScopes(scopes = []) {
  const normalized = [...new Set((Array.isArray(scopes) ? scopes : [scopes])
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean))]

  if (!normalized.length) throw new Error('Select at least one API token scope.')
  for (const scope of normalized) {
    if (!ALLOWED_API_TOKEN_SCOPES.has(scope)) {
      throw new Error('API token scopes must be read, write, or run.')
    }
  }
  return normalized
}

export function validateApiTokenWorkspaceIds(workspaceIds = []) {
  const normalized = [...new Set((Array.isArray(workspaceIds) ? workspaceIds : [workspaceIds])
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0))]

  if (!normalized.length) throw new Error('Select at least one workspace for this API token.')
  return normalized
}

export function validateApiTokenExpiry(expiresAt) {
  if (expiresAt == null) return null
  const normalized = String(expiresAt || '').trim()
  if (!normalized) return null

  if (ISO_DATE_RE.test(normalized)) {
    return new Date(`${normalized}T23:59:59.999Z`).toISOString()
  }

  const parsed = new Date(normalized)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('API token expiry must be a valid date or ISO timestamp.')
  }
  return parsed.toISOString()
}

export function normalizePropertyId(propertyId = '') {
  return String(propertyId || '').replace(/^properties\//, '').trim()
}

export function normalizeCustomerId(customerId = '') {
  return String(customerId || '').replace(/-/g, '').trim()
}

export function validateSiteUrl(siteUrl = '') {
  const normalized = String(siteUrl || '').trim()
  if (!normalized) return ''
  if (!/^https?:\/\//.test(normalized) && !/^sc-domain:/.test(normalized)) {
    throw new Error('GSC site URL must be a URL or sc-domain property.')
  }
  return normalized
}

export function validateAuditEntryUrl(entryUrl = '') {
  const normalized = String(entryUrl || '').trim()
  if (!normalized) return ''

  let parsed
  try {
    parsed = new URL(normalized)
  } catch {
    throw new Error('Audit entry URL must be a valid http or https URL.')
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Audit entry URL must be a valid http or https URL.')
  }

  parsed.hash = ''
  return parsed.toString()
}

export function validateAuditMaxPages(maxPages, fallback = 25) {
  const value = Number(maxPages)
  if (!Number.isFinite(value)) return fallback
  return clamp(Math.round(value), 5, 50)
}

export function validateIsoDate(dateValue = '', fieldName = 'date') {
  const normalized = String(dateValue || '').trim()
  if (!ISO_DATE_RE.test(normalized)) {
    throw new Error(`${fieldName} must be in YYYY-MM-DD format.`)
  }

  const parsed = new Date(`${normalized}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${fieldName} must be a valid calendar date.`)
  }

  return normalized
}

export function validateCustomDateRange(startDate, endDate) {
  const normalizedStartDate = validateIsoDate(startDate, 'startDate')
  const normalizedEndDate = validateIsoDate(endDate, 'endDate')
  if (normalizedStartDate > normalizedEndDate) {
    throw new Error('startDate must be on or before endDate.')
  }
  return { startDate: normalizedStartDate, endDate: normalizedEndDate }
}
