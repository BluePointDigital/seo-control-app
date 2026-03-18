import test from 'node:test'
import assert from 'node:assert/strict'

import { createSecurity } from '../server/lib/security.js'

test('security helpers hash passwords and sign session tokens', () => {
  const security = createSecurity({ appMasterKey: 'test-master-key', sessionSecret: 'test-session-secret' })
  const passwordState = security.hashPassword('agency-pass-123')

  assert.equal(security.verifyPassword('agency-pass-123', {
    password_hash: passwordState.hash,
    password_salt: passwordState.salt,
  }), true)
  assert.equal(security.verifyPassword('wrong-pass', {
    password_hash: passwordState.hash,
    password_salt: passwordState.salt,
  }), false)

  const token = security.createOpaqueToken()
  const packed = security.packSignedToken(token)
  assert.equal(security.unpackSignedToken(packed), token)
  assert.equal(security.unpackSignedToken(`${token}.tampered`), null)

  const apiToken = security.createApiTokenValue()
  assert.match(apiToken.token, /^seo_pat_/)
  assert.match(apiToken.tokenPrefix, /^seo_pat_/)
})
