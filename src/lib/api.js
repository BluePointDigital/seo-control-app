export async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || 'GET',
    headers: {
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    credentials: 'same-origin',
  })

  const contentType = response.headers.get('content-type') || ''
  const payload = contentType.includes('application/json') ? await response.json() : await response.text()
  if (!response.ok) {
    throw new Error(typeof payload === 'string' ? payload : (payload?.error || 'Request failed.'))
  }

  return payload
}

export function buildApiPath(path, query = {}) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(query || {})) {
    if (value == null || value === '') continue
    search.set(key, String(value))
  }

  const queryString = search.toString()
  return queryString ? `${path}?${queryString}` : path
}
