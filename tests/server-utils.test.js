import test from 'node:test'
import assert from 'node:assert/strict'

import { extractDomainFromUrl, maskSecret, normalizeDomain, safeJsonParse, slugify } from '../server/lib/utils.js'
import {
  normalizeCustomerId,
  normalizePropertyId,
  validateApiTokenExpiry,
  validateApiTokenLabel,
  validateApiTokenScopes,
  validateApiTokenWorkspaceIds,
  validateCompetitorDomain,
  validateEmail,
  validateKeyword,
  validateOrganizationName,
  validateReportType,
  validateSyncSource,
  validateWorkspaceName,
} from '../server/lib/validation.js'

test('slugify normalizes workspace names', () => {
  assert.equal(slugify('My New Client!!!'), 'my-new-client')
})

test('domain helpers normalize hosts consistently', () => {
  assert.equal(normalizeDomain('https://www.Example.com/'), 'example.com')
  assert.equal(extractDomainFromUrl('https://blog.example.com/page'), 'blog.example.com')
  assert.equal(validateCompetitorDomain('https://www.rival.com/'), 'rival.com')
})

test('validation helpers normalize supported values', () => {
  assert.equal(validateOrganizationName('Agency Alpha'), 'Agency Alpha')
  assert.equal(validateWorkspaceName('Client Bravo'), 'Client Bravo')
  assert.equal(validateEmail('Owner@Agency.com'), 'owner@agency.com')
  assert.equal(validateKeyword('  seo software  '), 'seo software')
  assert.equal(validateSyncSource('ADS'), 'ads')
  assert.equal(validateReportType('Monthly'), 'monthly')
  assert.equal(normalizePropertyId('properties/12345'), '12345')
  assert.equal(normalizeCustomerId('123-456-7890'), '1234567890')
  assert.equal(validateApiTokenLabel('Agent Token'), 'Agent Token')
  assert.deepEqual(validateApiTokenScopes(['READ', 'run']), ['read', 'run'])
  assert.deepEqual(validateApiTokenWorkspaceIds(['1', 2, 2]), [1, 2])
  assert.equal(validateApiTokenExpiry('2026-04-01').startsWith('2026-04-01T'), true)
})

test('utility helpers handle masking and invalid json', () => {
  assert.equal(maskSecret('abcdefgh12345678'), 'abcd****5678')
  assert.deepEqual(safeJsonParse('{"ok":true}', {}), { ok: true })
  assert.equal(safeJsonParse('{bad json}', null), null)
})
