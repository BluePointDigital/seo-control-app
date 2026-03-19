import test from 'node:test'
import assert from 'node:assert/strict'

import { groupAuditIssues } from '../src/lib/audit.js'
import { APP_SECTIONS, getOnboardingSteps, getReadinessFocus, getReadinessScore } from '../src/lib/workspace.js'
import { parseRoute, workspacePath } from '../src/lib/router.js'
import {
  buildRankConfigPatch,
  buildWorkspaceSettingsPatch,
  createWorkspaceSetupState,
  summarizeWorkspaceSetup,
} from '../src/lib/workspaceSetup.js'

test('onboarding steps preserve readiness order and scoring', () => {
  const steps = getOnboardingSteps({
    googleConnected: true,
    workspaceSettings: {
      gsc_site_url: 'sc-domain:example.com',
      ga4_property_id: '',
      rank_domain: 'example.com',
    },
    keywordCount: 4,
    competitorCount: 0,
  })

  assert.equal(steps[0].id, 'google')
  assert.equal(steps[2].done, false)
  assert.equal(getReadinessScore(steps), 67)
})

test('focus points to the first missing dependency', () => {
  const focus = getReadinessFocus(getOnboardingSteps({
    googleConnected: false,
    workspaceSettings: {},
    keywordCount: 0,
    competitorCount: 0,
  }))

  assert.match(focus.title, /Connect Google/i)
  assert.equal(focus.action, 'Open organization settings')
})

test('focus routes workspace-scoped gaps into workspace setup', () => {
  const focus = getReadinessFocus(getOnboardingSteps({
    googleConnected: true,
    workspaceSettings: {
      gsc_site_url: '',
      ga4_property_id: '',
      rank_domain: '',
    },
    keywordCount: 0,
    competitorCount: 0,
  }))

  assert.equal(focus.action, 'Open workspace setup')
})

test('focus promotes operations once setup is complete', () => {
  const focus = getReadinessFocus(getOnboardingSteps({
    googleConnected: true,
    workspaceSettings: {
      gsc_site_url: 'sc-domain:example.com',
      ga4_property_id: '123',
      rank_domain: 'example.com',
      google_ads_customer_id: '1234567890',
    },
    keywordCount: 12,
    competitorCount: 3,
  }))

  assert.equal(focus.action, 'Run full sync')
})

test('workspace setup state merges workspace settings and rank config', () => {
  const setup = createWorkspaceSetupState(
    {
      gsc_site_url: 'sc-domain:example.com',
      ga4_property_id: '12345',
      google_ads_customer_id: '999888777',
      google_ads_developer_token_label: 'agency-ads',
      audit_entry_url: 'https://example.com',
      audit_max_pages: 40,
    },
    {
      domain: 'example.com',
      gl: 'ca',
      hl: 'fr',
      frequency: 'daily',
      weekday: 5,
      hour: 9,
    },
  )

  assert.equal(setup.gscSiteUrl, 'sc-domain:example.com')
  assert.equal(setup.ga4PropertyId, '12345')
  assert.equal(setup.googleAdsCustomerId, '999888777')
  assert.equal(setup.rankDomain, 'example.com')
  assert.equal(setup.rankCountry, 'ca')
  assert.equal(setup.rankLanguage, 'fr')
  assert.equal(setup.rankFrequency, 'daily')
  assert.equal(setup.rankWeekday, 5)
  assert.equal(setup.rankHour, 9)
  assert.equal(setup.auditEntryUrl, 'https://example.com')
  assert.equal(setup.auditMaxPages, 40)
})

test('workspace setup patch builders preserve split backend contracts', () => {
  const setup = {
    gscSiteUrl: 'sc-domain:example.com',
    ga4PropertyId: '12345',
    googleAdsCustomerId: '999888777',
    googleAdsDeveloperTokenLabel: 'agency-ads',
    pageSpeedCredentialLabel: 'psi-prod',
    rankApiCredentialLabel: 'rank-prod',
    auditEntryUrl: 'https://example.com',
    auditMaxPages: '35',
    rankDomain: 'example.com',
    rankCountry: 'us',
    rankLanguage: 'en',
    rankFrequency: 'weekly',
    rankWeekday: 1,
    rankHour: 6,
  }

  assert.deepEqual(buildWorkspaceSettingsPatch(setup), {
    gscSiteUrl: 'sc-domain:example.com',
    ga4PropertyId: '12345',
    googleAdsCustomerId: '999888777',
    googleAdsDeveloperTokenLabel: 'agency-ads',
    pageSpeedCredentialLabel: 'psi-prod',
    rankApiCredentialLabel: 'rank-prod',
    auditEntryUrl: 'https://example.com',
    auditMaxPages: 35,
  })

  assert.deepEqual(buildRankConfigPatch(setup), {
    domain: 'example.com',
    gl: 'us',
    hl: 'en',
    frequency: 'weekly',
    weekday: 1,
    hour: 6,
  })
})

test('workspace setup summary reflects readiness and workspace setup action', () => {
  const summary = summarizeWorkspaceSetup({
    googleConnected: true,
    setup: {
      gscSiteUrl: '',
      ga4PropertyId: '12345',
      googleAdsCustomerId: '',
      rankDomain: '',
    },
    workspace: {
      keywordCount: 0,
      competitorCount: 0,
    },
  })

  assert.equal(summary.readinessScore, 33)
  assert.equal(summary.focus.action, 'Open workspace setup')
})

test('workspace routes include the dedicated setup section', () => {
  const path = workspacePath('precision-garage', 'setup', { range: '30d' })
  assert.equal(path, '/app/precision-garage/setup?range=30d')

  assert.deepEqual(parseRoute('/app/precision-garage/setup', '?range=30d'), {
    type: 'workspace',
    workspaceSlug: 'precision-garage',
    section: 'setup',
    query: { range: '30d' },
  })
})

test('workspace navigation keeps setup as the final tab', () => {
  assert.equal(APP_SECTIONS.at(-1)?.id, 'setup')
})

test('grouped audit issues preserve every unique url without clipping', () => {
  const grouped = groupAuditIssues([
    { severity: 'medium', code: 'missing_h1', url: 'https://example.com/a', message: 'Missing H1.' },
    { severity: 'medium', code: 'missing_h1', url: 'https://example.com/b', message: 'Missing H1.' },
    { severity: 'medium', code: 'missing_h1', url: 'https://example.com/a', message: 'Missing H1.' },
    { severity: 'low', code: 'canonical_missing', url: 'https://example.com/c', message: 'Canonical missing.' },
  ])

  assert.equal(grouped.length, 2)
  assert.deepEqual(grouped[0].urls, ['https://example.com/a', 'https://example.com/b'])
  assert.equal(grouped[0].urls.length, 2)
})
