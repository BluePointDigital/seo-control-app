import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildReportExportUrl,
  formatReportSummaryLine,
  getFindingAccordionValues,
  getReportSectionMeta,
  getReportSectionsIncluded,
  getReportSummaryMetrics,
  getVisualReportPresentation,
} from '../src/lib/reports.js'

test('report section helpers preserve saved section selections', () => {
  const summary = {
    sectionsIncluded: ['findings', 'executive', 'findings'],
  }

  assert.deepEqual(getReportSectionsIncluded(summary), ['executive', 'findings'])
  assert.deepEqual(getReportSectionMeta(summary).map((item) => item.shortLabel), ['Executive', 'Findings'])
})

test('report export urls preserve existing query state and add export params', () => {
  assert.equal(
    buildReportExportUrl('https://example.com/app/client/reports?range=90d', 42),
    'https://example.com/app/client/reports?range=90d&reportId=42&export=1',
  )
})

test('report summary helpers fall back gracefully for legacy reports', () => {
  const summary = {
    visibilityScore: 67,
    mapPackVisibilityScore: 22,
    top10Count: 14,
    mapPackTop3Count: 3,
    healthScore: 81,
  }
  const metrics = getReportSummaryMetrics(summary)

  assert.deepEqual(metrics, {
    organicVisibility: 67,
    mapVisibility: 22,
    top10Count: 14,
    top3Count: 3,
    healthScore: 81,
  })
  assert.equal(formatReportSummaryLine(summary), 'Organic 67 / Map 22 / Top 10 14 / Top 3 pack 3 / Health 81')
  assert.equal(getVisualReportPresentation({}), null)
})

test('finding accordion values preserve every grouped issue id', () => {
  assert.deepEqual(getFindingAccordionValues({
    items: [
      { severity: 'high', code: 'missing_h1' },
      { severity: 'medium', code: 'duplicate_title' },
    ],
  }), ['high:missing_h1', 'medium:duplicate_title'])
})
