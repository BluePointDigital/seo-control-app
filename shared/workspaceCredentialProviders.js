export const DEFAULT_CREDENTIAL_LABEL = 'default'

export const WORKSPACE_CREDENTIAL_PROVIDERS = [
  {
    id: 'dataforseo_or_serpapi',
    settingKey: 'rank_api_credential_label',
    requestField: 'rankApiCredentialLabel',
    label: 'Rank API key label',
    credentialName: 'Rank API key',
  },
  {
    id: 'google_pagespeed_api',
    settingKey: 'google_pagespeed_api_label',
    requestField: 'pageSpeedCredentialLabel',
    label: 'PageSpeed key label',
    credentialName: 'PageSpeed Insights API key',
  },
  {
    id: 'google_ads_developer_token',
    settingKey: 'google_ads_developer_token_label',
    requestField: 'googleAdsDeveloperTokenLabel',
    label: 'Google Ads developer token label',
    credentialName: 'Google Ads developer token',
  },
]

export const WORKSPACE_CREDENTIAL_PROVIDER_BY_ID = Object.freeze(Object.fromEntries(
  WORKSPACE_CREDENTIAL_PROVIDERS.map((item) => [item.id, item]),
))

export const WORKSPACE_CREDENTIAL_PROVIDER_BY_REQUEST_FIELD = Object.freeze(Object.fromEntries(
  WORKSPACE_CREDENTIAL_PROVIDERS.map((item) => [item.requestField, item]),
))

export function normalizeCredentialLabel(value = DEFAULT_CREDENTIAL_LABEL) {
  const normalized = String(value || '').trim()
  return normalized || DEFAULT_CREDENTIAL_LABEL
}

export function getWorkspaceCredentialProvider(providerId) {
  return WORKSPACE_CREDENTIAL_PROVIDER_BY_ID[providerId] || null
}

export function getWorkspaceCredentialLabelFromSettings(settings = {}, providerId) {
  const provider = getWorkspaceCredentialProvider(providerId)
  if (!provider) return DEFAULT_CREDENTIAL_LABEL
  return normalizeCredentialLabel(settings?.[provider.settingKey])
}

export function listCredentialLabelsForProvider(credentials = [], providerId) {
  const labels = new Set([DEFAULT_CREDENTIAL_LABEL])

  for (const item of credentials || []) {
    if (item?.provider !== providerId) continue
    labels.add(normalizeCredentialLabel(item.label))
  }

  return [
    DEFAULT_CREDENTIAL_LABEL,
    ...[...labels].filter((label) => label !== DEFAULT_CREDENTIAL_LABEL).sort((left, right) => left.localeCompare(right)),
  ]
}

export function describeWorkspaceCredentialSelection(credentials = [], providerId, selectedLabel = DEFAULT_CREDENTIAL_LABEL) {
  const normalizedSelectedLabel = normalizeCredentialLabel(selectedLabel)
  const existingLabels = new Set((credentials || [])
    .filter((item) => item?.provider === providerId)
    .map((item) => normalizeCredentialLabel(item.label)))

  const hasSelectedLabel = existingLabels.has(normalizedSelectedLabel)
  const hasDefaultLabel = existingLabels.has(DEFAULT_CREDENTIAL_LABEL)
  const fallbackLabel = !hasSelectedLabel && hasDefaultLabel ? DEFAULT_CREDENTIAL_LABEL : ''
  const options = [{ value: DEFAULT_CREDENTIAL_LABEL, label: DEFAULT_CREDENTIAL_LABEL, missing: !hasDefaultLabel }]

  if (normalizedSelectedLabel !== DEFAULT_CREDENTIAL_LABEL && !hasSelectedLabel) {
    options.push({
      value: normalizedSelectedLabel,
      label: `${normalizedSelectedLabel} (missing)`,
      missing: true,
    })
  }

  for (const label of listCredentialLabelsForProvider(credentials, providerId)) {
    if (label === DEFAULT_CREDENTIAL_LABEL || label === normalizedSelectedLabel) continue
    options.push({ value: label, label, missing: false })
  }

  return {
    selectedLabel: normalizedSelectedLabel,
    hasSelectedLabel,
    hasDefaultLabel,
    fallbackLabel,
    fallbackActive: Boolean(fallbackLabel && normalizedSelectedLabel !== fallbackLabel),
    missingAll: !hasSelectedLabel && !hasDefaultLabel,
    missingSelected: normalizedSelectedLabel !== DEFAULT_CREDENTIAL_LABEL && !hasSelectedLabel,
    options,
  }
}
