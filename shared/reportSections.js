export const REPORT_SECTIONS = [
  {
    id: 'executive',
    label: 'Executive snapshot',
    shortLabel: 'Executive',
    description: 'Top-level KPIs and the report headline.',
  },
  {
    id: 'performance',
    label: 'Performance charts',
    shortLabel: 'Charts',
    description: 'Cross-channel trends for search, engagement, rankings, and paid media.',
  },
  {
    id: 'rankings',
    label: 'Rankings summary',
    shortLabel: 'Rankings',
    description: 'Organic and map pack movement, winners, decliners, and matched listings.',
  },
  {
    id: 'lighthouse',
    label: 'Lighthouse overview',
    shortLabel: 'Lighthouse',
    description: 'Mobile and desktop scorecards with core web metrics.',
  },
  {
    id: 'findings',
    label: 'Grouped findings',
    shortLabel: 'Findings',
    description: 'Grouped audit findings with counts and affected URLs.',
  },
  {
    id: 'actions',
    label: 'Recommended next actions',
    shortLabel: 'Actions',
    description: 'Suggested follow-up work for the client team.',
  },
]

export const DEFAULT_REPORT_SECTION_IDS = REPORT_SECTIONS.map((section) => section.id)

const REPORT_SECTION_SET = new Set(DEFAULT_REPORT_SECTION_IDS)

export function normalizeReportSections(sections = DEFAULT_REPORT_SECTION_IDS) {
  const requested = Array.isArray(sections) ? sections : [sections]
  const normalized = new Set(
    requested
      .map((item) => String(item || '').trim().toLowerCase())
      .filter(Boolean),
  )

  return DEFAULT_REPORT_SECTION_IDS.filter((id) => normalized.has(id))
}

export function isValidReportSection(sectionId = '') {
  return REPORT_SECTION_SET.has(String(sectionId || '').trim().toLowerCase())
}

export function getReportSection(sectionId = '') {
  return REPORT_SECTIONS.find((section) => section.id === String(sectionId || '').trim().toLowerCase()) || null
}
