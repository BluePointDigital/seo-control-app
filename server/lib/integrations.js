import { BetaAnalyticsDataClient } from '@google-analytics/data'
import { google } from 'googleapis'

import {
  createWorkspaceAlert,
  getWorkspaceSetting,
  listRankKeywords,
  listRankProfiles,
  setWorkspaceSettings,
  tryGetOrgCredential,
  tryGetOrgCredentialByLabel,
} from './data.js'
import { normalizeLighthousePsiResult } from './lighthouse.js'
import { clamp, extractDomainFromUrl, normalizeDomain, normalizeText, nowIso, safeJsonParse } from './utils.js'
import { normalizeCustomerId, validateSyncSource } from './validation.js'
import {
  DEFAULT_CREDENTIAL_LABEL,
  getWorkspaceCredentialProvider,
  normalizeCredentialLabel,
} from '../../shared/workspaceCredentialProviders.js'

const AUDIT_REQUEST_TIMEOUT_MS = 12000
const AUDIT_PAGESPEED_TIMEOUT_MS = 70000
const AUDIT_MAX_QUEUE_MULTIPLIER = 4
const AUDIT_MIN_USEFUL_PAGES = 3
const AUDIT_USER_AGENT = 'AgencySeoControlBot/0.1 (+https://agency-seo-control.local)'
const RANK_SYNC_RETRY_LIMIT = 3
const RANK_SYNC_RETRY_DELAY_MS = 750

export async function searchSerpApiLocations(query, options = {}) {
  const url = new URL('https://serpapi.com/locations.json')
  url.searchParams.set('q', String(query || '').trim())
  url.searchParams.set('limit', String(Math.max(1, Math.min(10, Number(options.limit || 8)))))

  if (options.apiKey) {
    url.searchParams.set('api_key', options.apiKey)
  }

  const response = await fetch(url)
  if (!response.ok) {
    let payload = null
    try {
      payload = await response.json()
    } catch {
      payload = null
    }
    throw new Error(payload?.error || `SerpApi Locations API failed (${response.status}).`)
  }

  const payload = await response.json()
  return Array.isArray(payload) ? payload : []
}

function readOrgCredential(context, organizationId, provider, invalidMessage = 'Saved credential could not be decrypted. Re-save it in the organization vault.') {
  const result = tryGetOrgCredential(context.db, context.security, organizationId, provider)
  if (result.error) {
    return { value: '', error: invalidMessage }
  }
  return { value: result.value || '', error: '' }
}

function resolveCredentialSelection(context, { organizationId, provider, selectedLabel = DEFAULT_CREDENTIAL_LABEL, invalidMessage = 'Saved credential could not be decrypted. Re-save it in the organization vault.' }) {
  const requestedLabel = normalizeCredentialLabel(selectedLabel)
  const selected = tryGetOrgCredentialByLabel(context.db, context.security, organizationId, provider, requestedLabel)

  if (selected.exists) {
    if (selected.error) {
      return {
        value: '',
        error: invalidMessage,
        requestedLabel,
        effectiveLabel: requestedLabel,
        fallbackUsed: false,
      }
    }

    return {
      value: selected.value || '',
      error: '',
      requestedLabel,
      effectiveLabel: requestedLabel,
      fallbackUsed: false,
    }
  }

  if (requestedLabel !== DEFAULT_CREDENTIAL_LABEL) {
    const fallback = tryGetOrgCredentialByLabel(context.db, context.security, organizationId, provider, DEFAULT_CREDENTIAL_LABEL)
    if (fallback.exists) {
      if (fallback.error) {
        return {
          value: '',
          error: invalidMessage,
          requestedLabel,
          effectiveLabel: DEFAULT_CREDENTIAL_LABEL,
          fallbackUsed: true,
        }
      }

      return {
        value: fallback.value || '',
        error: '',
        requestedLabel,
        effectiveLabel: DEFAULT_CREDENTIAL_LABEL,
        fallbackUsed: true,
      }
    }
  }

  return {
    value: '',
    error: '',
    requestedLabel,
    effectiveLabel: '',
    fallbackUsed: false,
  }
}

export function resolveWorkspaceCredential(context, workspace, providerId, invalidMessage, options = {}) {
  const provider = getWorkspaceCredentialProvider(providerId)
  if (!provider) {
    throw new Error(`Unsupported workspace credential provider: ${providerId}`)
  }

  const selectedLabel = options.credentialLabel == null
    ? getWorkspaceSetting(context.db, workspace.id, provider.settingKey, DEFAULT_CREDENTIAL_LABEL)
    : options.credentialLabel

  return resolveCredentialSelection(context, {
    organizationId: workspace.organizationId,
    provider: provider.id,
    selectedLabel,
    invalidMessage,
  })
}

function getGoogleOAuthClient(config) {
  if (!config.google.clientId || !config.google.clientSecret || !config.google.redirectUri) {
    throw new Error('Google OAuth is not configured in the environment.')
  }

  return new google.auth.OAuth2(config.google.clientId, config.google.clientSecret, config.google.redirectUri)
}

function getAuthedGoogleOAuthClient(context, organizationId) {
  const tokenCredential = readOrgCredential(context, organizationId, 'google_oauth_tokens', 'Stored Google connection could not be decrypted. Reconnect Google.')
  if (tokenCredential.error) throw new Error(tokenCredential.error)
  const tokenRaw = tokenCredential.value
  if (!tokenRaw) throw new Error('Google is not connected for this organization.')

  const tokenJson = safeJsonParse(tokenRaw)
  if (!tokenJson) throw new Error('Stored Google tokens are invalid. Reconnect Google.')

  const client = getGoogleOAuthClient(context.config)
  client.setCredentials(tokenJson)
  return client
}

export function getGoogleStatus(context, organizationId) {
  const tokenCredential = readOrgCredential(context, organizationId, 'google_oauth_tokens', 'Stored Google connection could not be decrypted. Reconnect Google.')
  return {
    configured: Boolean(context.config.google.clientId && context.config.google.clientSecret && context.config.google.redirectUri),
    connected: Boolean(tokenCredential.value),
    credentialIssue: tokenCredential.error,
    redirectUri: context.config.google.redirectUri,
  }
}

export function generateGoogleAuthUrl(context, organizationId, userId) {
  const client = getGoogleOAuthClient(context.config)
  const state = context.security.createOpaqueToken()
  context.db.prepare(`
    INSERT INTO oauth_states (state, organization_id, user_id, provider, created_at)
    VALUES (?, ?, ?, 'google', datetime('now'))
  `).run(state, Number(organizationId), Number(userId))

  const authUrl = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/webmasters.readonly',
      'https://www.googleapis.com/auth/analytics.readonly',
      'https://www.googleapis.com/auth/business.manage',
      'https://www.googleapis.com/auth/adwords',
    ],
    state,
  })

  return { state, authUrl }
}

export async function exchangeGoogleCallback(context, code, state) {
  const stateRow = context.db.prepare('SELECT state, organization_id FROM oauth_states WHERE state = ?').get(String(state || ''))
  if (!stateRow) throw new Error('Invalid or expired Google OAuth state.')

  const client = getGoogleOAuthClient(context.config)
  const { tokens } = await client.getToken(String(code || ''))
  context.db.prepare(`
    INSERT INTO organization_credentials (organization_id, provider, label, encrypted_value, metadata_json, created_at, updated_at)
    VALUES (?, 'google_oauth_tokens', 'default', ?, '{}', datetime('now'), datetime('now'))
    ON CONFLICT(organization_id, provider, label) DO UPDATE
      SET encrypted_value = excluded.encrypted_value,
          updated_at = datetime('now')
  `).run(Number(stateRow.organization_id), context.security.encryptSecret(JSON.stringify(tokens)))
  context.db.prepare('DELETE FROM oauth_states WHERE state = ?').run(String(state || ''))
  return Number(stateRow.organization_id)
}

export function disconnectGoogle(context, organizationId) {
  context.db.prepare(`
    DELETE FROM organization_credentials
    WHERE organization_id = ? AND provider = 'google_oauth_tokens'
  `).run(Number(organizationId))
}

export async function listGscSites(context, organizationId) {
  const oauth2Client = getAuthedGoogleOAuthClient(context, organizationId)
  const webmasters = google.webmasters({ version: 'v3', auth: oauth2Client })
  const response = await webmasters.sites.list()
  return (response.data.siteEntry || []).map((site) => ({
    siteUrl: site.siteUrl,
    permissionLevel: site.permissionLevel,
  }))
}

export async function listGa4Properties(context, organizationId) {
  const oauth2Client = getAuthedGoogleOAuthClient(context, organizationId)
  const analyticsAdmin = google.analyticsadmin({ version: 'v1beta', auth: oauth2Client })
  const response = await analyticsAdmin.accountSummaries.list({ pageSize: 200 })
  return (response.data.accountSummaries || []).flatMap((account) => {
    const accountDisplayName = account.displayName || account.name || 'Account'
    return (account.propertySummaries || []).map((property) => ({
      name: property.property,
      displayName: property.displayName,
      propertyId: String(property.property || '').replace(/^properties\//, ''),
      accountDisplayName,
    }))
  })
}

export async function listAdsCustomers(context, organizationId, options = {}) {
  const oauth2Client = getAuthedGoogleOAuthClient(context, organizationId)
  const accessToken = await oauth2Client.getAccessToken()
  const token = accessToken?.token || accessToken
  if (!token) throw new Error('Unable to obtain a Google Ads access token.')

  const developerTokenCredential = options.workspace
    ? resolveWorkspaceCredential(context, options.workspace, 'google_ads_developer_token', 'Saved Google Ads developer token could not be decrypted. Re-save it in the organization credential vault.', {
      credentialLabel: options.credentialLabel,
    })
    : resolveCredentialSelection(context, {
      organizationId,
      provider: 'google_ads_developer_token',
      selectedLabel: options.credentialLabel || DEFAULT_CREDENTIAL_LABEL,
      invalidMessage: 'Saved Google Ads developer token could not be decrypted. Re-save it in the organization credential vault.',
    })

  if (developerTokenCredential.error) throw new Error(developerTokenCredential.error)
  const developerToken = developerTokenCredential.value
  if (!developerToken) throw new Error('Save a Google Ads developer token in the organization credential vault first.')

  const listResponse = await fetch('https://googleads.googleapis.com/v18/customers:listAccessibleCustomers', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'developer-token': developerToken,
    },
  })

  const listJson = await listResponse.json()
  if (!listResponse.ok) throw new Error(listJson?.error?.message || 'Failed to list accessible Google Ads customers.')

  const items = []
  for (const resourceName of listJson.resourceNames || []) {
    const customerId = String(resourceName || '').replace('customers/', '').replace(/-/g, '')
    if (!customerId) continue

    const detailResponse = await fetch(`https://googleads.googleapis.com/v18/customers/${customerId}/googleAds:searchStream`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'developer-token': developerToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: 'SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone FROM customer LIMIT 1',
      }),
    })

    const detailJson = detailResponse.ok ? await detailResponse.json() : []
    const customer = Array.isArray(detailJson) ? detailJson[0]?.results?.[0]?.customer : null
    items.push({
      customerId,
      displayName: customer?.descriptiveName || `Customer ${customerId}`,
      currencyCode: customer?.currencyCode || '',
      timeZone: customer?.timeZone || '',
    })
  }

  return items
}

async function fetchLighthousePsi(targetUrl, apiKey = '', strategy = 'mobile') {
  const requestUrl = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed')
  requestUrl.searchParams.set('url', targetUrl)
  requestUrl.searchParams.set('strategy', strategy)
  requestUrl.searchParams.append('category', 'performance')
  requestUrl.searchParams.append('category', 'seo')
  requestUrl.searchParams.append('category', 'accessibility')
  requestUrl.searchParams.append('category', 'best-practices')
  if (apiKey) requestUrl.searchParams.set('key', apiKey)

  const response = await fetchWithTimeout(requestUrl, {}, AUDIT_PAGESPEED_TIMEOUT_MS)
  if (!response.ok) throw new Error(`PageSpeed Insights ${strategy} request failed (${response.status}).`)
  const json = await response.json()
  return normalizeLighthousePsiResult(json, { strategy, targetUrl })
}
export async function runWorkspaceAudit(context, workspace, options = {}) {
  const configuredDomain = getWorkspaceSetting(context.db, workspace.id, 'rank_domain')
  const storedEntryUrl = getWorkspaceSetting(context.db, workspace.id, 'audit_entry_url')
  const rawTargetUrl = String(options.entryUrl || storedEntryUrl || '').trim() || (configuredDomain ? `https://${configuredDomain}` : '')
  if (!rawTargetUrl) throw new Error('Set a workspace rank domain or audit entry URL before running the site audit.')

  const targetUrl = normalizeCrawlUrl(rawTargetUrl)
  const baseUrl = new URL(targetUrl)
  const maxPages = clamp(Number(options.maxPages || getWorkspaceSetting(context.db, workspace.id, 'audit_max_pages', '25') || 25), 5, 50)
  const queue = [targetUrl]
  const seen = new Set()
  const enqueued = new Set([targetUrl])
  const issues = []
  const titleMap = new Map()
  const descriptionMap = new Map()
  const crawlStartedAt = Date.now()
  let pagesCrawled = 0
  let errorPages = 0
  let timedOutPages = 0

  await seedQueueFromSitemaps(baseUrl, queue, enqueued, seen, maxPages)

  while (queue.length && pagesCrawled < maxPages) {
    const url = queue.shift()
    if (!url || seen.has(url)) continue
    seen.add(url)

    let response
    try {
      response = await fetchWithTimeout(url, {
        redirect: 'follow',
        headers: {
          'user-agent': AUDIT_USER_AGENT,
          accept: 'text/html,application/xhtml+xml',
        },
      }, AUDIT_REQUEST_TIMEOUT_MS)
    } catch (error) {
      errorPages += 1
      if (isTimeoutError(error)) {
        timedOutPages += 1
        issues.push({ severity: 'high', code: 'crawl_timeout', url, message: `Timed out while fetching ${url}` })
      } else {
        issues.push({ severity: 'high', code: 'crawl_error', url, message: `Failed to fetch ${url}` })
      }
      continue
    }

    if (!response.ok) {
      errorPages += 1
      issues.push({ severity: 'high', code: 'http_error', url, message: `${url} returned ${response.status}` })
      continue
    }

    const contentType = String(response.headers.get('content-type') || '')
    if (!contentType.includes('text/html')) {
      issues.push({ severity: 'low', code: 'non_html_page', url, message: `Skipped non-HTML response (${contentType || 'unknown content type'}).` })
      continue
    }

    const html = await response.text()
    pagesCrawled += 1

    const title = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim() || ''
    if (!title || title.length < 10) issues.push({ severity: 'medium', code: 'title_missing_or_short', url, message: 'Title tag missing or too short.' })
    if (title) {
      const key = title.toLowerCase()
      const pages = titleMap.get(key) || []
      pages.push(url)
      titleMap.set(key, pages)
    }

    const description = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1]?.trim() || ''
    if (!description || description.length < 50) issues.push({ severity: 'medium', code: 'description_missing_or_short', url, message: 'Meta description missing or too short.' })
    if (description) {
      const key = description.toLowerCase()
      const pages = descriptionMap.get(key) || []
      pages.push(url)
      descriptionMap.set(key, pages)
    }

    const canonical = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1]?.trim() || ''
    if (!canonical) issues.push({ severity: 'low', code: 'canonical_missing', url, message: 'Canonical tag missing.' })

    const headings = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)]
    if (!headings.length) issues.push({ severity: 'medium', code: 'missing_h1', url, message: 'Page is missing an H1.' })
    if (headings.length > 1) issues.push({ severity: 'low', code: 'multiple_h1', url, message: 'Page has multiple H1 elements.' })

    const links = [...html.matchAll(/href=["']([^"'#]+)["']/gi)]
      .map((match) => match[1])
      .map((href) => normalizeDiscoveredUrl(href, url, baseUrl))
      .filter(Boolean)

    for (const link of links) {
      if (seen.has(link) || enqueued.has(link)) continue
      if (enqueued.size >= maxPages * AUDIT_MAX_QUEUE_MULTIPLIER) continue
      enqueued.add(link)
      queue.push(link)
    }
  }

  for (const urls of titleMap.values()) {
    if (urls.length > 1) {
      for (const url of urls) issues.push({ severity: 'low', code: 'duplicate_title', url, message: `Duplicate title detected across ${urls.length} pages.` })
    }
  }

  for (const urls of descriptionMap.values()) {
    if (urls.length > 1) {
      for (const url of urls) issues.push({ severity: 'low', code: 'duplicate_description', url, message: `Duplicate meta description detected across ${urls.length} pages.` })
    }
  }

  const pageSpeedCredential = resolveWorkspaceCredential(context, workspace, 'google_pagespeed_api', 'Saved PageSpeed Insights API key could not be decrypted. Re-save it in the organization credential vault.')
  const pageSpeedKey = pageSpeedCredential.value || ''
  const pageSpeed = { mobile: null, desktop: null, error: '' }
  if (pageSpeedKey) {
    const [mobileResult, desktopResult] = await Promise.allSettled([
      fetchLighthousePsi(targetUrl, pageSpeedKey, 'mobile'),
      fetchLighthousePsi(targetUrl, pageSpeedKey, 'desktop'),
    ])

    const failures = []

    if (mobileResult.status === 'fulfilled') {
      pageSpeed.mobile = mobileResult.value
    } else {
      failures.push(`mobile: ${mobileResult.reason?.message || 'Request failed.'}`)
    }

    if (desktopResult.status === 'fulfilled') {
      pageSpeed.desktop = desktopResult.value
    } else {
      failures.push(`desktop: ${desktopResult.reason?.message || 'Request failed.'}`)
    }

    if (failures.length) {
      pageSpeed.error = failures.join(' | ')
    }
  } else if (pageSpeedCredential.error) {
    pageSpeed.error = pageSpeedCredential.error
  } else {
    pageSpeed.error = 'PageSpeed Insights API key not configured.'
  }

  if (pageSpeed.error) {
    issues.push({
      severity: 'medium',
      code: 'pagespeed_unavailable',
      url: targetUrl,
      message: `PageSpeed metrics unavailable: ${pageSpeed.error}`,
    })
  }

  if (pagesCrawled < Math.min(maxPages, AUDIT_MIN_USEFUL_PAGES)) {
    issues.push({
      severity: 'medium',
      code: 'limited_crawl_coverage',
      url: targetUrl,
      message: `Only ${pagesCrawled} page(s) were crawled. This audit may be incomplete.`,
    })
  }

  if (pagesCrawled <= 1 && enqueued.size <= 1) {
    issues.push({
      severity: 'medium',
      code: 'internal_links_not_discovered',
      url: targetUrl,
      message: 'No additional internal URLs were discovered from the entry page or sitemap.',
    })
  }

  const duplicateTitles = [...titleMap.values()].filter((urls) => urls.length > 1).length
  const duplicateDescriptions = [...descriptionMap.values()].filter((urls) => urls.length > 1).length
  const severityWeight = { high: 8, medium: 4, low: 1 }
  const penalty = issues.reduce((sum, issue) => sum + (severityWeight[issue.severity] || 1), 0) + (errorPages * 5) + (timedOutPages * 3)
  const healthScore = clamp(100 - penalty, 5, 100)
  const details = {
    pageSpeed,
    pagesCrawled,
    pagesQueued: enqueued.size,
    errorPages,
    timedOutPages,
    duplicateTitles,
    duplicateDescriptions,
    durationMs: Date.now() - crawlStartedAt,
    issueCounts: buildIssueCounts(issues),
  }

  const payload = JSON.stringify({ issues, details })
  const result = context.db.prepare(`
    INSERT INTO site_audit_runs (workspace_id, audited_url, health_score, issues_json)
    VALUES (?, ?, ?, ?)
  `).run(Number(workspace.id), targetUrl, healthScore, payload)

  return {
    id: Number(result.lastInsertRowid),
    auditedUrl: targetUrl,
    healthScore,
    issues,
    details,
    createdAt: new Date().toISOString(),
  }
}

export async function runWorkspaceSync(context, workspace, sourceOrOptions = 'all') {
  const options = normalizeSyncOptions(sourceOrOptions)
  const normalizedSource = validateSyncSource(options.source)
  const result = {}
  const attempted = []

  if (normalizedSource === 'all' || normalizedSource === 'gsc') {
    attempted.push('gsc')
    result.gsc = await runGscSync(context, workspace)
  }
  if (normalizedSource === 'all' || normalizedSource === 'ga4') {
    attempted.push('ga4')
    result.ga4 = await runGa4Sync(context, workspace)
  }
  if (normalizedSource === 'all' || normalizedSource === 'ads') {
    attempted.push('ads')
    result.ads = await runGoogleAdsSync(context, workspace)
  }
  if (normalizedSource === 'all' || normalizedSource === 'rank') {
    attempted.push('rank')
    result.rank = await runRankSync(context, workspace, options)
  }

  const executed = Object.values(result).filter((item) => !item?.skipped).length
  if (!executed && attempted.length) {
    throw new Error(Object.values(result).find((item) => item?.reason)?.reason || 'No configured sources are ready for sync.')
  }

  return result
}

function normalizeSyncOptions(sourceOrOptions) {
  if (typeof sourceOrOptions === 'string') {
    return { source: sourceOrOptions, profileId: null, scheduled: false }
  }

  return {
    source: sourceOrOptions?.source || 'all',
    profileId: sourceOrOptions?.profileId == null || sourceOrOptions?.profileId === '' ? null : Number(sourceOrOptions.profileId),
    scheduled: Boolean(sourceOrOptions?.scheduled),
  }
}

async function runGscSync(context, workspace) {
  const siteUrl = getWorkspaceSetting(context.db, workspace.id, 'gsc_site_url')
  if (!siteUrl) return { skipped: true, reason: 'No GSC property selected for this workspace.' }

  const oauth2Client = getAuthedGoogleOAuthClient(context, workspace.organizationId)
  const webmasters = google.webmasters({ version: 'v3', auth: oauth2Client })
  const endDate = new Date()
  const startDate = new Date(endDate)
  startDate.setDate(endDate.getDate() - 29)
  const fmt = (value) => value.toISOString().slice(0, 10)

  const response = await webmasters.searchanalytics.query({
    siteUrl,
    requestBody: {
      startDate: fmt(startDate),
      endDate: fmt(endDate),
      dimensions: ['date'],
      rowLimit: 250,
    },
  })

  const upsert = context.db.prepare(`
    INSERT INTO workspace_gsc_daily (workspace_id, site_url, date, clicks, impressions, ctr, position)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, site_url, date) DO UPDATE SET
      clicks = excluded.clicks,
      impressions = excluded.impressions,
      ctr = excluded.ctr,
      position = excluded.position,
      created_at = datetime('now')
  `)

  const rows = response.data.rows || []
  const tx = context.db.transaction((entries) => {
    for (const row of entries) {
      const date = row.keys?.[0]
      if (!date) continue
      upsert.run(workspace.id, siteUrl, date, row.clicks || 0, row.impressions || 0, row.ctr || 0, row.position || 0)
    }
  })
  tx(rows)
  return { rowsImported: rows.length, siteUrl }
}

async function runGa4Sync(context, workspace) {
  const propertyId = getWorkspaceSetting(context.db, workspace.id, 'ga4_property_id')
  if (!propertyId) return { skipped: true, reason: 'No GA4 property selected for this workspace.' }

  const oauth2Client = getAuthedGoogleOAuthClient(context, workspace.organizationId)
  const analyticsDataClient = new BetaAnalyticsDataClient({ authClient: oauth2Client })
  const [response] = await analyticsDataClient.runReport({
    property: `properties/${propertyId}`,
    dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
    dimensions: [{ name: 'date' }],
    metrics: [
      { name: 'sessions' },
      { name: 'totalUsers' },
      { name: 'newUsers' },
      { name: 'conversions' },
      { name: 'engagementRate' },
    ],
    limit: 100,
  })

  const upsert = context.db.prepare(`
    INSERT INTO workspace_ga4_daily (workspace_id, property_id, date, sessions, users, new_users, conversions, engagement_rate)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, property_id, date) DO UPDATE SET
      sessions = excluded.sessions,
      users = excluded.users,
      new_users = excluded.new_users,
      conversions = excluded.conversions,
      engagement_rate = excluded.engagement_rate,
      created_at = datetime('now')
  `)

  const normalizeDate = (yyyymmdd) => `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`
  const metric = (values, index) => Number(values?.[index]?.value || 0)
  const rows = response.rows || []
  const tx = context.db.transaction((entries) => {
    for (const row of entries) {
      const dateRaw = row.dimensionValues?.[0]?.value
      if (!dateRaw) continue
      upsert.run(
        workspace.id,
        propertyId,
        normalizeDate(dateRaw),
        metric(row.metricValues, 0),
        metric(row.metricValues, 1),
        metric(row.metricValues, 2),
        metric(row.metricValues, 3),
        metric(row.metricValues, 4),
      )
    }
  })
  tx(rows)
  return { rowsImported: rows.length, propertyId }
}

async function runRankSync(context, workspace, options = {}) {
  const rankApiCredential = resolveWorkspaceCredential(context, workspace, 'dataforseo_or_serpapi', 'Saved rank API key could not be decrypted. Re-save it in the organization credential vault.')
  const apiKey = rankApiCredential.value
  if (rankApiCredential.error) return { skipped: true, reason: rankApiCredential.error }
  if (!apiKey) return { skipped: true, reason: 'No rank API key saved in the organization credential vault.' }

  const domain = normalizeDomain(getWorkspaceSetting(context.db, workspace.id, 'rank_domain'))
  if (!domain) return { skipped: true, reason: 'Set a rank domain for this workspace first.' }

  const allProfiles = listRankProfiles(context.db, workspace.id).filter((profile) => profile.active)
  const selectedProfiles = options.profileId == null
    ? allProfiles
    : allProfiles.filter((profile) => Number(profile.id) === Number(options.profileId))

  if (!selectedProfiles.length) {
    return { skipped: true, reason: options.profileId ? 'Selected rank profile is not available.' : 'Create an active rank profile before running rank sync.' }
  }

  const allKeywords = listRankKeywords(context.db, workspace.id)
  const activeKeywords = allKeywords.filter((keyword) => keyword.active)
  const scopedKeywords = activeKeywords.filter((keyword) => selectedProfiles.some((profile) => Number(profile.id) === Number(keyword.profileId)))
  if (!scopedKeywords.length) {
    return { skipped: true, reason: 'Add tracked keywords before running rank sync.' }
  }

  const competitors = context.db.prepare('SELECT domain FROM workspace_competitors WHERE workspace_id = ? ORDER BY domain').all(workspace.id)
    .map((row) => normalizeDomain(row.domain))
    .filter(Boolean)

  const today = new Date().toISOString().slice(0, 10)
  const attemptedAt = nowIso()
  setWorkspaceSettings(context.db, workspace.id, {
    rank_sync_last_attempted_at: attemptedAt,
    rank_sync_last_status: 'running',
    rank_sync_last_error: '',
  })

  const upsert = context.db.prepare(`
    INSERT INTO rank_daily (workspace_id, profile_id, keyword, date, position, found_url, map_pack_position, map_pack_found_url, map_pack_found_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(profile_id, keyword, date) DO UPDATE SET
      position = excluded.position,
      found_url = excluded.found_url,
      map_pack_position = excluded.map_pack_position,
      map_pack_found_url = excluded.map_pack_found_url,
      map_pack_found_name = excluded.map_pack_found_name,
      created_at = datetime('now')
  `)

  const upsertCompetitor = context.db.prepare(`
    INSERT INTO competitor_rank_daily (workspace_id, profile_id, competitor_domain, keyword, date, position, found_url)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(profile_id, competitor_domain, keyword, date) DO UPDATE SET
      position = excluded.position,
      found_url = excluded.found_url,
      created_at = datetime('now')
  `)

  const profileResults = []
  let keywordsChecked = 0
  let keywordsFailed = 0
  let keywordsSkipped = 0
  let retriesUsed = 0
  let skippedProfiles = 0
  const errors = []

  try {
    for (const profile of selectedProfiles) {
      const profileKeywords = scopedKeywords.filter((item) => Number(item.profileId) === Number(profile.id))
      if (!profileKeywords.length) continue

      if (!hasProfileSearchLocation(profile)) {
        const skippedReason = `Set a search location for ${profile.name} before running rank sync.`
        createSyncFailureAlert(context, workspace, profile, skippedReason, {
          keywordsSkipped: profileKeywords.length,
          keywordsTotal: profileKeywords.length,
          reason: 'missing_search_location',
        })
        skippedProfiles += 1
        keywordsSkipped += profileKeywords.length
        profileResults.push({
          profile,
          keywordsTotal: profileKeywords.length,
          keywordsChecked: 0,
          keywordsFailed: 0,
          keywordsSkipped: profileKeywords.length,
          retriesUsed: 0,
          errors: [],
          skippedReason,
        })
        continue
      }

      const profileResult = await runRankProfileSync(context, {
        apiKey,
        competitors,
        domain,
        profile,
        keywords: profileKeywords,
        today,
        upsert,
        upsertCompetitor,
        workspace,
      })

      profileResults.push(profileResult)
      keywordsChecked += profileResult.keywordsChecked
      keywordsFailed += profileResult.keywordsFailed
      keywordsSkipped += profileResult.keywordsSkipped || 0
      retriesUsed += profileResult.retriesUsed
      if (profileResult.keywordsChecked > 0) {
        resolveOpenSyncFailureAlerts(context, workspace.id, profile.id)
      }
      for (const entry of profileResult.errors || []) {
        if (errors.length < 20) errors.push(entry)
      }
    }
  } catch (error) {
    setWorkspaceSettings(context.db, workspace.id, {
      rank_sync_last_status: 'failed',
      rank_sync_last_error: error.message,
    })
    throw error
  }

  if (!profileResults.length) {
    setWorkspaceSettings(context.db, workspace.id, {
      rank_sync_last_status: 'failed',
      rank_sync_last_error: 'No active keywords were available for the selected profiles.',
    })
    return { skipped: true, reason: 'No active keywords were available for the selected profiles.' }
  }

  if (!keywordsChecked && keywordsFailed) {
    const message = `Rank sync failed for all keywords (${keywordsFailed}/${scopedKeywords.length}). ${errors[0]?.error || 'Unknown error.'}`
    for (const profileResult of profileResults) {
      if (!profileResult.keywordsChecked && profileResult.keywordsFailed) {
        createSyncFailureAlert(context, workspace, profileResult.profile, message, {
          keywordsFailed: profileResult.keywordsFailed,
          keywordsTotal: profileResult.keywordsTotal,
        })
      }
    }
    setWorkspaceSettings(context.db, workspace.id, {
      rank_sync_last_status: 'failed',
      rank_sync_last_error: message,
    })
    throw new Error(message)
  }

  const completedAt = nowIso()
  const partial = keywordsFailed > 0 || keywordsSkipped > 0 || skippedProfiles > 0
  const status = partial ? 'partial' : 'completed'
  const summaryParts = []
  if (keywordsChecked > 0) summaryParts.push(`${keywordsChecked} checked`)
  if (keywordsFailed > 0) summaryParts.push(`${keywordsFailed} failed`)
  if (keywordsSkipped > 0) summaryParts.push(`${keywordsSkipped} skipped`)
  const summaryMessage = partial
    ? `Rank sync completed with partial coverage (${summaryParts.join(', ') || 'no keywords processed'}).`
    : ''
  setWorkspaceSettings(context.db, workspace.id, {
    rank_sync_last_completed_at: completedAt,
    rank_sync_last_status: status,
    rank_sync_last_error: summaryMessage,
  })

  return {
    date: today,
    keywordsTotal: scopedKeywords.length,
    keywordsChecked,
    keywordsFailed,
    keywordsSkipped,
    retriesUsed,
    partial,
    skippedProfiles,
    competitorsTracked: competitors.length,
    profiles: profileResults.map((item) => ({
      profileId: item.profile.id,
      profileName: item.profile.name,
      keywordsTotal: item.keywordsTotal,
      keywordsChecked: item.keywordsChecked,
      keywordsFailed: item.keywordsFailed,
      keywordsSkipped: item.keywordsSkipped || 0,
      skippedReason: item.skippedReason || '',
      latestDate: today,
    })),
    errors,
  }
}


async function runRankProfileSync(context, params) {
  const {
    apiKey,
    competitors,
    domain,
    keywords,
    profile,
    today,
    upsert,
    upsertCompetitor,
    workspace,
  } = params

  const baseline = loadPreviousProfilePositions(context, workspace.id, profile.id, today)
  const previousPositions = baseline.positions
  let keywordsChecked = 0
  let keywordsFailed = 0
  let keywordsSkipped = 0
  let retriesUsed = 0
  const errors = []

  for (const keywordRow of keywords) {
    const result = await fetchSerpGoogleResults(keywordRow.keyword, {
      apiKey,
      gl: profile.gl,
      hl: profile.hl,
      searchLocationId: profile.searchLocationId,
      searchLocationName: profile.searchLocationName,
    })

    retriesUsed += result.retriesUsed

    if (!result.ok) {
      keywordsFailed += 1
      if (errors.length < 20) {
        errors.push({ keyword: keywordRow.keyword, error: result.error })
      }
      continue
    }

    const organic = result.organic
    const localPlaces = result.localPlaces
    const ownedHit = findOwnedOrganicHit(organic, domain)
    const mapPackHit = findOwnedLocalPackHit(
      localPlaces,
      domain,
      profile.businessName,
      profile.searchLocationName || profile.locationLabel || '',
    )
    upsert.run(
      workspace.id,
      profile.id,
      keywordRow.keyword,
      today,
      ownedHit?.position ?? null,
      ownedHit?.link ?? null,
      mapPackHit?.position ?? null,
      mapPackHit?.link ?? null,
      mapPackHit?.name ?? null,
    )

    if (competitors.length) {
      const bestByCompetitor = new Map()
      for (const item of organic) {
        const link = String(item.link || '')
        const competitorDomain = extractDomainFromUrl(link)
        const itemPosition = normalizeResultPosition(item)
        if (!competitorDomain || !itemPosition || !competitors.includes(competitorDomain)) continue
        const existing = bestByCompetitor.get(competitorDomain)
        if (!existing || itemPosition < existing.position) {
          bestByCompetitor.set(competitorDomain, { position: itemPosition, foundUrl: link })
        }
      }

      for (const competitorDomain of competitors) {
        const hit = bestByCompetitor.get(competitorDomain)
        upsertCompetitor.run(workspace.id, profile.id, competitorDomain, keywordRow.keyword, today, hit?.position ?? null, hit?.foundUrl ?? null)
      }
    }

    createMovementAlerts(context, {
      currentPosition: ownedHit?.position ?? null,
      foundUrl: ownedHit?.link ?? null,
      keyword: keywordRow.keyword,
      landingPage: keywordRow.landingPage,
      previousPosition: previousPositions.get(keywordRow.keyword) ?? null,
      hasHistoricalBaseline: baseline.hasBaseline,
      profile,
      workspace,
    })

    keywordsChecked += 1
  }

  if (!keywordsChecked && keywordsFailed) {
    createSyncFailureAlert(context, workspace, profile, `Rank sync failed for ${profile.name}.`, {
      keywordsFailed,
      keywordsTotal: keywords.length,
      errors,
    })
  }

  if (keywordsChecked && keywordsFailed) {
    createSyncFailureAlert(context, workspace, profile, `Rank sync partially failed for ${profile.name}.`, {
      keywordsChecked,
      keywordsFailed,
      keywordsTotal: keywords.length,
      errors,
    })
  }

  return {
    profile,
    keywordsTotal: keywords.length,
    keywordsChecked,
    keywordsFailed,
    keywordsSkipped,
    retriesUsed,
    errors,
  }
}

function loadPreviousProfilePositions(context, workspaceId, profileId, today) {
  const previousDate = context.db.prepare(`
    SELECT MAX(date) AS d
    FROM rank_daily
    WHERE workspace_id = ? AND profile_id = ? AND date < ?
  `).get(Number(workspaceId), Number(profileId), today)?.d

  if (!previousDate) return { hasBaseline: false, positions: new Map() }

  const rows = context.db.prepare(`
    SELECT keyword, position
    FROM rank_daily
    WHERE workspace_id = ? AND profile_id = ? AND date = ?
  `).all(Number(workspaceId), Number(profileId), previousDate)

  return {
    hasBaseline: true,
    positions: new Map(rows.map((row) => [row.keyword, row.position == null ? null : Number(row.position)])),
  }
}

async function fetchSerpGoogleResults(keyword, options) {
  let attempt = 0
  let retriesUsed = 0

  while (attempt < RANK_SYNC_RETRY_LIMIT) {
    attempt += 1
    try {
      const url = new URL('https://serpapi.com/search.json')
      url.searchParams.set('engine', 'google')
      url.searchParams.set('q', keyword)
      url.searchParams.set('num', '100')
      url.searchParams.set('gl', options.gl || 'us')
      url.searchParams.set('hl', options.hl || 'en')
      if (options.searchLocationId || options.searchLocationName) {
        url.searchParams.set('location', options.searchLocationId || options.searchLocationName)
      }
      url.searchParams.set('api_key', options.apiKey)
      const response = await fetch(url)
      if (!response.ok) {
        let payload = null
        try {
          payload = await response.json()
        } catch {
          payload = null
        }

        const message = payload?.error || `SERP API failed (${response.status}) for ${keyword}`
        if (response.status === 429 || response.status >= 500) {
          throw new Error(message)
        }
        return { ok: false, organic: [], localPlaces: [], error: message, retriesUsed }
      }

      const payload = await response.json()
      return {
        ok: true,
        organic: Array.isArray(payload?.organic_results) ? payload.organic_results : [],
        localPlaces: extractSerpLocalPlaces(payload),
        retriesUsed,
      }
    } catch (error) {
      if (attempt >= RANK_SYNC_RETRY_LIMIT) {
        return { ok: false, organic: [], localPlaces: [], error: error.message, retriesUsed }
      }
      retriesUsed += 1
      await delay(RANK_SYNC_RETRY_DELAY_MS * attempt)
    }
  }

  return { ok: false, organic: [], localPlaces: [], error: `SERP API failed for ${keyword}`, retriesUsed }
}

function findOwnedOrganicHit(organic = [], domain = '') {
  for (const item of organic || []) {
    const link = String(item?.link || '')
    const candidateDomain = extractDomainFromUrl(link)
    if (!candidateDomain) continue
    if (candidateDomain === domain || candidateDomain.endsWith(`.${domain}`)) {
      return {
        position: normalizeResultPosition(item),
        link,
      }
    }
  }
  return null
}

function findOwnedLocalPackHit(places = [], domain = '', businessName = '', locationName = '') {
  const normalizedBusinessName = normalizeText(businessName)
  const canonicalBusinessName = canonicalizeBusinessName(businessName)
  const locationTokens = new Set(tokenizeName(locationName))
  let best = null

  for (const item of places || []) {
    const position = normalizeResultPosition(item)
    if (!position) continue

    const title = String(item?.title || item?.name || '').trim()
    const normalizedTitle = normalizeText(title)
    const website = extractLocalPackWebsite(item)
    const candidateDomain = website ? extractDomainFromUrl(website) : ''
    const domainScore = domainsMatch(candidateDomain, domain) ? 4 : 0

    const nameScore = scoreLocalPackBusinessNameMatch({
      canonicalBusinessName,
      locationTokens,
      normalizedBusinessName,
      normalizedTitle,
      title,
    })

    const score = domainScore + nameScore
    if (!score) continue

    const candidate = {
      position,
      link: website || null,
      name: title || '',
      score,
      domainScore,
      nameScore,
    }

    if (!best
      || candidate.score > best.score
      || (candidate.score === best.score && candidate.domainScore > best.domainScore)
      || (candidate.score === best.score && candidate.domainScore === best.domainScore && candidate.nameScore > best.nameScore)
      || (candidate.score === best.score && candidate.domainScore === best.domainScore && candidate.nameScore === best.nameScore && candidate.position < best.position)) {
      best = candidate
    }
  }

  return best
}

function scoreLocalPackBusinessNameMatch({
  canonicalBusinessName,
  locationTokens,
  normalizedBusinessName,
  normalizedTitle,
  title,
}) {
  if (!normalizedBusinessName || !normalizedTitle) return 0
  if (normalizedTitle === normalizedBusinessName) return 3

  const canonicalTitle = canonicalizeBusinessName(title)
  if (canonicalTitle && canonicalBusinessName && canonicalTitle === canonicalBusinessName) return 3

  if (canonicalTitle && canonicalBusinessName && canonicalBusinessName.length < canonicalTitle.length) {
    const businessTokens = canonicalBusinessName.split(' ').filter(Boolean)
    const titleTokens = canonicalTitle.split(' ').filter(Boolean)
    if (
      businessTokens.length
      && titleTokens.length > businessTokens.length
      && businessTokens.every((token, index) => token === titleTokens[index])
    ) {
      const extraTokens = titleTokens.slice(businessTokens.length)
      if (extraTokens.length && extraTokens.every((token) => locationTokens.has(token))) {
        return 2
      }
    }
  }

  return 0
}

function extractSerpLocalPlaces(payload) {
  if (Array.isArray(payload?.local_results?.places)) return payload.local_results.places
  if (Array.isArray(payload?.local_results)) return payload.local_results
  return []
}

function extractLocalPackWebsite(item) {
  const candidates = [
    item?.links?.website,
    item?.website,
    item?.link,
    item?.url,
  ]

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate
  }

  return ''
}

function domainsMatch(candidateDomain = '', expectedDomain = '') {
  const candidate = normalizeDomain(candidateDomain)
  const expected = normalizeDomain(expectedDomain)
  if (!candidate || !expected) return false
  return candidate === expected || candidate.endsWith(`.${expected}`) || expected.endsWith(`.${candidate}`)
}

function canonicalizeBusinessName(value = '') {
  return tokenizeName(value)
    .filter((token) => !IGNORED_BUSINESS_NAME_TOKENS.has(token))
    .join(' ')
}

function tokenizeName(value = '') {
  return normalizeText(value)
    .split(' ')
    .filter(Boolean)
}

const IGNORED_BUSINESS_NAME_TOKENS = new Set([
  'and',
  'co',
  'company',
  'corp',
  'corporation',
  'group',
  'inc',
  'incorporated',
  'llc',
  'ltd',
  'of',
  'service',
  'services',
  'the',
])

function hasProfileSearchLocation(profile) {
  return Boolean(String(profile?.searchLocationId || '').trim() || String(profile?.searchLocationName || '').trim())
}

function normalizeResultPosition(item) {
  const position = Number(item?.position)
  if (Number.isInteger(position) && position > 0) return position
  return null
}

function createMovementAlerts(context, payload) {
  const {
    currentPosition,
    foundUrl,
    keyword,
    landingPage,
    previousPosition,
    hasHistoricalBaseline,
    profile,
    workspace,
  } = payload

  const sharedPayload = {
    currentPosition,
    foundUrl,
    landingPage,
    previousPosition,
    profileId: profile.id,
    profileName: profile.name,
    workspaceId: workspace.id,
  }

  if (currentPosition == null && previousPosition != null) {
    createWorkspaceAlert(context.db, {
      workspaceId: workspace.id,
      profileId: profile.id,
      keyword,
      source: 'rank',
      alertType: 'unranked',
      severity: 'high',
      title: `${keyword} is now unranked`,
      message: `${keyword} no longer ranks in the tracked top 100 for ${profile.name}.`,
      payload: sharedPayload,
    })
    return
  }

  if (currentPosition != null && previousPosition == null) {
    if (!hasHistoricalBaseline) return
    if (currentPosition <= 3) {
      createWorkspaceAlert(context.db, {
        workspaceId: workspace.id,
        profileId: profile.id,
        keyword,
        source: 'rank',
        alertType: 'new_top_3',
        severity: 'low',
        title: `${keyword} entered the top 3`,
        message: `${keyword} is now ranking #${currentPosition} for ${profile.name}.`,
        payload: sharedPayload,
      })
    } else if (currentPosition <= 10) {
      createWorkspaceAlert(context.db, {
        workspaceId: workspace.id,
        profileId: profile.id,
        keyword,
        source: 'rank',
        alertType: 'entered_top_10',
        severity: 'low',
        title: `${keyword} entered the top 10`,
        message: `${keyword} is now ranking #${currentPosition} for ${profile.name}.`,
        payload: sharedPayload,
      })
    }
    return
  }

  if (currentPosition == null || previousPosition == null) {
    return
  }

  if (previousPosition > 3 && currentPosition <= 3) {
    createWorkspaceAlert(context.db, {
      workspaceId: workspace.id,
      profileId: profile.id,
      keyword,
      source: 'rank',
      alertType: 'new_top_3',
      severity: 'low',
      title: `${keyword} entered the top 3`,
      message: `${keyword} improved from #${previousPosition} to #${currentPosition} for ${profile.name}.`,
      payload: sharedPayload,
    })
  } else if (previousPosition > 10 && currentPosition <= 10) {
    createWorkspaceAlert(context.db, {
      workspaceId: workspace.id,
      profileId: profile.id,
      keyword,
      source: 'rank',
      alertType: 'entered_top_10',
      severity: 'low',
      title: `${keyword} entered the top 10`,
      message: `${keyword} improved from #${previousPosition} to #${currentPosition} for ${profile.name}.`,
      payload: sharedPayload,
    })
  }

  if (previousPosition <= 10 && currentPosition > 10) {
    createWorkspaceAlert(context.db, {
      workspaceId: workspace.id,
      profileId: profile.id,
      keyword,
      source: 'rank',
      alertType: 'left_top_10',
      severity: 'medium',
      title: `${keyword} left the top 10`,
      message: `${keyword} fell from #${previousPosition} to #${currentPosition} for ${profile.name}.`,
      payload: sharedPayload,
    })
  }

  if ((currentPosition - previousPosition) >= 3) {
    createWorkspaceAlert(context.db, {
      workspaceId: workspace.id,
      profileId: profile.id,
      keyword,
      source: 'rank',
      alertType: 'rank_drop',
      severity: 'medium',
      title: `${keyword} dropped ${currentPosition - previousPosition} positions`,
      message: `${keyword} fell from #${previousPosition} to #${currentPosition} for ${profile.name}.`,
      payload: sharedPayload,
    })
  }
}

function createSyncFailureAlert(context, workspace, profile, message, payload = {}) {
  createWorkspaceAlert(context.db, {
    workspaceId: workspace.id,
    profileId: profile.id,
    keyword: '',
    source: 'rank',
    alertType: 'sync_failed',
    severity: 'high',
    title: `${profile.name} rank sync needs attention`,
    message,
    payload: {
      profileId: profile.id,
      profileName: profile.name,
      ...payload,
    },
  })
}

function resolveOpenSyncFailureAlerts(context, workspaceId, profileId) {
  context.db.prepare(`
    UPDATE workspace_alerts
    SET status = 'resolved', resolved_at = datetime('now')
    WHERE workspace_id = ?
      AND profile_id = ?
      AND source = 'rank'
      AND alert_type = 'sync_failed'
      AND status = 'open'
  `).run(Number(workspaceId), Number(profileId))
}


async function runGoogleAdsSync(context, workspace) {
  const customerId = getWorkspaceSetting(context.db, workspace.id, 'google_ads_customer_id')
  if (!customerId) return { skipped: true, reason: 'No Google Ads customer selected for this workspace.' }

  const developerTokenCredential = resolveWorkspaceCredential(context, workspace, 'google_ads_developer_token', 'Saved Google Ads developer token could not be decrypted. Re-save it in the organization credential vault.')
  const developerToken = developerTokenCredential.value
  if (developerTokenCredential.error) return { skipped: true, reason: developerTokenCredential.error }
  if (!developerToken) return { skipped: true, reason: 'Save a Google Ads developer token in the organization credential vault first.' }

  const oauth2Client = getAuthedGoogleOAuthClient(context, workspace.organizationId)
  const accessToken = await oauth2Client.getAccessToken()
  const token = accessToken?.token || accessToken
  if (!token) throw new Error('Unable to obtain a Google Ads access token.')

  const cleanCustomerId = normalizeCustomerId(customerId)
  const response = await fetch(`https://googleads.googleapis.com/v18/customers/${cleanCustomerId}/googleAds:searchStream`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'developer-token': developerToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: `
        SELECT segments.date, metrics.impressions, metrics.clicks, metrics.ctr, metrics.conversions, metrics.cost_micros
        FROM customer
        WHERE segments.date DURING LAST_30_DAYS
        ORDER BY segments.date
      `,
    }),
  })

  const json = await response.json()
  if (!response.ok) throw new Error(json?.error?.message || 'Google Ads API request failed.')

  const upsert = context.db.prepare(`
    INSERT INTO workspace_google_ads_daily (workspace_id, customer_id, date, clicks, impressions, ctr, conversions, cost_micros)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, customer_id, date) DO UPDATE SET
      clicks = excluded.clicks,
      impressions = excluded.impressions,
      ctr = excluded.ctr,
      conversions = excluded.conversions,
      cost_micros = excluded.cost_micros,
      created_at = datetime('now')
  `)

  const rows = (Array.isArray(json) ? json : []).flatMap((chunk) => chunk.results || [])
  const tx = context.db.transaction((entries) => {
    for (const row of entries) {
      const metrics = row.metrics || {}
      const date = row.segments?.date
      if (!date) continue
      upsert.run(
        workspace.id,
        cleanCustomerId,
        date,
        Number(metrics.clicks || 0),
        Number(metrics.impressions || 0),
        Number(metrics.ctr || 0),
        Number(metrics.conversions || 0),
        Number(metrics.costMicros || 0),
      )
    }
  })
  tx(rows)
  return { rowsImported: rows.length, customerId: cleanCustomerId }
}

async function seedQueueFromSitemaps(baseUrl, queue, enqueued, seen, maxPages) {
  const sitemapUrls = await discoverSitemapUrls(baseUrl)
  const maxQueuedUrls = maxPages * AUDIT_MAX_QUEUE_MULTIPLIER

  for (const sitemapUrl of sitemapUrls) {
    if (queue.length >= maxQueuedUrls) break
    if (seen.has(sitemapUrl) || enqueued.has(sitemapUrl)) continue
    enqueued.add(sitemapUrl)
    queue.push(sitemapUrl)
  }
}

async function discoverSitemapUrls(baseUrl) {
  const sitemapCandidates = new Set([new URL('/sitemap.xml', baseUrl).toString()])

  try {
    const robotsUrl = new URL('/robots.txt', baseUrl)
    const response = await fetchWithTimeout(robotsUrl, {
      headers: {
        'user-agent': AUDIT_USER_AGENT,
        accept: 'text/plain',
      },
    }, AUDIT_REQUEST_TIMEOUT_MS)

    if (response.ok) {
      const robotsBody = await response.text()
      for (const line of robotsBody.split(/\r?\n/)) {
        const match = line.match(/^\s*sitemap:\s*(\S+)\s*$/i)
        if (match?.[1]) sitemapCandidates.add(match[1])
      }
    }
  } catch {
    // Ignore robots fetch failures. The audit can proceed from discovered links alone.
  }

  const discoveredUrls = new Set()
  const visitedSitemaps = new Set()

  for (const sitemapUrl of sitemapCandidates) {
    await collectUrlsFromSitemap(sitemapUrl, baseUrl, discoveredUrls, visitedSitemaps, 0)
  }

  return [...discoveredUrls]
}

async function collectUrlsFromSitemap(sitemapUrl, baseUrl, discoveredUrls, visitedSitemaps, depth) {
  if (depth > 2 || visitedSitemaps.has(sitemapUrl)) return
  visitedSitemaps.add(sitemapUrl)

  let response
  try {
    response = await fetchWithTimeout(sitemapUrl, {
      headers: {
        'user-agent': AUDIT_USER_AGENT,
        accept: 'application/xml,text/xml,text/plain',
      },
    }, AUDIT_REQUEST_TIMEOUT_MS)
  } catch {
    return
  }

  if (!response.ok) return
  const body = await response.text()

  for (const match of body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
    const candidate = normalizeDiscoveredUrl(match[1], sitemapUrl, baseUrl)
    if (!candidate) continue

    if (/.xml($|[?#])/i.test(candidate) || /sitemap/i.test(candidate)) {
      await collectUrlsFromSitemap(candidate, baseUrl, discoveredUrls, visitedSitemaps, depth + 1)
      continue
    }

    discoveredUrls.add(candidate)
  }
}

function normalizeCrawlUrl(input) {
  const url = typeof input === 'string' ? new URL(input) : new URL(input.toString())
  url.hash = ''
  if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) {
    url.port = ''
  }
  if (url.pathname !== '/' && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.replace(/\/+$/, '')
  }
  return url.toString()
}

function normalizeDiscoveredUrl(href, currentUrl, baseUrl) {
  try {
    const url = new URL(href, currentUrl)
    if (!isSameAuditSite(url, baseUrl)) return null
    url.protocol = baseUrl.protocol
    url.hostname = baseUrl.hostname
    url.port = baseUrl.port
    return normalizeCrawlUrl(url)
  } catch {
    return null
  }
}

function isSameAuditSite(candidateUrl, baseUrl) {
  return getComparableAuditHost(candidateUrl) === getComparableAuditHost(baseUrl)
}

function getComparableAuditHost(input) {
  const url = input instanceof URL ? input : new URL(input)
  const hostname = url.hostname.toLowerCase().replace(/^www\./, '')
  const port = hasNonDefaultPort(url) ? `:${url.port}` : ''
  return `${hostname}${port}`
}

function hasNonDefaultPort(url) {
  if (!url.port) return false
  return !((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80'))
}

function buildIssueCounts(issues = []) {
  const severity = { high: 0, medium: 0, low: 0 }
  const codeMap = new Map()

  for (const issue of issues) {
    const level = String(issue?.severity || 'low')
    if (!Object.prototype.hasOwnProperty.call(severity, level)) severity[level] = 0
    severity[level] += 1

    const code = String(issue?.code || 'unknown')
    const current = codeMap.get(code) || { code, count: 0, severity: level }
    current.count += 1
    if (severityRank(level) > severityRank(current.severity)) {
      current.severity = level
    }
    codeMap.set(code, current)
  }

  return {
    severity,
    codes: [...codeMap.values()].sort((left, right) => right.count - left.count || left.code.localeCompare(right.code)),
  }
}

function severityRank(level) {
  if (level === 'high') return 3
  if (level === 'medium') return 2
  return 1
}

async function fetchWithTimeout(url, options = {}, timeoutMs = AUDIT_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new Error('Request timed out.')), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

function delay(duration) {
  return new Promise((resolve) => setTimeout(resolve, duration))
}

function isTimeoutError(error) {
  const name = String(error?.name || '')
  const message = String(error?.message || '')
  return name === 'AbortError' || /timed out/i.test(message)
}
