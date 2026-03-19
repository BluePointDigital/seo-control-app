import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { DatabaseSync } from 'node:sqlite'

import { createApp } from '../server/app.js'
import { runDueRankSyncs } from '../server/lib/scheduler.js'

function createTempPaths() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seo-agency-'))
  return {
    dataDir,
    dbPath: path.join(dataDir, 'app.db'),
    backupsDir: path.join(dataDir, 'backups'),
    reportDir: path.join(dataDir, 'reports'),
  }
}

function createTempDist(t) {
  const distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seo-agency-dist-'))
  fs.mkdirSync(path.join(distDir, 'assets'), { recursive: true })
  fs.writeFileSync(path.join(distDir, 'index.html'), '<!doctype html><html><body><div id="root">Hosted app shell</div></body></html>')
  fs.writeFileSync(path.join(distDir, 'assets', 'app.js'), 'console.log("hosted-app")')
  t.after(() => {
    fs.rmSync(distDir, { recursive: true, force: true })
  })
  return distDir
}

async function startTestServer(t, overrides = {}) {
  const paths = createTempPaths()
  const instance = createApp({
    ...paths,
    publicSignupEnabled: true,
    appMasterKey: 'test-master-key',
    sessionSecret: 'test-session-secret',
    webOrigin: 'http://localhost:5173',
    appBaseUrl: 'http://localhost:8787',
    schedulerEnabled: false,
    ...overrides,
  })

  const server = instance.app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  const address = server.address()
  const baseUrl = `http://127.0.0.1:${address.port}`

  t.after(() => {
    server.close()
    instance.close()
    fs.rmSync(paths.dataDir, { recursive: true, force: true })
  })

  return { ...paths, baseUrl, context: instance.context, client: createClient(baseUrl) }
}

function createClient(baseUrl) {
  const jar = new Map()

  function applySetCookies(response) {
    const setCookies = response.headers.getSetCookie ? response.headers.getSetCookie() : []
    for (const entry of setCookies) {
      const first = entry.split(';')[0]
      const index = first.indexOf('=')
      if (index === -1) continue
      const key = first.slice(0, index)
      const value = first.slice(index + 1)
      if (value) jar.set(key, value)
      else jar.delete(key)
    }
  }

  return {
    async request(requestPath, options = {}) {
      const headers = {
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      }
      if (jar.size) {
        headers.cookie = [...jar.entries()].map(([key, value]) => `${key}=${value}`).join('; ')
      }

      const response = await fetch(`${baseUrl}${requestPath}`, {
        method: options.method || 'GET',
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      })

      applySetCookies(response)
      const contentType = response.headers.get('content-type') || ''
      const data = contentType.includes('application/json') ? await response.json() : await response.text()
      return { status: response.status, ok: response.ok, data }
    },
  }
}

function bearer(token) {
  return { authorization: `Bearer ${token}` }
}

test('register, resume session, login, logout, and workspace isolation work', async (t) => {
  const { client } = await startTestServer(t)

  const register = await client.request('/api/auth/register', {
    method: 'POST',
    body: {
      email: 'owner@agency.com',
      displayName: 'Agency Owner',
      password: 'agency-pass-123',
      organizationName: 'Agency One',
      workspaceName: 'Client One',
    },
  })

  assert.equal(register.status, 200)
  assert.equal(register.data.role, 'owner')
  assert.equal(register.data.workspaces.length, 1)

  const me = await client.request('/api/auth/me')
  assert.equal(me.data.authenticated, true)
  const firstWorkspace = me.data.workspaces[0]

  const createWorkspace = await client.request('/api/workspaces', {
    method: 'POST',
    body: { name: 'Client Two' },
  })
  assert.equal(createWorkspace.status, 200)

  const workspaces = await client.request('/api/workspaces')
  assert.equal(workspaces.data.items.length, 2)
  const secondWorkspace = workspaces.data.items.find((item) => item.id !== firstWorkspace.id)

  await client.request(`/api/workspaces/${firstWorkspace.id}/rank/keywords`, {
    method: 'POST',
    body: { keyword: 'agency seo software' },
  })

  const firstKeywords = await client.request(`/api/workspaces/${firstWorkspace.id}/rank/keywords`)
  const secondKeywords = await client.request(`/api/workspaces/${secondWorkspace.id}/rank/keywords`)
  assert.equal(firstKeywords.data.items.length, 1)
  assert.equal(secondKeywords.data.items.length, 0)

  const logout = await client.request('/api/auth/logout', { method: 'POST' })
  assert.equal(logout.status, 200)

  const afterLogout = await client.request('/api/auth/me')
  assert.equal(afterLogout.data.authenticated, false)

  const login = await client.request('/api/auth/login', {
    method: 'POST',
    body: { email: 'owner@agency.com', password: 'agency-pass-123' },
  })
  assert.equal(login.status, 200)
  assert.equal(login.data.organization.name, 'Agency One')
})

test('invite acceptance creates a member session and enforces role permissions', async (t) => {
  const { baseUrl, client: owner } = await startTestServer(t)

  await owner.request('/api/auth/register', {
    method: 'POST',
    body: {
      email: 'owner@agency.com',
      displayName: 'Agency Owner',
      password: 'agency-pass-123',
      organizationName: 'Agency One',
      workspaceName: 'Client One',
    },
  })

  const invite = await owner.request('/api/org/invitations', {
    method: 'POST',
    body: { email: 'member@agency.com', role: 'member' },
  })
  assert.equal(invite.status, 200)
  const token = new URL(invite.data.acceptUrl).searchParams.get('token')

  const member = createClient(baseUrl)
  const preview = await member.request(`/api/auth/invite/${token}`)
  assert.equal(preview.data.email, 'member@agency.com')

  const accept = await member.request('/api/auth/accept-invite', {
    method: 'POST',
    body: {
      token,
      displayName: 'Team Member',
      password: 'member-pass-123',
    },
  })
  assert.equal(accept.status, 200)
  assert.equal(accept.data.role, 'member')

  const forbidden = await member.request('/api/workspaces', {
    method: 'POST',
    body: { name: 'Blocked Workspace' },
  })
  assert.equal(forbidden.status, 403)
})

test('api tokens authenticate with bearer headers, filter workspaces, and audit token-triggered jobs', async (t) => {
  const { client, context } = await startTestServer(t)

  const register = await client.request('/api/auth/register', {
    method: 'POST',
    body: {
      email: 'owner-agent@agency.com',
      displayName: 'Agency Owner',
      password: 'agency-pass-123',
      organizationName: 'Agency Agents',
      workspaceName: 'Client Alpha',
    },
  })
  const workspaceAlpha = register.data.workspaces[0].id

  const createWorkspace = await client.request('/api/workspaces', {
    method: 'POST',
    body: { name: 'Client Beta' },
  })
  assert.equal(createWorkspace.status, 200)
  const workspaceBeta = createWorkspace.data.id

  const tokenCreate = await client.request('/api/org/api-tokens', {
    method: 'POST',
    body: {
      label: 'Primary agent',
      scopes: ['read', 'write', 'run'],
      workspaceIds: [workspaceAlpha],
    },
  })
  assert.equal(tokenCreate.status, 200)
  assert.match(tokenCreate.data.token, /^seo_pat_/)

  const agentHeaders = bearer(tokenCreate.data.token)

  const me = await client.request('/api/auth/me', { headers: agentHeaders })
  assert.equal(me.status, 200)
  assert.equal(me.data.authType, 'api_token')
  assert.equal(me.data.principal.label, 'Primary agent')
  assert.equal(me.data.workspaces.length, 1)
  assert.equal(me.data.workspaces[0].id, workspaceAlpha)

  const workspaces = await client.request('/api/workspaces', { headers: agentHeaders })
  assert.equal(workspaces.status, 200)
  assert.deepEqual(workspaces.data.items.map((item) => item.id), [workspaceAlpha])

  const allowed = await client.request(`/api/workspaces/${workspaceAlpha}/summary`, { headers: agentHeaders })
  assert.equal(allowed.status, 200)

  const blocked = await client.request(`/api/workspaces/${workspaceBeta}/summary`, { headers: agentHeaders })
  assert.equal(blocked.status, 404)

  const settingsUpdate = await client.request(`/api/workspaces/${workspaceAlpha}/settings`, {
    method: 'PATCH',
    headers: agentHeaders,
    body: { rankDomain: 'agent-client.test' },
  })
  assert.equal(settingsUpdate.status, 200)

  const generatedReport = await client.request(`/api/workspaces/${workspaceAlpha}/reports/generate`, {
    method: 'POST',
    headers: agentHeaders,
    body: { type: 'weekly' },
  })
  assert.equal(generatedReport.status, 200)

  const jobRecord = context.db.prepare(`
    SELECT triggered_by_api_token_id
    FROM jobs
    WHERE id = ?
  `).get(generatedReport.data.jobId)
  assert.equal(jobRecord.triggered_by_api_token_id, tokenCreate.data.item.id)

  const precedence = await client.request('/api/workspaces', {
    headers: { ...agentHeaders, authorization: 'Bearer definitely-invalid-token' },
  })
  assert.equal(precedence.status, 401)

  const revoke = await client.request(`/api/org/api-tokens/${tokenCreate.data.item.id}/revoke`, {
    method: 'POST',
  })
  assert.equal(revoke.status, 200)

  const revoked = await client.request('/api/workspaces', { headers: agentHeaders })
  assert.equal(revoked.status, 401)
})

test('api token scopes are enforced for read, write, and run actions', async (t) => {
  const { client } = await startTestServer(t)

  const register = await client.request('/api/auth/register', {
    method: 'POST',
    body: {
      email: 'owner-scopes@agency.com',
      displayName: 'Agency Owner',
      password: 'agency-pass-123',
      organizationName: 'Agency Scopes',
      workspaceName: 'Scoped Client',
    },
  })
  const workspaceId = register.data.workspaces[0].id

  const tokenCreate = await client.request('/api/org/api-tokens', {
    method: 'POST',
    body: {
      label: 'Read only agent',
      scopes: ['read'],
      workspaceIds: [workspaceId],
    },
  })
  assert.equal(tokenCreate.status, 200)
  const agentHeaders = bearer(tokenCreate.data.token)

  const read = await client.request(`/api/workspaces/${workspaceId}/summary`, { headers: agentHeaders })
  assert.equal(read.status, 200)

  const write = await client.request(`/api/workspaces/${workspaceId}/settings`, {
    method: 'PATCH',
    headers: agentHeaders,
    body: { rankDomain: 'should-fail.test' },
  })
  assert.equal(write.status, 403)

  const run = await client.request(`/api/workspaces/${workspaceId}/reports/generate`, {
    method: 'POST',
    headers: agentHeaders,
    body: { type: 'weekly' },
  })
  assert.equal(run.status, 403)
})

test('expired api tokens are rejected and bearer auth is blocked on session-only routes', async (t) => {
  const { client } = await startTestServer(t)

  const register = await client.request('/api/auth/register', {
    method: 'POST',
    body: {
      email: 'owner-expired@agency.com',
      displayName: 'Agency Owner',
      password: 'agency-pass-123',
      organizationName: 'Agency Expired',
      workspaceName: 'Expired Client',
    },
  })
  const workspaceId = register.data.workspaces[0].id

  const expiredTokenCreate = await client.request('/api/org/api-tokens', {
    method: 'POST',
    body: {
      label: 'Expired agent',
      scopes: ['read'],
      workspaceIds: [workspaceId],
      expiresAt: '2020-01-01',
    },
  })
  assert.equal(expiredTokenCreate.status, 200)

  const expired = await client.request('/api/workspaces', {
    headers: bearer(expiredTokenCreate.data.token),
  })
  assert.equal(expired.status, 401)

  const validTokenCreate = await client.request('/api/org/api-tokens', {
    method: 'POST',
    body: {
      label: 'Session-only check',
      scopes: ['read'],
      workspaceIds: [workspaceId],
    },
  })
  assert.equal(validTokenCreate.status, 200)

  const logout = await client.request('/api/auth/logout', {
    method: 'POST',
    headers: bearer(validTokenCreate.data.token),
  })
  assert.equal(logout.status, 403)

  const orgRoute = await client.request('/api/org/members', {
    headers: bearer(validTokenCreate.data.token),
  })
  assert.equal(orgRoute.status, 403)
})

test('password reset and org isolation are enforced', async (t) => {
  const { baseUrl } = await startTestServer(t)
  const ownerA = createClient(baseUrl)
  const ownerB = createClient(baseUrl)

  const signupA = await ownerA.request('/api/auth/register', {
    method: 'POST',
    body: {
      email: 'owner-a@agency.com',
      displayName: 'Owner A',
      password: 'agency-pass-123',
      organizationName: 'Agency A',
      workspaceName: 'Client A',
    },
  })
  const signupB = await ownerB.request('/api/auth/register', {
    method: 'POST',
    body: {
      email: 'owner-b@agency.com',
      displayName: 'Owner B',
      password: 'agency-pass-123',
      organizationName: 'Agency B',
      workspaceName: 'Client B',
    },
  })

  const workspaceA = signupA.data.workspaces[0].id
  const workspaceB = signupB.data.workspaces[0].id

  const resetRequest = await createClient(baseUrl).request('/api/auth/password/request-reset', {
    method: 'POST',
    body: { email: 'owner-a@agency.com' },
  })
  const resetToken = new URL(resetRequest.data.resetUrl).searchParams.get('token')

  const reset = await createClient(baseUrl).request('/api/auth/password/reset', {
    method: 'POST',
    body: { token: resetToken, password: 'agency-pass-456' },
  })
  assert.equal(reset.status, 200)

  const relogin = await createClient(baseUrl).request('/api/auth/login', {
    method: 'POST',
    body: { email: 'owner-a@agency.com', password: 'agency-pass-456' },
  })
  assert.equal(relogin.status, 200)

  const isolated = await ownerA.request(`/api/workspaces/${workspaceB}/summary`)
  assert.equal(isolated.status, 404)
  const allowed = await ownerA.request(`/api/workspaces/${workspaceA}/summary`)
  assert.equal(allowed.status, 200)
})

test('legacy project database is backed up before the SaaS schema initializes', (t) => {
  const paths = createTempPaths()
  const legacyDb = new DatabaseSync(paths.dbPath)
  legacyDb.exec(`
    CREATE TABLE projects (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);
    CREATE TABLE project_settings (project_id INTEGER, key TEXT, value TEXT);
    CREATE TABLE app_config (key TEXT PRIMARY KEY, value TEXT);
  `)
  legacyDb.close()

  const instance = createApp({
    ...paths,
    publicSignupEnabled: true,
    appMasterKey: 'test-master-key',
    sessionSecret: 'test-session-secret',
    webOrigin: 'http://localhost:5173',
    appBaseUrl: 'http://localhost:8787',
    schedulerEnabled: false,
  })

  t.after(() => {
    instance.close()
    fs.rmSync(paths.dataDir, { recursive: true, force: true })
  })

  assert.equal(instance.context.backupInfo.performed, true)
  assert.ok(fs.existsSync(instance.context.backupInfo.path))

  const rows = instance.context.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'organizations'").all()
  assert.equal(rows.length, 1)
})

test('production mode serves built assets and falls back to index.html for app routes', async (t) => {
  const distDir = createTempDist(t)
  const { baseUrl } = await startTestServer(t, {
    nodeEnv: 'production',
    distDir,
    webOrigin: 'https://seo.example.test',
    appBaseUrl: 'https://seo.example.test',
    secureCookies: true,
    trustProxy: true,
  })

  const root = await fetch(`${baseUrl}/`)
  assert.equal(root.status, 200)
  assert.match(await root.text(), /Hosted app shell/)

  const appRoute = await fetch(`${baseUrl}/app/settings/organization`)
  assert.equal(appRoute.status, 200)
  assert.match(await appRoute.text(), /Hosted app shell/)

  const asset = await fetch(`${baseUrl}/assets/app.js`)
  assert.equal(asset.status, 200)
  assert.match(await asset.text(), /hosted-app/)

  const health = await fetch(`${baseUrl}/api/health`)
  assert.equal(health.status, 200)
  const healthJson = await health.json()
  assert.equal(healthJson.ok, true)
})

test('google ads asset lookup returns setup availability when developer token is missing', async (t) => {
  const { client } = await startTestServer(t, {
    googleClientId: 'test-google-client',
    googleClientSecret: 'test-google-secret',
    googleRedirectUri: 'http://localhost:8787/api/org/google/callback',
  })

  const register = await client.request('/api/auth/register', {
    method: 'POST',
    body: {
      email: 'owner@agency.com',
      displayName: 'Agency Owner',
      password: 'agency-pass-123',
      organizationName: 'Agency One',
      workspaceName: 'Client One',
    },
  })

  assert.equal(register.status, 200)
  await client.request('/api/org/credentials', {
    method: 'POST',
    body: {
      provider: 'google_oauth_tokens',
      label: 'default',
      value: JSON.stringify({ access_token: 'test-access-token', token_type: 'Bearer' }),
    },
  })

  const assets = await client.request('/api/org/google/assets/ads-customers')
  assert.equal(assets.status, 200)
  assert.equal(assets.data.items.length, 0)
  assert.equal(assets.data.availability.state, 'missing_ads_developer_token')
})

test('summary and rank endpoints honor the selected date range and custom reports persist it', async (t) => {
  const { client, context } = await startTestServer(t)

  const register = await client.request('/api/auth/register', {
    method: 'POST',
    body: {
      email: 'owner@agency.com',
      displayName: 'Agency Owner',
      password: 'agency-pass-123',
      organizationName: 'Agency One',
      workspaceName: 'Client One',
    },
  })
  const workspaceId = register.data.workspaces[0].id

  context.db.prepare(`
    INSERT INTO workspace_gsc_daily (workspace_id, site_url, date, clicks, impressions, ctr, position)
    VALUES (?, 'sc-domain:client.com', '2026-03-01', 10, 100, 0.1, 5),
           (?, 'sc-domain:client.com', '2026-03-02', 20, 200, 0.1, 4),
           (?, 'sc-domain:client.com', '2026-03-03', 30, 300, 0.1, 3)
  `).run(workspaceId, workspaceId, workspaceId)
  const primaryProfileId = context.db.prepare("SELECT id FROM rank_profiles WHERE workspace_id = ? ORDER BY id LIMIT 1").get(workspaceId).id
  context.db.prepare(`
    INSERT INTO rank_daily (workspace_id, profile_id, keyword, date, position, found_url, map_pack_position, map_pack_found_url, map_pack_found_name)
    VALUES (?, ?, 'seo software', '2026-03-01', 12, 'https://client.com/a', 3, 'https://client.com/local', 'Client Maps'),
           (?, ?, 'seo software', '2026-03-02', 9, 'https://client.com/a', 2, 'https://client.com/local', 'Client Maps'),
           (?, ?, 'seo software', '2026-03-03', 7, 'https://client.com/a', 1, 'https://client.com/local', 'Client Maps')
  `).run(workspaceId, primaryProfileId, workspaceId, primaryProfileId, workspaceId, primaryProfileId)

  const summary = await client.request(`/api/workspaces/${workspaceId}/summary?startDate=2026-03-02&endDate=2026-03-03`)
  assert.equal(summary.status, 200)
  assert.equal(summary.data.gsc.clicks, 50)
  assert.equal(summary.data.range.startDate, '2026-03-02')
  assert.equal(summary.data.range.endDate, '2026-03-03')

  const ranks = await client.request(`/api/workspaces/${workspaceId}/rank/summary?startDate=2026-03-02&endDate=2026-03-03`)
  assert.equal(ranks.status, 200)
  assert.equal(ranks.data.insights.latestDate, '2026-03-03')
  assert.equal(ranks.data.insights.prevDate, '2026-03-02')
  assert.equal(ranks.data.mapPack.insights.latestDate, '2026-03-03')
  assert.equal(ranks.data.mapPack.insights.top3Keywords, 1)
  assert.equal(ranks.data.mapPack.insights.visibilityScore, 100)

  const report = await client.request(`/api/workspaces/${workspaceId}/reports/generate`, {
    method: 'POST',
    body: { type: 'custom', startDate: '2026-03-02', endDate: '2026-03-03' },
  })
  assert.equal(report.status, 200)
  assert.equal(report.data.periodStart, '2026-03-02')
  assert.equal(report.data.periodEnd, '2026-03-03')
  assert.match(report.data.content, /### Map Pack/)
  assert.match(report.data.content, /Map visibility score: 100/)
  assert.equal(report.data.summary.mapPackVisibilityScore, 100)
  assert.equal(report.data.summary.mapPackTop3Count, 1)

  const history = await client.request(`/api/workspaces/${workspaceId}/reports/history`)
  assert.equal(history.status, 200)
  assert.equal(history.data.items[0].summary.mapPackVisibilityScore, 100)
  assert.equal(history.data.items[0].summary.mapPack.top3Count, 1)
})

test('workspace settings persist audit crawl configuration', async (t) => {
  const { client } = await startTestServer(t)

  const register = await client.request('/api/auth/register', {
    method: 'POST',
    body: {
      email: 'owner-settings@agency.com',
      displayName: 'Agency Owner',
      password: 'agency-pass-123',
      organizationName: 'Agency Settings',
      workspaceName: 'Client Settings',
    },
  })
  const workspaceId = register.data.workspaces[0].id

  const update = await client.request(`/api/workspaces/${workspaceId}/settings`, {
    method: 'PATCH',
    body: {
      rankDomain: 'settings-client.test',
      auditEntryUrl: 'https://www.settings-client.test/',
      auditMaxPages: 12,
      rankApiCredentialLabel: 'rank-west',
      pageSpeedCredentialLabel: 'psi-east',
      googleAdsDeveloperTokenLabel: 'ads-main',
    },
  })
  assert.equal(update.status, 200)
  assert.equal(update.data.settings.audit_entry_url, 'https://www.settings-client.test/')
  assert.equal(update.data.settings.audit_max_pages, '12')
  assert.equal(update.data.settings.rank_api_credential_label, 'rank-west')
  assert.equal(update.data.settings.google_pagespeed_api_label, 'psi-east')
  assert.equal(update.data.settings.google_ads_developer_token_label, 'ads-main')

  const settings = await client.request(`/api/workspaces/${workspaceId}/settings`)
  assert.equal(settings.status, 200)
  assert.equal(settings.data.rank_domain, 'settings-client.test')
  assert.equal(settings.data.audit_entry_url, 'https://www.settings-client.test/')
  assert.equal(settings.data.audit_max_pages, '12')
  assert.equal(settings.data.rank_api_credential_label, 'rank-west')
  assert.equal(settings.data.google_pagespeed_api_label, 'psi-east')
  assert.equal(settings.data.google_ads_developer_token_label, 'ads-main')
})

test('site audit uses selected PageSpeed labels and falls back only to default', async (t) => {
  const { baseUrl, client } = await startTestServer(t)

  const register = await client.request('/api/auth/register', {
    method: 'POST',
    body: {
      email: 'owner-labels@agency.com',
      displayName: 'Agency Owner',
      password: 'agency-pass-123',
      organizationName: 'Agency Labels',
      workspaceName: 'Client Labels',
    },
  })
  const workspaceId = register.data.workspaces[0].id

  await client.request('/api/org/credentials', {
    method: 'POST',
    body: {
      provider: 'google_pagespeed_api',
      label: 'default',
      value: 'pagespeed-default-key',
    },
  })
  await client.request('/api/org/credentials', {
    method: 'POST',
    body: {
      provider: 'google_pagespeed_api',
      label: 'client-a',
      value: 'pagespeed-client-a-key',
    },
  })
  await client.request(`/api/workspaces/${workspaceId}/settings`, {
    method: 'PATCH',
    body: {
      rankDomain: 'labels-client.test',
      pageSpeedCredentialLabel: 'client-a',
    },
  })

  const seenKeys = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (url.startsWith(baseUrl)) {
      return originalFetch(input, init)
    }

    if (url === 'https://labels-client.test/' || url === 'https://labels-client.test/robots.txt' || url === 'https://labels-client.test/sitemap.xml') {
      return new Response(`
        <html>
          <head>
            <title>Client Labels Home</title>
            <meta name="description" content="A descriptive homepage copy block that is comfortably long enough for the audit." />
            <link rel="canonical" href="https://labels-client.test/" />
          </head>
          <body>
            <h1>Home</h1>
          </body>
        </html>
      `, { status: url.endsWith('.txt') || url.endsWith('.xml') ? 404 : 200, headers: { 'content-type': url.endsWith('.txt') || url.endsWith('.xml') ? 'text/plain' : 'text/html' } })
    }

    if (url.startsWith('https://www.googleapis.com/pagespeedonline/')) {
      seenKeys.push(new URL(url).searchParams.get('key'))
      return Response.json({
        lighthouseResult: {
          categories: {
            performance: { score: 0.82 },
            seo: { score: 0.91 },
            accessibility: { score: 0.88 },
            'best-practices': { score: 0.79 },
          },
        },
      })
    }

    throw new Error(`Unexpected fetch: ${url}`)
  }

  t.after(() => {
    globalThis.fetch = originalFetch
  })

  const selectedRun = await client.request(`/api/workspaces/${workspaceId}/audit/run`, {
    method: 'POST',
    body: { entryUrl: 'https://labels-client.test/', maxPages: 10 },
  })
  assert.equal(selectedRun.status, 200)

  await client.request(`/api/workspaces/${workspaceId}/settings`, {
    method: 'PATCH',
    body: {
      pageSpeedCredentialLabel: 'missing-label',
    },
  })

  const fallbackRun = await client.request(`/api/workspaces/${workspaceId}/audit/run`, {
    method: 'POST',
    body: { entryUrl: 'https://labels-client.test/', maxPages: 10 },
  })
  assert.equal(fallbackRun.status, 200)
  assert.deepEqual(seenKeys, [
    'pagespeed-client-a-key',
    'pagespeed-client-a-key',
    'pagespeed-default-key',
    'pagespeed-default-key',
  ])
})

test('site audit does not use non-default PageSpeed labels when the selected and default labels are missing', async (t) => {
  const { baseUrl, client } = await startTestServer(t)

  const register = await client.request('/api/auth/register', {
    method: 'POST',
    body: {
      email: 'owner-no-default@agency.com',
      displayName: 'Agency Owner',
      password: 'agency-pass-123',
      organizationName: 'Agency No Default',
      workspaceName: 'Client No Default',
    },
  })
  const workspaceId = register.data.workspaces[0].id

  await client.request('/api/org/credentials', {
    method: 'POST',
    body: {
      provider: 'google_pagespeed_api',
      label: 'backup',
      value: 'pagespeed-backup-key',
    },
  })
  await client.request(`/api/workspaces/${workspaceId}/settings`, {
    method: 'PATCH',
    body: {
      rankDomain: 'no-default-pagespeed.test',
      pageSpeedCredentialLabel: 'missing-label',
    },
  })

  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (url.startsWith(baseUrl)) {
      return originalFetch(input, init)
    }

    if (url === 'https://no-default-pagespeed.test/' || url === 'https://no-default-pagespeed.test/robots.txt' || url === 'https://no-default-pagespeed.test/sitemap.xml') {
      return new Response(`
        <html>
          <head>
            <title>No Default PageSpeed</title>
            <meta name="description" content="A descriptive homepage copy block that is comfortably long enough for the audit." />
            <link rel="canonical" href="https://no-default-pagespeed.test/" />
          </head>
          <body>
            <h1>Home</h1>
          </body>
        </html>
      `, { status: url.endsWith('.txt') || url.endsWith('.xml') ? 404 : 200, headers: { 'content-type': url.endsWith('.txt') || url.endsWith('.xml') ? 'text/plain' : 'text/html' } })
    }

    if (url.startsWith('https://www.googleapis.com/pagespeedonline/')) {
      throw new Error('PageSpeed request should not use a non-default fallback label.')
    }

    throw new Error(`Unexpected fetch: ${url}`)
  }

  t.after(() => {
    globalThis.fetch = originalFetch
  })

  const run = await client.request(`/api/workspaces/${workspaceId}/audit/run`, {
    method: 'POST',
    body: { entryUrl: 'https://no-default-pagespeed.test/', maxPages: 10 },
  })
  assert.equal(run.status, 200)

  const latest = await client.request(`/api/workspaces/${workspaceId}/audit/latest`)
  assert.equal(latest.status, 200)
  assert.match(latest.data.item.details.pageSpeed.error, /not configured/i)
})

test('site audit stores diagnostics, pagespeed data, and history for partial crawls', async (t) => {
  const { baseUrl, client } = await startTestServer(t)

  const register = await client.request('/api/auth/register', {
    method: 'POST',
    body: {
      email: 'owner@agency.com',
      displayName: 'Agency Owner',
      password: 'agency-pass-123',
      organizationName: 'Agency One',
      workspaceName: 'Client One',
    },
  })
  const workspaceId = register.data.workspaces[0].id

  await client.request('/api/org/credentials', {
    method: 'POST',
    body: {
      provider: 'google_pagespeed_api',
      label: 'default',
      value: 'pagespeed-key',
    },
  })
  await client.request(`/api/workspaces/${workspaceId}/settings`, {
    method: 'PATCH',
    body: { rankDomain: 'client.test' },
  })

  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (url.startsWith(baseUrl)) {
      return originalFetch(input, init)
    }

    if (url === 'https://client.test/') {
      return new Response(`
        <html>
          <head>
            <title>Client Home Title</title>
            <meta name="description" content="A descriptive homepage copy block that is comfortably long enough for the audit." />
            <link rel="canonical" href="https://client.test/" />
          </head>
          <body>
            <h1>Home</h1>
            <a href="/about">About</a>
            <a href="/timeout">Timeout</a>
          </body>
        </html>
      `, { status: 200, headers: { 'content-type': 'text/html' } })
    }

    if (url === 'https://client.test/about') {
      return new Response(`
        <html>
          <head>
            <title>Client Home Title</title>
            <meta name="description" content="Short" />
            <link rel="canonical" href="https://client.test/about" />
          </head>
          <body>
            <h1>About</h1>
            <h1>Second heading</h1>
          </body>
        </html>
      `, { status: 200, headers: { 'content-type': 'text/html' } })
    }

    if (url === 'https://client.test/timeout') {
      const error = new Error('Request timed out.')
      error.name = 'AbortError'
      throw error
    }

    if (url.startsWith('https://www.googleapis.com/pagespeedonline/')) {
      const strategy = new URL(url).searchParams.get('strategy') || 'mobile'
      return Response.json({
        id: 'https://client.test/',
        lighthouseResult: {
          finalDisplayedUrl: 'https://client.test/',
          categories: {
            performance: { score: 0.82 },
            seo: { score: 0.91 },
            accessibility: { score: 0.88 },
            'best-practices': { score: 0.79 },
          },
          audits: {
            'first-contentful-paint': {
              id: 'first-contentful-paint',
              title: 'First Contentful Paint',
              description: 'Marks the first text or image paint.',
              numericValue: strategy === 'mobile' ? 1234.56 : 845.22,
              numericUnit: 'millisecond',
              displayValue: strategy === 'mobile' ? '1.2 s' : '0.8 s',
              score: 0.92,
              scoreDisplayMode: 'numeric',
            },
            'largest-contentful-paint': {
              id: 'largest-contentful-paint',
              title: 'Largest Contentful Paint',
              description: 'Marks the largest paint in the viewport.',
              numericValue: strategy === 'mobile' ? 2450.1 : 1780.4,
              numericUnit: 'millisecond',
              displayValue: strategy === 'mobile' ? '2.5 s' : '1.8 s',
              score: 0.81,
              scoreDisplayMode: 'numeric',
            },
            'total-blocking-time': {
              id: 'total-blocking-time',
              title: 'Total Blocking Time',
              description: 'Sums blocking time between FCP and TTI.',
              numericValue: strategy === 'mobile' ? 220 : 110,
              numericUnit: 'millisecond',
              displayValue: strategy === 'mobile' ? '220 ms' : '110 ms',
              score: 0.76,
              scoreDisplayMode: 'numeric',
            },
            'cumulative-layout-shift': {
              id: 'cumulative-layout-shift',
              title: 'Cumulative Layout Shift',
              description: 'Measures layout instability.',
              numericValue: 0.03,
              numericUnit: 'unitless',
              displayValue: '0.03',
              score: 0.98,
              scoreDisplayMode: 'numeric',
            },
            'speed-index': {
              id: 'speed-index',
              title: 'Speed Index',
              description: 'Measures how quickly content is visually displayed.',
              numericValue: strategy === 'mobile' ? 3010 : 2140,
              numericUnit: 'millisecond',
              displayValue: strategy === 'mobile' ? '3.0 s' : '2.1 s',
              score: 0.72,
              scoreDisplayMode: 'numeric',
            },
            interactive: {
              id: 'interactive',
              title: 'Time to Interactive',
              description: 'Measures page responsiveness.',
              numericValue: strategy === 'mobile' ? 4010 : 2550,
              numericUnit: 'millisecond',
              displayValue: strategy === 'mobile' ? '4.0 s' : '2.6 s',
              score: 0.68,
              scoreDisplayMode: 'numeric',
            },
            'render-blocking-resources': {
              id: 'render-blocking-resources',
              title: 'Eliminate render-blocking resources',
              description: 'Resources are blocking the first paint of your page. <a href="https://example.com">Learn more</a>.',
              displayValue: 'Est savings of 320 ms',
              score: 0.24,
              scoreDisplayMode: 'metricSavings',
              details: {
                type: 'opportunity',
                overallSavingsMs: 320,
                overallSavingsBytes: 24500,
              },
            },
            'unused-css-rules': {
              id: 'unused-css-rules',
              title: 'Reduce unused CSS',
              description: 'Reduce unused CSS to improve load performance.',
              displayValue: 'Est savings of 12 KiB',
              score: 0.35,
              scoreDisplayMode: 'metricSavings',
              details: {
                type: 'opportunity',
                overallSavingsMs: 110,
                overallSavingsBytes: 12288,
              },
            },
            'bootup-time': {
              id: 'bootup-time',
              title: 'Reduce JavaScript execution time',
              description: 'Consider reducing the time spent parsing, compiling, and executing JS.',
              displayValue: '1.7 s',
              score: 0.41,
              scoreDisplayMode: 'numeric',
            },
            'aria-hidden-focus': {
              id: 'aria-hidden-focus',
              title: 'ARIA hidden element contains focusable descendants',
              description: 'Focusable content should not be hidden from assistive technology.',
              displayValue: 'Failing elements found',
              score: 0,
              scoreDisplayMode: 'binary',
            },
            'uses-long-cache-ttl': {
              id: 'uses-long-cache-ttl',
              title: 'Uses efficient cache policy on static assets',
              description: 'Static assets use an efficient cache policy.',
              score: 1,
              scoreDisplayMode: 'binary',
            },
          },
        },
      })
    }

    throw new Error(`Unexpected fetch: ${url}`)
  }

  t.after(() => {
    globalThis.fetch = originalFetch
  })

  const run = await client.request(`/api/workspaces/${workspaceId}/audit/run`, {
    method: 'POST',
    body: { entryUrl: 'https://client.test/', maxPages: 10 },
  })
  assert.equal(run.status, 200)

  const latest = await client.request(`/api/workspaces/${workspaceId}/audit/latest`)
  assert.equal(latest.status, 200)
  assert.equal(latest.data.item.details.pagesCrawled, 2)
  assert.equal(latest.data.item.details.timedOutPages, 1)
  assert.equal(latest.data.item.details.pageSpeed.mobile.seo, 91)
  assert.equal(latest.data.item.details.pageSpeed.mobile.metrics.length, 6)
  assert.equal(latest.data.item.details.pageSpeed.mobile.opportunities.length, 2)
  assert.equal(latest.data.item.details.pageSpeed.mobile.diagnostics.length >= 2, true)
  assert.equal(latest.data.item.details.pageSpeed.mobile.passedAudits.length >= 1, true)
  assert.match(latest.data.item.details.pageSpeed.mobile.reportUrl, /pagespeed\.web\.dev/)
  assert.equal(latest.data.item.details.pageSpeed.mobile.opportunities[0].description.includes('<a'), false)
  assert.equal(latest.data.item.details.pageSpeed.desktop.metrics.length, 6)
  assert.equal(latest.data.item.details.issueCounts.severity.medium >= 1, true)

  const history = await client.request(`/api/workspaces/${workspaceId}/audit/history`)
  assert.equal(history.status, 200)
  assert.equal(history.data.items.length, 1)
  assert.equal(history.data.items[0].pagesCrawled, 2)
})

test('site audit flags thin coverage and pagespeed failures instead of reporting a perfect baseline', async (t) => {
  const { baseUrl, client } = await startTestServer(t)

  const register = await client.request('/api/auth/register', {
    method: 'POST',
    body: {
      email: 'owner2@agency.com',
      displayName: 'Agency Owner',
      password: 'agency-pass-123',
      organizationName: 'Agency Two',
      workspaceName: 'Client Two',
    },
  })
  const workspaceId = register.data.workspaces[0].id

  await client.request('/api/org/credentials', {
    method: 'POST',
    body: {
      provider: 'google_pagespeed_api',
      label: 'default',
      value: 'pagespeed-key',
    },
  })
  await client.request(`/api/workspaces/${workspaceId}/settings`, {
    method: 'PATCH',
    body: { rankDomain: 'single-page.test' },
  })

  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (url.startsWith(baseUrl)) {
      return originalFetch(input, init)
    }

    if (url === 'https://single-page.test/robots.txt' || url === 'https://single-page.test/sitemap.xml') {
      return new Response('', { status: 404, headers: { 'content-type': 'text/plain' } })
    }

    if (url === 'https://single-page.test/') {
      return new Response(`
        <html>
          <head>
            <title>Single Page Title</title>
            <meta name="description" content="This single page contains a sufficiently descriptive summary for the audit." />
            <link rel="canonical" href="https://single-page.test/" />
          </head>
          <body>
            <h1>Single page</h1>
          </body>
        </html>
      `, { status: 200, headers: { 'content-type': 'text/html' } })
    }

    if (url.startsWith('https://www.googleapis.com/pagespeedonline/')) {
      const error = new Error('Request timed out.')
      error.name = 'AbortError'
      throw error
    }

    throw new Error(`Unexpected fetch: ${url}`)
  }

  t.after(() => {
    globalThis.fetch = originalFetch
  })

  const run = await client.request(`/api/workspaces/${workspaceId}/audit/run`, {
    method: 'POST',
    body: { entryUrl: 'https://single-page.test/', maxPages: 10 },
  })
  assert.equal(run.status, 200)

  const latest = await client.request(`/api/workspaces/${workspaceId}/audit/latest`)
  assert.equal(latest.status, 200)
  const issues = latest.data.item.issues.map((issue) => issue.code)
  assert.equal(issues.includes('pagespeed_unavailable'), true)
  assert.equal(issues.includes('limited_crawl_coverage'), true)
  assert.equal(issues.includes('internal_links_not_discovered'), true)
  assert.equal(latest.data.item.healthScore < 100, true)
})


test('site audit treats bare and www URLs as the same site for discovery', async (t) => {
  const { baseUrl, client } = await startTestServer(t)

  const register = await client.request('/api/auth/register', {
    method: 'POST',
    body: {
      email: 'owner3@agency.com',
      displayName: 'Agency Owner',
      password: 'agency-pass-123',
      organizationName: 'Agency Three',
      workspaceName: 'Client Three',
    },
  })
  const workspaceId = register.data.workspaces[0].id

  await client.request('/api/org/credentials', {
    method: 'POST',
    body: {
      provider: 'google_pagespeed_api',
      label: 'default',
      value: 'pagespeed-key',
    },
  })
  await client.request(`/api/workspaces/${workspaceId}/settings`, {
    method: 'PATCH',
    body: { rankDomain: 'host-variant.test' },
  })

  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (url.startsWith(baseUrl)) {
      return originalFetch(input, init)
    }

    if (url === 'https://host-variant.test/robots.txt') {
      return new Response('Sitemap: https://www.host-variant.test/sitemap_index.xml', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      })
    }

    if (url === 'https://host-variant.test/sitemap.xml') {
      return new Response('', { status: 404, headers: { 'content-type': 'text/plain' } })
    }

    if (url === 'https://www.host-variant.test/sitemap_index.xml') {
      return new Response(`
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <url><loc>https://www.host-variant.test/services</loc></url>
          <url><loc>https://www.host-variant.test/contact</loc></url>
        </urlset>
      `, { status: 200, headers: { 'content-type': 'application/xml' } })
    }

    if (url === 'https://host-variant.test/' || url === 'https://www.host-variant.test/') {
      return new Response(`
        <html>
          <head>
            <title>Host Variant Home</title>
            <meta name="description" content="A descriptive homepage copy block that is comfortably long enough for the audit." />
            <link rel="canonical" href="https://www.host-variant.test/" />
          </head>
          <body>
            <h1>Home</h1>
            <a href="https://www.host-variant.test/services">Services</a>
          </body>
        </html>
      `, { status: 200, headers: { 'content-type': 'text/html' } })
    }

    if (url === 'https://host-variant.test/services' || url === 'https://www.host-variant.test/services') {
      return new Response(`
        <html>
          <head>
            <title>Host Variant Services</title>
            <meta name="description" content="A descriptive services page copy block that is comfortably long enough for the audit." />
            <link rel="canonical" href="https://www.host-variant.test/services" />
          </head>
          <body>
            <h1>Services</h1>
          </body>
        </html>
      `, { status: 200, headers: { 'content-type': 'text/html' } })
    }

    if (url === 'https://host-variant.test/contact' || url === 'https://www.host-variant.test/contact') {
      return new Response(`
        <html>
          <head>
            <title>Host Variant Contact</title>
            <meta name="description" content="A descriptive contact page copy block that is comfortably long enough for the audit." />
            <link rel="canonical" href="https://www.host-variant.test/contact" />
          </head>
          <body>
            <h1>Contact</h1>
          </body>
        </html>
      `, { status: 200, headers: { 'content-type': 'text/html' } })
    }

    if (url.startsWith('https://www.googleapis.com/pagespeedonline/')) {
      return Response.json({
        lighthouseResult: {
          categories: {
            performance: { score: 0.72 },
            seo: { score: 0.9 },
            accessibility: { score: 0.84 },
            'best-practices': { score: 0.81 },
          },
        },
      })
    }

    throw new Error(`Unexpected fetch: ${url}`)
  }

  t.after(() => {
    globalThis.fetch = originalFetch
  })

  const run = await client.request(`/api/workspaces/${workspaceId}/audit/run`, {
    method: 'POST',
    body: { entryUrl: 'https://host-variant.test/', maxPages: 10 },
  })
  assert.equal(run.status, 200)

  const latest = await client.request(`/api/workspaces/${workspaceId}/audit/latest`)
  assert.equal(latest.status, 200)
  const issues = latest.data.item.issues.map((issue) => issue.code)
  assert.equal(latest.data.item.details.pagesCrawled >= 3, true)
  assert.equal(latest.data.item.details.pagesQueued >= 3, true)
  assert.equal(issues.includes('limited_crawl_coverage'), false)
  assert.equal(issues.includes('internal_links_not_discovered'), false)
})


test('selected unreadable PageSpeed labels do not silently fall back to default', async (t) => {
  const { client, context } = await startTestServer(t)

  const register = await client.request('/api/auth/register', {
    method: 'POST',
    body: {
      email: 'owner-unreadable@agency.com',
      displayName: 'Agency Owner',
      password: 'agency-pass-123',
      organizationName: 'Agency Unreadable',
      workspaceName: 'Client Unreadable',
    },
  })
  const workspaceId = register.data.workspaces[0].id
  const organizationId = register.data.organization.id

  await client.request('/api/org/credentials', {
    method: 'POST',
    body: {
      provider: 'google_pagespeed_api',
      label: 'default',
      value: 'readable-default-key',
    },
  })
  context.db.prepare(`
    INSERT INTO organization_credentials (organization_id, provider, label, encrypted_value, metadata_json, created_at, updated_at)
    VALUES (?, 'google_pagespeed_api', 'client-a', 'not-a-valid-secret', '{}', datetime('now'), datetime('now'))
  `).run(organizationId)

  await client.request(`/api/workspaces/${workspaceId}/settings`, {
    method: 'PATCH',
    body: {
      rankDomain: 'unreadable-pagespeed.test',
      pageSpeedCredentialLabel: 'client-a',
    },
  })

  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (url.startsWith('https://unreadable-pagespeed.test/')) {
      return new Response(`
        <html>
          <head>
            <title>Unreadable Secret Home</title>
            <meta name="description" content="A descriptive homepage copy block that is comfortably long enough for the audit." />
            <link rel="canonical" href="https://unreadable-pagespeed.test/" />
          </head>
          <body>
            <h1>Home</h1>
          </body>
        </html>
      `, { status: 200, headers: { 'content-type': 'text/html' } })
    }

    if (url === 'https://unreadable-pagespeed.test/robots.txt' || url === 'https://unreadable-pagespeed.test/sitemap.xml') {
      return new Response('', { status: 404, headers: { 'content-type': 'text/plain' } })
    }

    if (url.startsWith('https://www.googleapis.com/pagespeedonline/')) {
      throw new Error('PageSpeed request should not fall back when the selected label is unreadable.')
    }

    return originalFetch(input, init)
  }

  t.after(() => {
    globalThis.fetch = originalFetch
  })

  const run = await client.request(`/api/workspaces/${workspaceId}/audit/run`, {
    method: 'POST',
    body: { entryUrl: 'https://unreadable-pagespeed.test/', maxPages: 10 },
  })
  assert.equal(run.status, 200)

  const latest = await client.request(`/api/workspaces/${workspaceId}/audit/latest`)
  assert.equal(latest.status, 200)
  assert.match(latest.data.item.details.pageSpeed.error, /could not be decrypted/i)
  assert.equal(latest.data.item.details.pageSpeed.mobile, null)
  assert.equal(latest.data.item.details.pageSpeed.desktop, null)
})

test('invalid saved PageSpeed credentials become an audit warning instead of a 500', async (t) => {
  const { client, context } = await startTestServer(t)

  const register = await client.request('/api/auth/register', {
    method: 'POST',
    body: {
      email: 'owner-invalid@agency.com',
      displayName: 'Agency Owner',
      password: 'agency-pass-123',
      organizationName: 'Agency Invalid',
      workspaceName: 'Client Invalid',
    },
  })
  const workspaceId = register.data.workspaces[0].id
  const organizationId = register.data.organization.id

  await client.request(`/api/workspaces/${workspaceId}/settings`, {
    method: 'PATCH',
    body: { rankDomain: 'invalid-pagespeed.test' },
  })

  context.db.prepare(`
    INSERT INTO organization_credentials (organization_id, provider, label, encrypted_value, metadata_json, created_at, updated_at)
    VALUES (?, 'google_pagespeed_api', 'default', 'not-a-valid-secret', '{}', datetime('now'), datetime('now'))
  `).run(organizationId)
  await client.request('/api/org/credentials', {
    method: 'POST',
    body: {
      provider: 'google_pagespeed_api',
      label: 'backup',
      value: 'readable-backup-key',
    },
  })

  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (url.startsWith('https://invalid-pagespeed.test/')) {
      return new Response(`
        <html>
          <head>
            <title>Invalid Secret Home</title>
            <meta name="description" content="A descriptive homepage copy block that is comfortably long enough for the audit." />
            <link rel="canonical" href="https://invalid-pagespeed.test/" />
          </head>
          <body>
            <h1>Home</h1>
          </body>
        </html>
      `, { status: 200, headers: { 'content-type': 'text/html' } })
    }

    if (url === 'https://invalid-pagespeed.test/robots.txt' || url === 'https://invalid-pagespeed.test/sitemap.xml') {
      return new Response('', { status: 404, headers: { 'content-type': 'text/plain' } })
    }

    if (url.startsWith('https://www.googleapis.com/pagespeedonline/')) {
      throw new Error('PageSpeed request should not be attempted when the default label is unreadable.')
    }

    return originalFetch(input, init)
  }

  t.after(() => {
    globalThis.fetch = originalFetch
  })

  const run = await client.request(`/api/workspaces/${workspaceId}/audit/run`, {
    method: 'POST',
    body: { entryUrl: 'https://invalid-pagespeed.test/', maxPages: 10 },
  })
  assert.equal(run.status, 200)

  const latest = await client.request(`/api/workspaces/${workspaceId}/audit/latest`)
  assert.equal(latest.status, 200)
  assert.match(latest.data.item.details.pageSpeed.error, /could not be decrypted/i)
  assert.equal(latest.data.item.details.pageSpeed.mobile, null)
  assert.equal(latest.data.item.details.pageSpeed.desktop, null)

  const credentials = await client.request('/api/org/credentials')
  assert.equal(credentials.status, 200)
  const invalidDefault = credentials.data.items.find((item) => item.provider === 'google_pagespeed_api' && item.label === 'default')
  assert.equal(invalidDefault?.invalid, true)
})

test('rank location lookup validates query and maps SerpApi locations', async (t) => {
  const { baseUrl, client } = await startTestServer(t)

  const register = await client.request('/api/auth/register', {
    method: 'POST',
    body: {
      email: 'owner-locations@agency.com',
      displayName: 'Agency Owner',
      password: 'agency-pass-123',
      organizationName: 'Agency Locations',
      workspaceName: 'Client Locations',
    },
  })
  const workspaceId = register.data.workspaces[0].id

  const empty = await client.request(`/api/workspaces/${workspaceId}/rank/locations`)
  assert.equal(empty.status, 400)

  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (url.startsWith(baseUrl)) {
      return originalFetch(input, init)
    }

    if (url.startsWith('https://serpapi.com/locations.json')) {
      const parsed = new URL(url)
      assert.equal(parsed.searchParams.get('q'), 'Spartanburg')
      return Response.json([
        {
          id: 'loc-spartanburg',
          name: 'Spartanburg, SC',
          canonical_name: 'Spartanburg, SC,South Carolina,United States',
          country_code: 'US',
          target_type: 'City',
          reach: 120000,
        },
      ])
    }

    throw new Error(`Unexpected fetch: ${url}`)
  }

  t.after(() => {
    globalThis.fetch = originalFetch
  })

  const lookup = await client.request(`/api/workspaces/${workspaceId}/rank/locations?q=Spartanburg`)
  assert.equal(lookup.status, 200)
  assert.deepEqual(lookup.data.items[0], {
    id: 'loc-spartanburg',
    name: 'Spartanburg, SC',
    canonicalName: 'Spartanburg, SC,South Carolina,United States',
    countryCode: 'us',
    targetType: 'City',
    reach: 120000,
  })
})

test('rank sync skips active profiles without a configured search location and raises attention alerts', async (t) => {
  const { client } = await startTestServer(t)

  const register = await client.request('/api/auth/register', {
    method: 'POST',
    body: {
      email: 'owner-skip@agency.com',
      displayName: 'Agency Owner',
      password: 'agency-pass-123',
      organizationName: 'Agency Skip',
      workspaceName: 'Client Skip',
    },
  })
  const workspaceId = register.data.workspaces[0].id

  await client.request('/api/org/credentials', {
    method: 'POST',
    body: {
      provider: 'dataforseo_or_serpapi',
      label: 'default',
      value: 'serp-key',
    },
  })

  await client.request(`/api/workspaces/${workspaceId}/rank/config`, {
    method: 'PATCH',
    body: { domain: 'client-skip.test', frequency: 'weekly', weekday: 1, hour: 6 },
  })

  await client.request(`/api/workspaces/${workspaceId}/rank/keywords`, {
    method: 'POST',
    body: { keyword: 'garage door repair spartanburg sc', landingPage: 'https://client-skip.test/spartanburg/' },
  })

  const sync = await client.request(`/api/workspaces/${workspaceId}/jobs/run-sync`, {
    method: 'POST',
    body: { source: 'rank' },
  })
  assert.equal(sync.status, 200)
  assert.equal(sync.data.result.rank.keywordsChecked, 0)
  assert.equal(sync.data.result.rank.keywordsSkipped, 1)
  assert.equal(sync.data.result.rank.partial, true)

  const alerts = await client.request(`/api/workspaces/${workspaceId}/alerts?status=open`)
  assert.equal(alerts.status, 200)
  assert.equal(alerts.data.items.some((item) => item.alertType === 'sync_failed'), true)
})

test('rank sync and scheduler use workspace-selected rank API labels with default-only fallback', async (t) => {
  const { baseUrl, client, context } = await startTestServer(t)

  const register = await client.request('/api/auth/register', {
    method: 'POST',
    body: {
      email: 'owner-rank-labels@agency.com',
      displayName: 'Agency Owner',
      password: 'agency-pass-123',
      organizationName: 'Agency Rank Labels',
      workspaceName: 'Client Rank Labels',
    },
  })
  const workspaceId = register.data.workspaces[0].id
  const currentHour = new Date().getHours()

  await client.request('/api/org/credentials', {
    method: 'POST',
    body: {
      provider: 'dataforseo_or_serpapi',
      label: 'default',
      value: 'rank-default-key',
    },
  })
  await client.request('/api/org/credentials', {
    method: 'POST',
    body: {
      provider: 'dataforseo_or_serpapi',
      label: 'west',
      value: 'rank-west-key',
    },
  })
  await client.request(`/api/workspaces/${workspaceId}/rank/config`, {
    method: 'PATCH',
    body: {
      domain: 'rank-labels.test',
      frequency: 'daily',
      hour: currentHour,
    },
  })

  const profile = await client.request(`/api/workspaces/${workspaceId}/rank/profiles`, {
    method: 'POST',
    body: {
      name: 'West Market',
      locationLabel: 'Spartanburg, SC',
      searchLocationId: 'loc-spartanburg',
      searchLocationName: 'Spartanburg, SC,South Carolina,United States',
      businessName: 'Rank Label Client',
      gl: 'us',
      hl: 'en',
    },
  })
  assert.equal(profile.status, 200)
  const profileId = profile.data.item.id

  await client.request(`/api/workspaces/${workspaceId}/rank/keywords`, {
    method: 'POST',
    body: {
      profileId,
      keyword: 'garage door repair rank labels',
      landingPage: 'https://rank-labels.test/',
    },
  })

  const seenKeys = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (url.startsWith(baseUrl)) {
      return originalFetch(input, init)
    }

    if (url.startsWith('https://serpapi.com/search.json')) {
      seenKeys.push(new URL(url).searchParams.get('api_key'))
      return Response.json({
        organic_results: [
          { position: 5, link: 'https://rank-labels.test/' },
        ],
        local_results: { places: [] },
      })
    }

    throw new Error(`Unexpected fetch: ${url}`)
  }

  t.after(() => {
    globalThis.fetch = originalFetch
  })

  await client.request(`/api/workspaces/${workspaceId}/settings`, {
    method: 'PATCH',
    body: { rankApiCredentialLabel: 'west' },
  })

  const selectedSync = await client.request(`/api/workspaces/${workspaceId}/jobs/run-sync`, {
    method: 'POST',
    body: { source: 'rank', profileId },
  })
  assert.equal(selectedSync.status, 200)

  await client.request(`/api/workspaces/${workspaceId}/settings`, {
    method: 'PATCH',
    body: { rankApiCredentialLabel: 'missing-label' },
  })

  const fallbackSync = await client.request(`/api/workspaces/${workspaceId}/jobs/run-sync`, {
    method: 'POST',
    body: { source: 'rank', profileId },
  })
  assert.equal(fallbackSync.status, 200)
  assert.deepEqual(seenKeys, ['rank-west-key', 'rank-default-key'])

  const schedulerWorkspace = await client.request('/api/workspaces', {
    method: 'POST',
    body: { name: 'Scheduler Client' },
  })
  const schedulerWorkspaceId = schedulerWorkspace.data.id
  await client.request('/api/org/credentials', {
    method: 'POST',
    body: {
      provider: 'dataforseo_or_serpapi',
      label: 'backup',
      value: 'rank-backup-key',
    },
  })
  await client.request(`/api/workspaces/${schedulerWorkspaceId}/rank/config`, {
    method: 'PATCH',
    body: {
      domain: 'scheduler-rank.test',
      frequency: 'daily',
      hour: currentHour,
    },
  })
  await client.request(`/api/workspaces/${schedulerWorkspaceId}/rank/keywords`, {
    method: 'POST',
    body: {
      keyword: 'scheduler rank keyword',
    },
  })
  await client.request(`/api/workspaces/${schedulerWorkspaceId}/settings`, {
    method: 'PATCH',
    body: { rankApiCredentialLabel: 'missing-label' },
  })
  context.db.prepare('DELETE FROM organization_credentials WHERE organization_id = ? AND provider = ? AND label = ?').run(register.data.organization.id, 'dataforseo_or_serpapi', 'default')

  await runDueRankSyncs(context, { now: new Date() })
  const schedulerJobsBeforeFallback = await client.request(`/api/workspaces/${schedulerWorkspaceId}/jobs`)
  assert.equal(schedulerJobsBeforeFallback.status, 200)
  assert.equal(schedulerJobsBeforeFallback.data.items.length, 0)

  await client.request('/api/org/credentials', {
    method: 'POST',
    body: {
      provider: 'dataforseo_or_serpapi',
      label: 'default',
      value: 'rank-restored-default',
    },
  })

  await runDueRankSyncs(context, { now: new Date() })
  const schedulerJobsAfterFallback = await client.request(`/api/workspaces/${schedulerWorkspaceId}/jobs`)
  assert.equal(schedulerJobsAfterFallback.status, 200)
  assert.equal(schedulerJobsAfterFallback.data.items.length, 1)
})

test('ads asset preview and ads sync use the workspace-selected developer token label', async (t) => {
  const { baseUrl, client } = await startTestServer(t, {
    googleClientId: 'test-google-client',
    googleClientSecret: 'test-google-secret',
    googleRedirectUri: 'http://localhost:8787/api/org/google/callback',
  })

  const register = await client.request('/api/auth/register', {
    method: 'POST',
    body: {
      email: 'owner-ads-labels@agency.com',
      displayName: 'Agency Owner',
      password: 'agency-pass-123',
      organizationName: 'Agency Ads Labels',
      workspaceName: 'Client Ads Labels',
    },
  })
  const workspaceId = register.data.workspaces[0].id

  await client.request('/api/org/credentials', {
    method: 'POST',
    body: {
      provider: 'google_oauth_tokens',
      label: 'default',
      value: JSON.stringify({ access_token: 'test-access-token', token_type: 'Bearer' }),
    },
  })
  await client.request('/api/org/credentials', {
    method: 'POST',
    body: {
      provider: 'google_ads_developer_token',
      label: 'default',
      value: 'ads-default-token',
    },
  })
  await client.request('/api/org/credentials', {
    method: 'POST',
    body: {
      provider: 'google_ads_developer_token',
      label: 'west',
      value: 'ads-west-token',
    },
  })
  await client.request(`/api/workspaces/${workspaceId}/settings`, {
    method: 'PATCH',
    body: {
      googleAdsCustomerId: '1234567890',
      googleAdsDeveloperTokenLabel: 'west',
    },
  })

  const developerTokensSeen = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (url.startsWith(baseUrl)) {
      return originalFetch(input, init)
    }

    const developerToken = init?.headers?.['developer-token'] || init?.headers?.get?.('developer-token')

    if (url === 'https://googleads.googleapis.com/v18/customers:listAccessibleCustomers') {
      developerTokensSeen.push(developerToken)
      return Response.json({
        resourceNames: ['customers/1234567890'],
      })
    }

    if (url === 'https://googleads.googleapis.com/v18/customers/1234567890/googleAds:searchStream') {
      developerTokensSeen.push(developerToken)
      const query = JSON.parse(String(init.body || '{}')).query || ''

      if (/customer\.descriptive_name/i.test(query)) {
        return Response.json([
          {
            results: [
              {
                customer: {
                  descriptiveName: 'West Ads Account',
                  currencyCode: 'USD',
                  timeZone: 'America/New_York',
                },
              },
            ],
          },
        ])
      }

      return Response.json([
        {
          results: [
            {
              segments: { date: '2026-03-01' },
              metrics: {
                clicks: 12,
                impressions: 120,
                ctr: 0.1,
                conversions: 3,
                costMicros: 4500000,
              },
            },
          ],
        },
      ])
    }

    throw new Error(`Unexpected fetch: ${url}`)
  }

  t.after(() => {
    globalThis.fetch = originalFetch
  })

  const assetPreview = await client.request(`/api/org/google/assets/ads-customers?workspaceId=${workspaceId}&credentialLabel=west`)
  assert.equal(assetPreview.status, 200)
  assert.equal(assetPreview.data.items[0].displayName, 'West Ads Account')

  const adsSync = await client.request(`/api/workspaces/${workspaceId}/jobs/run-sync`, {
    method: 'POST',
    body: { source: 'ads' },
  })
  assert.equal(adsSync.status, 200)
  assert.deepEqual([...new Set(developerTokensSeen)], ['ads-west-token'])
})

test('rank profiles, bulk keyword sync, map pack capture, and portfolio alerts are profile-aware', async (t) => {
  const { baseUrl, client, context } = await startTestServer(t)

  const register = await client.request('/api/auth/register', {
    method: 'POST',
    body: {
      email: 'owner-rank@agency.com',
      displayName: 'Agency Owner',
      password: 'agency-pass-123',
      organizationName: 'Agency Rank',
      workspaceName: 'Client Rank',
    },
  })
  const workspaceId = register.data.workspaces[0].id

  await client.request('/api/org/credentials', {
    method: 'POST',
    body: {
      provider: 'dataforseo_or_serpapi',
      label: 'default',
      value: 'serp-key',
    },
  })

  await client.request(`/api/workspaces/${workspaceId}/rank/config`, {
    method: 'PATCH',
    body: { domain: 'client-rank.test', frequency: 'weekly', weekday: 1, hour: 6 },
  })

  const profile = await client.request(`/api/workspaces/${workspaceId}/rank/profiles`, {
    method: 'POST',
    body: {
      name: 'Spartanburg Repair',
      locationLabel: 'Spartanburg, SC',
      searchLocationId: 'loc-spartanburg',
      searchLocationName: 'Spartanburg, SC,South Carolina,United States',
      businessName: 'Precision Garage Door Service',
      gl: 'us',
      hl: 'en',
    },
  })
  assert.equal(profile.status, 200)
  const profileId = profile.data.item.id
  assert.equal(profile.data.item.searchLocationId, 'loc-spartanburg')
  assert.equal(profile.data.item.searchLocationName, 'Spartanburg, SC,South Carolina,United States')
  assert.equal(profile.data.item.businessName, 'Precision Garage Door Service')

  const bulk = await client.request(`/api/workspaces/${workspaceId}/rank/keywords/bulk`, {
    method: 'POST',
    body: {
      profileId,
      items: [
        { keyword: 'garage door repair spartanburg sc', landingPage: 'https://client-rank.test/spartanburg/', priority: 'high' },
        { keyword: 'broken garage door spring spartanburg', landingPage: 'https://client-rank.test/spartanburg/', priority: 'high' },
        { keyword: 'garage door opener spartanburg sc', landingPage: 'https://client-rank.test/spartanburg/', priority: 'medium' },
        { keyword: 'emergency garage door repair spartanburg', landingPage: 'https://client-rank.test/spartanburg/', priority: 'high' },
      ],
    },
  })
  assert.equal(bulk.status, 200)

  const keywords = await client.request(`/api/workspaces/${workspaceId}/rank/profiles/${profileId}/keywords`)
  assert.equal(keywords.status, 200)
  assert.equal(keywords.data.items.length, 4)

  context.db.prepare(`
    INSERT INTO rank_daily (workspace_id, profile_id, keyword, date, position, found_url)
    VALUES (?, ?, 'garage door repair spartanburg sc', '2026-03-01', 12, 'https://client-rank.test/spartanburg/'),
           (?, ?, 'broken garage door spring spartanburg', '2026-03-01', 4, 'https://client-rank.test/spartanburg/')
  `).run(workspaceId, profileId, workspaceId, profileId)

  const originalFetch = globalThis.fetch
  const seenLocations = []
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (url.startsWith(baseUrl)) {
      return originalFetch(input, init)
    }

    if (url.startsWith('https://serpapi.com/search.json')) {
      const parsed = new URL(url)
      seenLocations.push(parsed.searchParams.get('location'))
      const keywordValue = parsed.searchParams.get('q')
      if (keywordValue === 'garage door repair spartanburg sc') {
        return Response.json({
          organic_results: [
            { position: 7, link: 'https://www.client-rank.test/spartanburg/' },
          ],
          local_results: {
            places: [
              {
                position: 3,
                title: 'Precision Garage Door Service',
                links: {
                  website: 'https://www.client-rank.test/spartanburg/',
                },
              },
            ],
          },
        })
      }

      if (keywordValue === 'broken garage door spring spartanburg') {
        return Response.json({
          organic_results: [
            { position: 2, link: 'https://www.client-rank.test/spartanburg/' },
          ],
          local_results: {
            places: [
              {
                position: 2,
                title: 'Precision Garage Door',
              },
            ],
          },
        })
      }

      if (keywordValue === 'garage door opener spartanburg sc') {
        return Response.json({
          organic_results: [],
          local_results: {
            places: [
              {
                position: 1,
                title: 'Downtown Door Repair',
                links: {
                  website: 'https://client-rank.test/service-area/',
                },
              },
            ],
          },
        })
      }

      if (keywordValue === 'emergency garage door repair spartanburg') {
        return Response.json({
          organic_results: [],
          local_results: {
            places: [
              {
                position: 1,
                title: 'Other Listing',
                links: {
                  website: 'https://different-site.test/',
                },
              },
            ],
          },
        })
      }
    }

    throw new Error(`Unexpected fetch: ${url}`)
  }

  t.after(() => {
    globalThis.fetch = originalFetch
  })

  const sync = await client.request(`/api/workspaces/${workspaceId}/jobs/run-sync`, {
    method: 'POST',
    body: { source: 'rank', profileId },
  })
  assert.equal(sync.status, 200)
  assert.equal(sync.data.result.rank.keywordsChecked, 4)
  assert.deepEqual([...new Set(seenLocations)], ['loc-spartanburg'])

  const rankDate = sync.data.result.rank.date
  const rows = context.db.prepare(`
    SELECT keyword, position, map_pack_position, map_pack_found_url, map_pack_found_name
    FROM rank_daily
    WHERE workspace_id = ? AND profile_id = ? AND date = ?
    ORDER BY keyword COLLATE NOCASE
  `).all(workspaceId, profileId, rankDate).map((row) => ({ ...row }))
  assert.deepEqual(rows, [
    {
      keyword: 'broken garage door spring spartanburg',
      position: 2,
      map_pack_position: 2,
      map_pack_found_url: null,
      map_pack_found_name: 'Precision Garage Door',
    },
    {
      keyword: 'emergency garage door repair spartanburg',
      position: null,
      map_pack_position: null,
      map_pack_found_url: null,
      map_pack_found_name: null,
    },
    {
      keyword: 'garage door opener spartanburg sc',
      position: null,
      map_pack_position: 1,
      map_pack_found_url: 'https://client-rank.test/service-area/',
      map_pack_found_name: 'Downtown Door Repair',
    },
    {
      keyword: 'garage door repair spartanburg sc',
      position: 7,
      map_pack_position: 3,
      map_pack_found_url: 'https://www.client-rank.test/spartanburg/',
      map_pack_found_name: 'Precision Garage Door Service',
    },
  ])

  const rankSummary = await client.request(`/api/workspaces/${workspaceId}/rank/summary?startDate=${rankDate}&endDate=${rankDate}`)
  assert.equal(rankSummary.status, 200)
  assert.equal(rankSummary.data.insights.rankedKeywords, 2)
  assert.equal(rankSummary.data.mapPack.insights.rankedKeywords, 3)
  assert.equal(rankSummary.data.mapPack.insights.top3Keywords, 3)
  assert.equal(rankSummary.data.mapPack.insights.top1Keywords, 1)
  assert.equal(rankSummary.data.mapPack.insights.visibilityScore, 50)
  assert.equal(rankSummary.data.mapPack.items.find((item) => item.keyword === 'garage door repair spartanburg sc').foundName, 'Precision Garage Door Service')

  const alerts = await client.request(`/api/workspaces/${workspaceId}/alerts?status=open&profileId=${profileId}`)
  assert.equal(alerts.status, 200)
  assert.equal(alerts.data.items.some((item) => item.alertType === 'entered_top_10'), true)
  assert.equal(alerts.data.items.some((item) => item.alertType === 'new_top_3'), true)

  const portfolio = await client.request('/api/org/portfolio')
  assert.equal(portfolio.status, 200)
  assert.equal(portfolio.data.summary.openAlertCount >= 2, true)
  assert.equal(portfolio.data.summary.workspacesWithMapPackCoverage, 1)
  assert.equal(portfolio.data.summary.avgMapPackVisibilityScore, 50)
  assert.equal(portfolio.data.summary.totalMapPackTop3Keywords, 3)
  assert.equal(portfolio.data.items[0].mapPackVisibilityScore, 50)
  assert.equal(portfolio.data.items[0].mapPackRankedKeywords, 3)
  assert.equal(portfolio.data.items[0].mapPackTop3Keywords, 3)

  const orgAlerts = await client.request('/api/org/alerts?status=open')
  assert.equal(orgAlerts.status, 200)
  const alertId = orgAlerts.data.items[0].id

  const resolve = await client.request(`/api/org/alerts/${alertId}`, {
    method: 'PATCH',
    body: { status: 'resolved' },
  })
  assert.equal(resolve.status, 200)

  const resolvedAlerts = await client.request('/api/org/alerts?status=resolved')
  assert.equal(resolvedAlerts.status, 200)
  assert.equal(resolvedAlerts.data.items.some((item) => item.id === alertId), true)
})

test('rank schema migrations backfill location identity fields and preserve null map pack history', async (t) => {
  const paths = createTempPaths()
  const legacyDb = new DatabaseSync(paths.dbPath)
  legacyDb.exec(`
    CREATE TABLE rank_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      location_label TEXT NOT NULL DEFAULT '',
      gl TEXT NOT NULL DEFAULT 'us',
      hl TEXT NOT NULL DEFAULT 'en',
      device TEXT NOT NULL DEFAULT 'desktop',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE rank_daily (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL,
      profile_id INTEGER NOT NULL,
      keyword TEXT NOT NULL,
      date TEXT NOT NULL,
      position INTEGER,
      found_url TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (profile_id, keyword, date)
    );
  `)
  legacyDb.prepare(`
    INSERT INTO rank_profiles (workspace_id, name, slug, location_label, gl, hl, device, active)
    VALUES (1, 'Legacy Profile', 'legacy-profile', 'Spartanburg, SC', 'us', 'en', 'desktop', 1)
  `).run()
  legacyDb.prepare(`
    INSERT INTO rank_daily (workspace_id, profile_id, keyword, date, position, found_url)
    VALUES (1, 1, 'legacy keyword', '2026-03-01', 9, 'https://legacy.example.com/page/')
  `).run()
  legacyDb.close()

  const instance = createApp({
    ...paths,
    distDir: createTempDist(t),
    publicSignupEnabled: true,
    appMasterKey: 'test-master-key',
    sessionSecret: 'test-session-secret',
    webOrigin: 'http://localhost:5173',
    appBaseUrl: 'http://localhost:8787',
    schedulerEnabled: false,
  })

  t.after(() => {
    instance.close()
    fs.rmSync(paths.dataDir, { recursive: true, force: true })
  })

  const migratedProfile = instance.context.db.prepare(`
    SELECT search_location_id, search_location_name, business_name
    FROM rank_profiles
    WHERE id = 1
  `).get()
  assert.deepEqual({ ...migratedProfile }, {
    search_location_id: '',
    search_location_name: 'Spartanburg, SC',
    business_name: 'Legacy Profile',
  })

  const migratedDaily = instance.context.db.prepare(`
    SELECT map_pack_position, map_pack_found_url, map_pack_found_name
    FROM rank_daily
    WHERE id = 1
  `).get()
  assert.deepEqual({ ...migratedDaily }, {
    map_pack_position: null,
    map_pack_found_url: null,
    map_pack_found_name: null,
  })
})
