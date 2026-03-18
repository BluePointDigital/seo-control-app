const PRESET_DAYS = new Set([7, 30, 90])

export function getDateRangeState(query = {}) {
  if (query.startDate && query.endDate && isIsoDate(query.startDate) && isIsoDate(query.endDate) && query.startDate <= query.endDate) {
    return {
      mode: 'custom',
      days: diffInDays(query.startDate, query.endDate),
      startDate: query.startDate,
      endDate: query.endDate,
      query: { startDate: query.startDate, endDate: query.endDate },
      label: `${query.startDate} to ${query.endDate}`,
      shortLabel: 'Custom',
    }
  }

  const days = PRESET_DAYS.has(Number(query.days)) ? Number(query.days) : 30
  return {
    mode: 'preset',
    days,
    startDate: '',
    endDate: '',
    query: { days: String(days) },
    label: `Last ${days} days`,
    shortLabel: `${days}d`,
  }
}

export function getDateRangeWindow(range, now = new Date()) {
  if (range?.mode === 'custom' && range.startDate && range.endDate) {
    return { startDate: range.startDate, endDate: range.endDate }
  }

  const days = Number(range?.days || 30)
  const endDate = formatDateValue(now)
  const start = new Date(now)
  start.setDate(start.getDate() - (days - 1))
  return {
    startDate: formatDateValue(start),
    endDate,
  }
}

export function toDateRangeQuery(range) {
  if (range?.mode === 'custom' && range.startDate && range.endDate) {
    return { startDate: range.startDate, endDate: range.endDate }
  }

  const days = PRESET_DAYS.has(Number(range?.days)) ? Number(range.days) : 30
  return { days: String(days) }
}

export function mergeDateRangeQuery(query = {}, range) {
  const next = { ...query }
  delete next.days
  delete next.startDate
  delete next.endDate
  return { ...next, ...toDateRangeQuery(range) }
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))
}

function formatDateValue(value) {
  return new Date(value).toISOString().slice(0, 10)
}

function diffInDays(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00Z`)
  const end = new Date(`${endDate}T00:00:00Z`)
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1)
}
