import { buildApiTokenAuthPayload, buildAuthPayload, getApiTokenByTokenHash, getSessionByTokenHash, touchApiToken, touchSession } from './data.js'
import { parseCookies, SESSION_COOKIE_NAME } from './security.js'

export function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next)
  }
}

export function attachAuth(context) {
  return (req, res, next) => {
    const bearer = parseBearerToken(req.headers.authorization)
    if (bearer.present) {
      if (!bearer.token) {
        res.status(401).json({ error: 'Invalid API token.' })
        return
      }

      const tokenHash = context.security.hashToken(bearer.token)
      const apiToken = getApiTokenByTokenHash(context.db, tokenHash)
      if (!apiToken || apiToken.revokedAt) {
        res.status(401).json({ error: 'Invalid API token.' })
        return
      }

      if (apiToken.expiresAt && new Date(apiToken.expiresAt).getTime() <= Date.now()) {
        res.status(401).json({ error: 'API token has expired.' })
        return
      }

      if (apiToken.organizationStatus !== 'active') {
        res.status(401).json({ error: 'API token is not attached to an active organization.' })
        return
      }

      touchApiToken(context.db, apiToken.id)
      req.auth = {
        authType: 'api_token',
        tokenId: apiToken.id,
        userId: null,
        organizationId: apiToken.organizationId,
        role: 'api_token',
        scopes: apiToken.scopes,
        allowedWorkspaceIds: apiToken.workspaceIds,
        principal: {
          type: 'api_token',
          tokenId: apiToken.id,
          label: apiToken.label,
          scopes: apiToken.scopes,
          workspaceIds: apiToken.workspaceIds,
        },
        snapshot: () => buildApiTokenAuthPayload(context.db, context.security, apiToken),
      }
      next()
      return
    }

    const cookies = parseCookies(req.headers.cookie)
    const packed = cookies[SESSION_COOKIE_NAME]
    if (!packed) return next()

    const token = context.security.unpackSignedToken(packed)
    if (!token) {
      res.setHeader('Set-Cookie', context.security.clearSessionCookie({ secure: context.config.secureCookies }))
      return next()
    }

    const tokenHash = context.security.hashToken(token)
    const session = getSessionByTokenHash(context.db, tokenHash)
    if (!session) {
      res.setHeader('Set-Cookie', context.security.clearSessionCookie({ secure: context.config.secureCookies }))
      return next()
    }

    if (new Date(session.expires_at).getTime() <= Date.now()) {
      res.setHeader('Set-Cookie', context.security.clearSessionCookie({ secure: context.config.secureCookies }))
      return next()
    }

    if (session.user_status !== 'active' || session.membership_status !== 'active' || session.organization_status !== 'active') {
      res.setHeader('Set-Cookie', context.security.clearSessionCookie({ secure: context.config.secureCookies }))
      return next()
    }

    touchSession(context.db, tokenHash)
    req.sessionTokenHash = tokenHash
    req.auth = {
      authType: 'session',
      sessionId: session.session_id,
      userId: session.user_id,
      organizationId: session.organization_id,
      role: session.role,
      scopes: ['read', 'write', 'run'],
      allowedWorkspaceIds: null,
      principal: {
        type: 'user',
        userId: session.user_id,
        email: session.email,
        role: session.role,
      },
      snapshot: () => buildAuthPayload(context.db, context.security, session.user_id),
    }
    next()
  }
}

export function requireAuth(req, _res, next) {
  if (!req.auth) {
    return next(createError(401, 'Authentication required.'))
  }
  return next()
}

export function requireSessionAuth(req, _res, next) {
  if (!req.auth) return next(createError(401, 'Authentication required.'))
  if (req.auth.authType !== 'session') {
    return next(createError(403, 'This action requires a browser session.'))
  }
  return next()
}

export function disallowApiTokenAuth(req, _res, next) {
  if (req.auth?.authType === 'api_token') {
    return next(createError(403, 'API tokens cannot be used for this route.'))
  }
  return next()
}

export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.auth) return next(createError(401, 'Authentication required.'))
    if (!roles.includes(req.auth.role)) return next(createError(403, 'You do not have permission for this action.'))
    return next()
  }
}

export function requireApiScope(...scopes) {
  return (req, _res, next) => {
    if (!req.auth) return next(createError(401, 'Authentication required.'))
    if (req.auth.authType !== 'api_token') return next()

    const requiredScopes = scopes.map((scope) => String(scope || '').trim().toLowerCase()).filter(Boolean)
    if (!requiredScopes.length) return next()
    if (!requiredScopes.some((scope) => req.auth.scopes.includes(scope))) {
      return next(createError(403, 'This API token does not have permission for this action.'))
    }
    return next()
  }
}

export function createIpRateLimiter({ key = 'default', windowMs = 15 * 60 * 1000, max = 10 } = {}) {
  const hits = new Map()

  return (req, _res, next) => {
    const now = Date.now()
    const ip = String(req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown')
    const entryKey = `${key}:${ip}`
    const recentHits = (hits.get(entryKey) || []).filter((value) => value > now - windowMs)

    if (recentHits.length >= max) {
      return next(createError(429, 'Too many requests. Please wait a moment and try again.'))
    }

    recentHits.push(now)
    hits.set(entryKey, recentHits)
    return next()
  }
}

export function createError(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

function parseBearerToken(authorization = '') {
  const value = String(authorization || '').trim()
  if (!value) return { present: false, token: '' }
  if (!/^Bearer\s+/i.test(value)) return { present: false, token: '' }
  return {
    present: true,
    token: value.replace(/^Bearer\s+/i, '').trim(),
  }
}
