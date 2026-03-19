export function groupAuditIssues(issues = [], severityFilter = 'all') {
  const groups = new Map()

  for (const issue of issues || []) {
    const key = `${issue.code || 'unknown'}|${issue.severity || 'low'}`
    const current = groups.get(key) || {
      ...issue,
      code: issue.code || 'unknown',
      severity: issue.severity || 'low',
      message: issue.message || '',
      urls: [],
    }

    if (issue.url && !current.urls.includes(issue.url)) {
      current.urls.push(issue.url)
    }

    groups.set(key, current)
  }

  return [...groups.values()]
    .filter((issue) => severityFilter === 'all' || issue.severity === severityFilter)
    .sort((left, right) => {
      if (right.urls.length !== left.urls.length) return right.urls.length - left.urls.length
      return String(left.code || '').localeCompare(String(right.code || ''))
    })
}
