import { DEFAULT_REPORT_SECTION_IDS, getReportSection, normalizeReportSections } from '../../shared/reportSections.js'

export function getReportSummaryMetrics(summary = {}) {
  const organic = summary?.organic || {}
  const mapPack = summary?.mapPack || {}
  return {
    organicVisibility: Number(summary?.visibilityScore ?? organic.visibilityScore ?? 0),
    mapVisibility: Number(summary?.mapPackVisibilityScore ?? mapPack.visibilityScore ?? 0),
    top10Count: Number(summary?.top10Count ?? organic.top10Count ?? 0),
    top3Count: Number(summary?.mapPackTop3Count ?? mapPack.top3Count ?? 0),
    healthScore: summary?.healthScore == null ? null : Number(summary.healthScore || 0),
  }
}

export function getReportSectionsIncluded(summary = {}) {
  const sections = summary?.sectionsIncluded
  if (!Array.isArray(sections) || !sections.length) return [...DEFAULT_REPORT_SECTION_IDS]
  const normalized = normalizeReportSections(sections)
  return normalized.length ? normalized : [...DEFAULT_REPORT_SECTION_IDS]
}

export function getReportSectionMeta(summary = {}) {
  return getReportSectionsIncluded(summary)
    .map((sectionId) => getReportSection(sectionId))
    .filter(Boolean)
}

export function formatReportSummaryLine(summary = {}) {
  const metrics = getReportSummaryMetrics(summary)
  const parts = [
    `Organic ${metrics.organicVisibility}`,
    `Map ${metrics.mapVisibility}`,
    `Top 10 ${metrics.top10Count}`,
    `Top 3 pack ${metrics.top3Count}`,
  ]

  if (metrics.healthScore != null) {
    parts.push(`Health ${metrics.healthScore}`)
  }

  return parts.join(' / ')
}

export function getVisualReportPresentation(summary = {}) {
  const presentation = summary?.presentation
  return presentation && typeof presentation === 'object' ? presentation : null
}

export function getFindingAccordionValues(groupedFindings = {}) {
  return Array.isArray(groupedFindings?.items)
    ? groupedFindings.items.map((item) => `${item.severity || 'low'}:${item.code || item.title || 'finding'}`)
    : []
}

export function buildReportExportUrl(currentUrl, reportId) {
  const url = new URL(String(currentUrl || ''), 'http://localhost')
  url.searchParams.set('reportId', String(reportId))
  url.searchParams.set('export', '1')
  return url.toString()
}
