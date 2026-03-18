const WORKSPACE_SECTIONS = new Set(['overview', 'rankings', 'audit', 'competitors', 'reports', 'ads'])
const SETTINGS_SECTIONS = new Set(['team', 'organization'])

export function parseRoute(pathname = window.location.pathname, search = window.location.search) {
  const segments = pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)
  const query = Object.fromEntries(new URLSearchParams(search).entries())

  if (!segments.length) return { type: 'root', query }

  if (segments[0] === 'login') return { type: 'login', query }
  if (segments[0] === 'signup') return { type: 'signup', query }
  if (segments[0] === 'accept-invite') return { type: 'acceptInvite', query }
  if (segments[0] === 'forgot-password') return { type: 'forgotPassword', query }
  if (segments[0] === 'reset-password') return { type: 'resetPassword', query }
  if (segments[0] === 'onboarding') return { type: 'onboarding', query }

  if (segments[0] === 'app' && segments[1] === 'portfolio') {
    return { type: 'portfolio', query }
  }

  if (segments[0] === 'app' && segments[1] === 'settings' && SETTINGS_SECTIONS.has(segments[2])) {
    return { type: 'settings', section: segments[2], query }
  }

  if (segments[0] === 'app' && segments[1] && WORKSPACE_SECTIONS.has(segments[2])) {
    return { type: 'workspace', workspaceSlug: segments[1], section: segments[2], query }
  }

  return { type: 'notFound', query }
}

export function navigate(path, options = {}) {
  const method = options.replace ? 'replaceState' : 'pushState'
  window.history[method]({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export function portfolioPath(query = {}) {
  return `/app/portfolio${buildQueryString(query)}`
}

export function workspacePath(workspaceSlug, section = 'overview', query = {}) {
  return `/app/${workspaceSlug}/${section}${buildQueryString(query)}`
}

export function settingsPath(section = 'organization', query = {}) {
  return `/app/settings/${section}${buildQueryString(query)}`
}

export function buildQueryString(query = {}) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(query || {})) {
    if (value == null || value === '') continue
    search.set(key, String(value))
  }

  const queryString = search.toString()
  return queryString ? `?${queryString}` : ''
}
