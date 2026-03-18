import test from 'node:test'
import assert from 'node:assert/strict'

import { getOnboardingSteps, getReadinessFocus, getReadinessScore } from '../src/lib/workspace.js'

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
