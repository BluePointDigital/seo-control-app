import test from 'node:test'
import assert from 'node:assert/strict'

import { getDateRangeState, getDateRangeWindow, mergeDateRangeQuery } from '../src/lib/dateRange.js'

test('date range defaults to a 30 day preset', () => {
  const range = getDateRangeState({})
  assert.equal(range.mode, 'preset')
  assert.equal(range.days, 30)
  assert.deepEqual(range.query, { days: '30' })
})

test('custom date ranges preserve explicit start and end dates', () => {
  const range = getDateRangeState({ startDate: '2026-03-01', endDate: '2026-03-07' })
  assert.equal(range.mode, 'custom')
  assert.equal(range.days, 7)
  assert.equal(range.label, '2026-03-01 to 2026-03-07')
})

test('range query merging replaces previous date parameters', () => {
  const query = mergeDateRangeQuery({ days: '30', connected: 'google' }, { mode: 'custom', startDate: '2026-03-01', endDate: '2026-03-07' })
  assert.deepEqual(query, { connected: 'google', startDate: '2026-03-01', endDate: '2026-03-07' })
})

test('preset windows expand into inclusive date boundaries', () => {
  const range = getDateRangeWindow({ mode: 'preset', days: 7 }, new Date('2026-03-07T12:00:00Z'))
  assert.deepEqual(range, { startDate: '2026-03-01', endDate: '2026-03-07' })
})
