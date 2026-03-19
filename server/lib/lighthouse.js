const LIGHTHOUSE_METRIC_DEFINITIONS = [
  { id: 'first-contentful-paint', shortLabel: 'FCP' },
  { id: 'largest-contentful-paint', shortLabel: 'LCP' },
  { id: 'total-blocking-time', shortLabel: 'TBT' },
  { id: 'cumulative-layout-shift', shortLabel: 'CLS' },
  { id: 'speed-index', shortLabel: 'Speed Index' },
  { id: 'interactive', shortLabel: 'TTI' },
]

const IGNORED_SCORE_DISPLAY_MODES = new Set(['notApplicable', 'hidden'])
const CATEGORY_AUDIT_IDS = new Set(['performance', 'seo', 'accessibility', 'best-practices'])
const METRIC_AUDIT_IDS = new Set(LIGHTHOUSE_METRIC_DEFINITIONS.map((item) => item.id))

export function normalizeLighthousePsiResult(payload, { strategy = 'mobile', targetUrl = '' } = {}) {
  const lighthouseResult = payload?.lighthouseResult || {}
  const categories = lighthouseResult.categories || {}
  const audits = lighthouseResult.audits || {}

  return {
    strategy,
    reportUrl: buildReportUrl(targetUrl || lighthouseResult.finalDisplayedUrl || lighthouseResult.finalUrl || payload?.id || '', strategy),
    performance: toScore(categories.performance?.score),
    seo: toScore(categories.seo?.score),
    accessibility: toScore(categories.accessibility?.score),
    bestPractices: toScore(categories['best-practices']?.score),
    metrics: LIGHTHOUSE_METRIC_DEFINITIONS
      .map((definition) => normalizeMetricAudit(definition, audits[definition.id]))
      .filter(Boolean),
    opportunities: Object.entries(audits)
      .map(([id, audit]) => normalizeOpportunityAudit(id, audit))
      .filter(Boolean)
      .sort((left, right) => {
        if ((right.savingsMs || 0) !== (left.savingsMs || 0)) return (right.savingsMs || 0) - (left.savingsMs || 0)
        if ((right.savingsBytes || 0) !== (left.savingsBytes || 0)) return (right.savingsBytes || 0) - (left.savingsBytes || 0)
        return left.title.localeCompare(right.title)
      }),
    diagnostics: Object.entries(audits)
      .map(([id, audit]) => normalizeDiagnosticAudit(id, audit))
      .filter(Boolean)
      .sort((left, right) => {
        if ((left.score ?? 2) !== (right.score ?? 2)) return (left.score ?? 2) - (right.score ?? 2)
        return left.title.localeCompare(right.title)
      }),
    passedAudits: Object.entries(audits)
      .map(([id, audit]) => normalizePassedAudit(id, audit))
      .filter(Boolean)
      .sort((left, right) => left.title.localeCompare(right.title)),
  }
}

function normalizeMetricAudit(definition, audit) {
  if (!audit) return null

  return {
    id: definition.id,
    title: definition.shortLabel,
    value: typeof audit.numericValue === 'number' ? audit.numericValue : null,
    unit: normalizeNumericUnit(audit.numericUnit),
    displayValue: toPlainText(audit.displayValue || ''),
    description: toPlainText(audit.description || audit.title || definition.shortLabel),
  }
}

function normalizeOpportunityAudit(id, audit) {
  if (!audit || audit.details?.type !== 'opportunity') return null

  return {
    id,
    title: toPlainText(audit.title || id),
    score: normalizeAuditScore(audit.score),
    displayValue: toPlainText(audit.displayValue || ''),
    description: toPlainText(audit.description || ''),
    savingsMs: toFiniteNumber(audit.details?.overallSavingsMs),
    savingsBytes: toFiniteNumber(audit.details?.overallSavingsBytes),
  }
}

function normalizeDiagnosticAudit(id, audit) {
  if (!shouldIncludeInDetailedLists(id, audit)) return null
  if (audit.details?.type === 'opportunity') return null
  if (audit.score === 1) return null

  return {
    id,
    title: toPlainText(audit.title || id),
    score: normalizeAuditScore(audit.score),
    displayValue: toPlainText(audit.displayValue || ''),
    description: toPlainText(audit.description || ''),
  }
}

function normalizePassedAudit(id, audit) {
  if (!shouldIncludeInDetailedLists(id, audit)) return null
  if (audit.details?.type === 'opportunity') return null
  if (audit.score !== 1) return null

  return {
    id,
    title: toPlainText(audit.title || id),
    description: toPlainText(audit.description || ''),
  }
}

function shouldIncludeInDetailedLists(id, audit) {
  if (!audit || !id) return false
  if (CATEGORY_AUDIT_IDS.has(id) || METRIC_AUDIT_IDS.has(id)) return false
  if (IGNORED_SCORE_DISPLAY_MODES.has(audit.scoreDisplayMode)) return false
  return true
}

function buildReportUrl(targetUrl, strategy) {
  const normalizedUrl = String(targetUrl || '').trim()
  if (!normalizedUrl) return ''
  return `https://pagespeed.web.dev/analysis?url=${encodeURIComponent(normalizedUrl)}&form_factor=${encodeURIComponent(strategy)}`
}

function toScore(value) {
  return Math.round((Number(value || 0)) * 100)
}

function normalizeNumericUnit(value = '') {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return ''
  if (normalized === 'millisecond') return 'ms'
  if (normalized === 'second') return 's'
  if (normalized === 'byte') return 'bytes'
  return normalized
}

function normalizeAuditScore(value) {
  return typeof value === 'number' ? Number(value.toFixed(2)) : null
}

function toFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function toPlainText(value = '') {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
