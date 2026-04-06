import { useEffect, useMemo, useState } from 'react'

import { apiRequest, buildApiPath } from './api.js'
import { waitForWorkspaceJob } from './jobs.js'
import { getOnboardingSteps, getReadinessFocus, getReadinessScore } from './workspace.js'
import {
  DEFAULT_CREDENTIAL_LABEL,
  describeWorkspaceCredentialSelection,
  getWorkspaceCredentialLabelFromSettings,
  WORKSPACE_CREDENTIAL_PROVIDER_BY_ID,
} from '../../shared/workspaceCredentialProviders.js'

const EMPTY_ASSET_RESULT = { items: [], availability: { state: 'ready', message: '' } }

const DEFAULT_SETUP_STATE = {
  gscSiteUrl: '',
  ga4PropertyId: '',
  googleAdsCustomerId: '',
  googleAdsDeveloperTokenLabel: DEFAULT_CREDENTIAL_LABEL,
  pageSpeedCredentialLabel: DEFAULT_CREDENTIAL_LABEL,
  rankApiCredentialLabel: DEFAULT_CREDENTIAL_LABEL,
  rankDomain: '',
  rankCountry: 'us',
  rankLanguage: 'en',
  rankFrequency: 'weekly',
  rankWeekday: 1,
  rankHour: 6,
  auditEntryUrl: '',
  auditMaxPages: '25',
}

const DEFAULT_RANK_STATUS = {
  lastStatus: 'idle',
  lastCompletedAt: null,
  lastError: '',
}

export function createWorkspaceSetupState(settingsJson = {}, rankConfigJson = {}) {
  return {
    ...DEFAULT_SETUP_STATE,
    gscSiteUrl: settingsJson.gsc_site_url || '',
    ga4PropertyId: settingsJson.ga4_property_id || '',
    googleAdsCustomerId: settingsJson.google_ads_customer_id || '',
    googleAdsDeveloperTokenLabel: getWorkspaceCredentialLabelFromSettings(settingsJson, 'google_ads_developer_token'),
    pageSpeedCredentialLabel: getWorkspaceCredentialLabelFromSettings(settingsJson, 'google_pagespeed_api'),
    rankApiCredentialLabel: getWorkspaceCredentialLabelFromSettings(settingsJson, 'dataforseo_or_serpapi'),
    rankDomain: rankConfigJson.domain || settingsJson.rank_domain || '',
    rankCountry: rankConfigJson.gl || settingsJson.rank_gl || 'us',
    rankLanguage: rankConfigJson.hl || settingsJson.rank_hl || 'en',
    rankFrequency: rankConfigJson.frequency || settingsJson.rank_sync_frequency || 'weekly',
    rankWeekday: Number(rankConfigJson.weekday || settingsJson.rank_sync_weekday || 1),
    rankHour: Number(rankConfigJson.hour || settingsJson.rank_sync_hour || 6),
    auditEntryUrl: settingsJson.audit_entry_url || '',
    auditMaxPages: settingsJson.audit_max_pages || '25',
  }
}

export function buildWorkspaceSettingsPatch(setup) {
  return {
    gscSiteUrl: setup.gscSiteUrl,
    ga4PropertyId: setup.ga4PropertyId,
    googleAdsCustomerId: setup.googleAdsCustomerId,
    googleAdsDeveloperTokenLabel: setup.googleAdsDeveloperTokenLabel,
    pageSpeedCredentialLabel: setup.pageSpeedCredentialLabel,
    rankApiCredentialLabel: setup.rankApiCredentialLabel,
    auditEntryUrl: setup.auditEntryUrl,
    auditMaxPages: Number(setup.auditMaxPages || 25),
  }
}

export function buildRankConfigPatch(setup) {
  return {
    domain: setup.rankDomain,
    gl: setup.rankCountry,
    hl: setup.rankLanguage,
    frequency: setup.rankFrequency,
    weekday: Number(setup.rankWeekday || 1),
    hour: Number(setup.rankHour || 6),
  }
}

export function summarizeWorkspaceSetup({ googleConnected = false, setup = DEFAULT_SETUP_STATE, workspace }) {
  const steps = getOnboardingSteps({
    googleConnected,
    workspaceSettings: {
      gsc_site_url: setup.gscSiteUrl,
      ga4_property_id: setup.ga4PropertyId,
      google_ads_customer_id: setup.googleAdsCustomerId,
      rank_domain: setup.rankDomain,
    },
    keywordCount: workspace?.keywordCount || 0,
    competitorCount: workspace?.competitorCount || 0,
  })

  return {
    steps,
    readinessScore: getReadinessScore(steps),
    focus: getReadinessFocus(steps),
  }
}

export function ensureSelectedAdsCustomer(items = [], customerId = '') {
  const normalizedCustomerId = String(customerId || '').trim()
  if (!normalizedCustomerId) return items
  if ((items || []).some((item) => String(item.customerId) === normalizedCustomerId)) return items

  return [
    {
      customerId: normalizedCustomerId,
      displayName: `Current selection (${normalizedCustomerId})`,
      synthetic: true,
    },
    ...(items || []),
  ]
}

export function formatAdsCustomerLabel(item) {
  if (item.synthetic) {
    return `${item.displayName} - not returned for this token`
  }
  return item.displayName
}

export function useWorkspaceSetupModel({ googleConnected, onRefreshAuth, onSetNotice, workspace }) {
  const [setup, setSetup] = useState(DEFAULT_SETUP_STATE)
  const [rankStatus, setRankStatus] = useState(DEFAULT_RANK_STATUS)
  const [credentials, setCredentials] = useState([])
  const [assets, setAssets] = useState({
    gscSites: EMPTY_ASSET_RESULT,
    ga4Properties: EMPTY_ASSET_RESULT,
    adsCustomers: EMPTY_ASSET_RESULT,
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [runningSync, setRunningSync] = useState(false)
  const [runningAudit, setRunningAudit] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      const [settingsJson, rankConfigJson, credentialsJson] = await Promise.all([
        apiRequest(`/api/workspaces/${workspace.id}/settings`),
        apiRequest(`/api/workspaces/${workspace.id}/rank/config`),
        apiRequest('/api/org/credentials'),
      ])

      if (cancelled) return

      setSetup(createWorkspaceSetupState(settingsJson, rankConfigJson))
      setRankStatus({
        lastStatus: rankConfigJson.lastStatus || 'idle',
        lastCompletedAt: rankConfigJson.lastCompletedAt || null,
        lastError: rankConfigJson.lastError || '',
      })
      setCredentials(credentialsJson.items || [])
      setLoading(false)
    }

    load().catch((error) => {
      if (!cancelled) {
        setLoading(false)
        onSetNotice(error.message)
      }
    })

    return () => {
      cancelled = true
    }
  }, [onSetNotice, workspace.id])

  useEffect(() => {
    if (!googleConnected) {
      setAssets({
        gscSites: { items: [], availability: { state: 'missing_google_connection', message: 'Connect Google to load shared assets.' } },
        ga4Properties: { items: [], availability: { state: 'missing_google_connection', message: 'Connect Google to load shared assets.' } },
        adsCustomers: { items: [], availability: { state: 'missing_google_connection', message: 'Connect Google to load shared assets.' } },
      })
      return
    }

    let cancelled = false
    Promise.all([
      apiRequest('/api/org/google/assets/gsc-sites'),
      apiRequest('/api/org/google/assets/ga4-properties'),
    ]).then(([gscSites, ga4Properties]) => {
      if (!cancelled) {
        setAssets((current) => ({ ...current, gscSites, ga4Properties }))
      }
    }).catch((error) => {
      if (!cancelled) onSetNotice(error.message)
    })

    return () => {
      cancelled = true
    }
  }, [googleConnected, onSetNotice])

  useEffect(() => {
    if (!googleConnected) {
      setAssets((current) => ({
        ...current,
        adsCustomers: { items: [], availability: { state: 'missing_google_connection', message: 'Connect Google to load shared assets.' } },
      }))
      return
    }

    let cancelled = false
    apiRequest(buildApiPath('/api/org/google/assets/ads-customers', {
      workspaceId: workspace.id,
      credentialLabel: setup.googleAdsDeveloperTokenLabel,
    })).then((adsCustomers) => {
      if (!cancelled) {
        setAssets((current) => ({ ...current, adsCustomers }))
      }
    }).catch((error) => {
      if (!cancelled) onSetNotice(error.message)
    })

    return () => {
      cancelled = true
    }
  }, [googleConnected, onSetNotice, setup.googleAdsDeveloperTokenLabel, workspace.id])

  const adsCustomerOptions = useMemo(
    () => ensureSelectedAdsCustomer(assets.adsCustomers.items || [], setup.googleAdsCustomerId),
    [assets.adsCustomers.items, setup.googleAdsCustomerId],
  )

  const rankApiSelection = useMemo(
    () => describeWorkspaceCredentialSelection(credentials, 'dataforseo_or_serpapi', setup.rankApiCredentialLabel),
    [credentials, setup.rankApiCredentialLabel],
  )

  const pageSpeedSelection = useMemo(
    () => describeWorkspaceCredentialSelection(credentials, 'google_pagespeed_api', setup.pageSpeedCredentialLabel),
    [credentials, setup.pageSpeedCredentialLabel],
  )

  const googleAdsTokenSelection = useMemo(
    () => describeWorkspaceCredentialSelection(credentials, 'google_ads_developer_token', setup.googleAdsDeveloperTokenLabel),
    [credentials, setup.googleAdsDeveloperTokenLabel],
  )

  const summary = useMemo(
    () => summarizeWorkspaceSetup({ googleConnected, setup, workspace }),
    [googleConnected, setup, workspace],
  )

  async function refreshSetup() {
    const [settingsJson, rankConfigJson, credentialsJson] = await Promise.all([
      apiRequest(`/api/workspaces/${workspace.id}/settings`),
      apiRequest(`/api/workspaces/${workspace.id}/rank/config`),
      apiRequest('/api/org/credentials'),
    ])

    setSetup(createWorkspaceSetupState(settingsJson, rankConfigJson))
    setRankStatus({
      lastStatus: rankConfigJson.lastStatus || 'idle',
      lastCompletedAt: rankConfigJson.lastCompletedAt || null,
      lastError: rankConfigJson.lastError || '',
    })
    setCredentials(credentialsJson.items || [])
  }

  async function saveSetup() {
    setSaving(true)
    try {
      await Promise.all([
        apiRequest(`/api/workspaces/${workspace.id}/settings`, {
          method: 'PATCH',
          body: buildWorkspaceSettingsPatch(setup),
        }),
        apiRequest(`/api/workspaces/${workspace.id}/rank/config`, {
          method: 'PATCH',
          body: buildRankConfigPatch(setup),
        }),
      ])
      await refreshSetup()
      await onRefreshAuth()
      onSetNotice('Workspace setup updated.')
    } catch (error) {
      onSetNotice(error.message)
    } finally {
      setSaving(false)
    }
  }

  async function runSync(source = 'all') {
    setRunningSync(true)
    try {
      const queued = await apiRequest(`/api/workspaces/${workspace.id}/jobs/run-sync`, {
        method: 'POST',
        body: { source },
      })
      onSetNotice(source === 'all' ? 'Full workspace sync queued.' : `${source.toUpperCase()} sync queued.`)
      if (queued?.jobId) {
        await waitForWorkspaceJob(workspace.id, queued.jobId)
      }
      await refreshSetup()
      onSetNotice(source === 'all' ? 'Full workspace sync completed.' : `${source.toUpperCase()} sync completed.`)
    } catch (error) {
      onSetNotice(error.message)
    } finally {
      setRunningSync(false)
    }
  }

  async function runAudit() {
    setRunningAudit(true)
    try {
      await apiRequest(`/api/workspaces/${workspace.id}/settings`, {
        method: 'PATCH',
        body: {
          auditEntryUrl: setup.auditEntryUrl,
          auditMaxPages: Number(setup.auditMaxPages || 25),
          pageSpeedCredentialLabel: setup.pageSpeedCredentialLabel,
        },
      })
      const queued = await apiRequest(`/api/workspaces/${workspace.id}/audit/run`, {
        method: 'POST',
        body: {
          entryUrl: setup.auditEntryUrl,
          maxPages: Number(setup.auditMaxPages || 25),
        },
      })
      onSetNotice('Site audit queued.')
      if (queued?.jobId) {
        await waitForWorkspaceJob(workspace.id, queued.jobId)
      }
      await refreshSetup()
      onSetNotice('Site audit completed.')
    } catch (error) {
      onSetNotice(error.message)
    } finally {
      setRunningAudit(false)
    }
  }

  return {
    assets,
    adsCustomerOptions,
    credentials,
    googleAdsTokenSelection,
    loading,
    pageSpeedSelection,
    rankApiSelection,
    rankStatus,
    runningAudit,
    runningSync,
    saveSetup,
    saving,
    setSetup,
    setup,
    summary,
    providers: WORKSPACE_CREDENTIAL_PROVIDER_BY_ID,
    refreshSetup,
    runAudit,
    runSync,
  }
}
