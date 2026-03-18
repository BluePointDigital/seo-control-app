import crypto from 'crypto'

export const SESSION_COOKIE_NAME = 'seo_session'
export const API_TOKEN_PREFIX = 'seo_pat_'
const PASSWORD_VERSION = 1

export function createSecurity(config) {
  const encryptionKey = crypto.createHash('sha256').update(config.appMasterKey).digest()
  const sessionSecret = Buffer.from(String(config.sessionSecret || ''))

  function encryptSecret(value = '') {
    const iv = crypto.randomBytes(16)
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv)
    const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return Buffer.concat([iv, tag, encrypted]).toString('base64')
  }

  function decryptSecret(payload = '') {
    const buffer = Buffer.from(String(payload || ''), 'base64')
    const iv = buffer.subarray(0, 16)
    const tag = buffer.subarray(16, 32)
    const encrypted = buffer.subarray(32)
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, iv)
    decipher.setAuthTag(tag)
    return decipher.update(encrypted, undefined, 'utf8') + decipher.final('utf8')
  }

  function createOpaqueToken() {
    return crypto.randomBytes(32).toString('base64url')
  }

  function createApiTokenValue() {
    const secret = crypto.randomBytes(32).toString('base64url')
    const token = `${API_TOKEN_PREFIX}${secret}`
    return {
      token,
      tokenPrefix: `${API_TOKEN_PREFIX}${secret.slice(0, 8)}`,
    }
  }

  function hashToken(value = '') {
    return crypto.createHash('sha256').update(String(value || '')).digest('hex')
  }

  function signToken(token = '') {
    return crypto.createHmac('sha256', sessionSecret).update(String(token || '')).digest('base64url')
  }

  function packSignedToken(token = '') {
    return `${token}.${signToken(token)}`
  }

  function unpackSignedToken(packed = '') {
    const [token, signature] = String(packed || '').split('.')
    if (!token || !signature) return null
    const expected = signToken(token)
    const a = Buffer.from(signature)
    const b = Buffer.from(expected)
    if (a.length !== b.length) return null
    if (!crypto.timingSafeEqual(a, b)) return null
    return token
  }

  function hashPassword(password = '') {
    const salt = crypto.randomBytes(16).toString('hex')
    const hash = crypto.scryptSync(String(password), salt, 64).toString('hex')
    return { hash, salt, version: PASSWORD_VERSION }
  }

  function verifyPassword(password = '', user = {}) {
    const derived = crypto.scryptSync(String(password), String(user.password_salt || ''), 64)
    const stored = Buffer.from(String(user.password_hash || ''), 'hex')
    if (derived.length !== stored.length) return false
    return crypto.timingSafeEqual(stored, derived)
  }

  function serializeSessionCookie(token, options = {}) {
    const maxAgeSeconds = Number(options.maxAgeSeconds || 60 * 60 * 24 * 14)
    const parts = [
      `${SESSION_COOKIE_NAME}=${packSignedToken(token)}`,
      'Path=/',
      `Max-Age=${maxAgeSeconds}`,
      'HttpOnly',
      'SameSite=Lax',
    ]
    if (options.secure) parts.push('Secure')
    return parts.join('; ')
  }

  function clearSessionCookie(options = {}) {
    const parts = [
      `${SESSION_COOKIE_NAME}=`,
      'Path=/',
      'Max-Age=0',
      'HttpOnly',
      'SameSite=Lax',
      'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    ]
    if (options.secure) parts.push('Secure')
    return parts.join('; ')
  }

  return {
    encryptSecret,
    decryptSecret,
    createOpaqueToken,
    createApiTokenValue,
    hashToken,
    packSignedToken,
    unpackSignedToken,
    hashPassword,
    verifyPassword,
    serializeSessionCookie,
    clearSessionCookie,
  }
}

export function parseCookies(header = '') {
  return String(header || '')
    .split(';')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .reduce((acc, chunk) => {
      const index = chunk.indexOf('=')
      if (index === -1) return acc
      const key = chunk.slice(0, index).trim()
      const value = chunk.slice(index + 1).trim()
      acc[key] = value
      return acc
    }, {})
}
