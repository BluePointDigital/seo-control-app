export function maskSecret(value) {
  if (!value) return '****'
  if (value.length <= 8) return '****'
  return `${value.slice(0, 4)}****${value.slice(-4)}`
}

export function slugify(input, prefix = 'item') {
  const normalized = String(input || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72)

  return normalized || `${prefix}-${Date.now()}`
}

export function normalizeDomain(input = '') {
  const cleaned = String(input || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '')

  return cleaned
}

export function extractDomainFromUrl(input = '') {
  try {
    return normalizeDomain(new URL(String(input)).hostname)
  } catch {
    return ''
  }
}

export function safeJsonParse(value, fallback = null) {
  try {
    return value ? JSON.parse(value) : fallback
  } catch {
    return fallback
  }
}

export function runBestEffort(action, context, expectedPatterns = []) {
  try {
    return action()
  } catch (error) {
    const message = String(error?.message || '')
    const expected = expectedPatterns.some((pattern) => pattern.test(message))
    if (!expected) {
      console.warn(`${context}: ${message}`)
    }
    return null
  }
}

export function runTransaction(db, action) {
  db.exec('BEGIN')
  try {
    const result = action()
    db.exec('COMMIT')
    return result
  } catch (error) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // ignore rollback failures
    }
    throw error
  }
}

export function coerceBoolean(value) {
  if (typeof value === 'boolean') return value
  const normalized = String(value || '').trim().toLowerCase()
  return ['1', 'true', 'yes', 'on'].includes(normalized)
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

export function formatDateInput(date) {
  return new Date(date).toISOString().slice(0, 10)
}

export function nowIso() {
  return new Date().toISOString()
}
