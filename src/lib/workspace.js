export const PORTFOLIO_NAV = { id: 'portfolio', label: 'Portfolio' }

export const APP_SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'rankings', label: 'Rankings' },
  { id: 'audit', label: 'Site Audit' },
  { id: 'competitors', label: 'Competitors' },
  { id: 'reports', label: 'Reports' },
  { id: 'ads', label: 'Ads' },
]

export const SETTINGS_SECTIONS = [
  { id: 'organization', label: 'Organization' },
  { id: 'team', label: 'Team' },
]

export function getOnboardingSteps({ googleConnected = false, workspaceSettings = {}, keywordCount = 0, competitorCount = 0 }) {
  return [
    {
      id: 'google',
      label: 'Connect Google once at the organization level',
      done: Boolean(googleConnected),
      hint: 'This unlocks shared GSC, GA4, and Google Ads asset discovery for every client workspace.',
    },
    {
      id: 'gsc',
      label: 'Assign a GSC property to the active workspace',
      done: Boolean(workspaceSettings.gsc_site_url),
      hint: 'Use the production property that should feed search visibility and performance reporting.',
    },
    {
      id: 'ga4',
      label: 'Assign a GA4 property to the active workspace',
      done: Boolean(workspaceSettings.ga4_property_id),
      hint: 'This feeds sessions, users, and conversions into the client workspace.',
    },
    {
      id: 'rankDomain',
      label: 'Set the workspace rank domain',
      done: Boolean(workspaceSettings.rank_domain),
      hint: 'The rank domain also anchors the site audit target for technical SEO monitoring.',
    },
    {
      id: 'keywords',
      label: 'Load tracked keywords',
      done: keywordCount > 0,
      hint: 'Keyword tracking is the minimum baseline for agency delivery and reporting.',
    },
    {
      id: 'competitors',
      label: 'Capture competitor benchmarks',
      done: competitorCount > 0,
      hint: 'Competitors are optional, but they sharpen rank narratives and reporting.',
    },
  ]
}

export function getReadinessScore(steps = []) {
  if (!steps.length) return 0
  const complete = steps.filter((step) => step.done).length
  return Math.round((complete / steps.length) * 100)
}

export function getReadinessFocus(steps = []) {
  const firstPending = steps.find((step) => !step.done)
  if (!firstPending) {
    return {
      title: 'Workspace is ready for daily operations',
      description: 'Run syncs, review movement, and ship reports from a single client workspace.',
      action: 'Run full sync',
    }
  }

  return {
    title: firstPending.label,
    description: firstPending.hint,
    action: firstPending.id === 'google' ? 'Open organization settings' : 'Open workspace overview',
  }
}
