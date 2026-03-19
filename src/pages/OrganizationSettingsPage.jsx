import { useEffect, useState } from 'react'

import { apiRequest } from '../lib/api'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { PageIntro, SectionHeading } from '../components/ui/surface'
import { Select } from '../components/ui/select'
import { Textarea } from '../components/ui/textarea'
import { WORKSPACE_CREDENTIAL_PROVIDERS } from '../../shared/workspaceCredentialProviders.js'

const PROVIDERS = [
  ...WORKSPACE_CREDENTIAL_PROVIDERS.map((provider) => ({
    id: provider.id,
    label: provider.credentialName,
  })),
  {
    id: 'backlink_provider',
    label: 'Backlink provider key',
  },
]

const API_SCOPES = [
  { id: 'read', label: 'Read', copy: 'View workspace data and reports.' },
  { id: 'write', label: 'Write', copy: 'Update workspace settings and tracked data.' },
  { id: 'run', label: 'Run', copy: 'Trigger syncs, audits, and report jobs.' },
]

export function OrganizationSettingsPage({ onRefreshAuth, onSetNotice }) {
  const [google, setGoogle] = useState({ configured: false, connected: false })
  const [credentials, setCredentials] = useState([])
  const [apiTokens, setApiTokens] = useState([])
  const [workspaces, setWorkspaces] = useState([])
  const [role, setRole] = useState('member')
  const [name, setName] = useState('')
  const [createdToken, setCreatedToken] = useState('')
  const [credentialForm, setCredentialForm] = useState({ provider: PROVIDERS[0].id, label: 'default', value: '' })
  const [apiTokenForm, setApiTokenForm] = useState(createApiTokenForm())

  function applyOrganizationSettings(payload) {
    setGoogle(payload.google)
    setName(payload.organization.name)
    setRole(payload.role || 'member')
    setCredentials(payload.credentials || [])
    setWorkspaces(payload.workspaces || [])
    setApiTokens(payload.apiTokens || [])
    setApiTokenForm((current) => synchronizeApiTokenForm(current, payload.workspaces || []))
  }

  async function loadOrganizationSettings() {
    const [orgJson, credentialsJson, workspacesJson] = await Promise.all([
      apiRequest('/api/org'),
      apiRequest('/api/org/credentials'),
      apiRequest('/api/workspaces'),
    ])

    const canManageApiTokens = ['owner', 'admin'].includes(orgJson.role)
    const apiTokensJson = canManageApiTokens
      ? await apiRequest('/api/org/api-tokens')
      : { items: [] }

    return {
      ...orgJson,
      credentials: credentialsJson.items || [],
      workspaces: workspacesJson.items || [],
      apiTokens: apiTokensJson.items || [],
    }
  }

  async function reload() {
    const payload = await loadOrganizationSettings()
    applyOrganizationSettings(payload)
  }

  useEffect(() => {
    let cancelled = false

    loadOrganizationSettings().then((payload) => {
      if (!cancelled) applyOrganizationSettings(payload)
    }).catch((error) => onSetNotice(error.message))

    return () => { cancelled = true }
  }, [onSetNotice])

  async function saveOrganization(event) {
    event.preventDefault()
    try {
      await apiRequest('/api/org', { method: 'PATCH', body: { name } })
      await reload()
      await onRefreshAuth()
      onSetNotice('Organization updated.')
    } catch (error) {
      onSetNotice(error.message)
    }
  }

  async function connectGoogle() {
    try {
      const response = await apiRequest('/api/org/google/connect/start')
      window.location.href = response.authUrl
    } catch (error) {
      onSetNotice(error.message)
    }
  }

  async function disconnectGoogle() {
    try {
      await apiRequest('/api/org/google/disconnect', { method: 'POST' })
      await reload()
      onSetNotice('Google disconnected.')
    } catch (error) {
      onSetNotice(error.message)
    }
  }

  async function saveCredential(event) {
    event.preventDefault()
    try {
      await apiRequest('/api/org/credentials', { method: 'POST', body: credentialForm })
      setCredentialForm((current) => ({ ...current, value: '' }))
      await reload()
      onSetNotice('Credential saved.')
    } catch (error) {
      onSetNotice(error.message)
    }
  }

  async function deleteCredential(id) {
    try {
      await apiRequest(`/api/org/credentials/${id}`, { method: 'DELETE' })
      await reload()
    } catch (error) {
      onSetNotice(error.message)
    }
  }

  async function createToken(event) {
    event.preventDefault()
    try {
      const response = await apiRequest('/api/org/api-tokens', {
        method: 'POST',
        body: {
          label: apiTokenForm.label,
          scopes: apiTokenForm.scopes,
          workspaceIds: apiTokenForm.workspaceIds,
          expiresAt: apiTokenForm.neverExpires ? null : apiTokenForm.expiresAt,
        },
      })
      setCreatedToken(response.token || '')
      setApiTokenForm(synchronizeApiTokenForm(createApiTokenForm(), workspaces))
      await reload()
      onSetNotice('API token created. Copy it now because it will not be shown again.')
    } catch (error) {
      onSetNotice(error.message)
    }
  }

  async function revokeToken(id) {
    try {
      await apiRequest(`/api/org/api-tokens/${id}/revoke`, { method: 'POST' })
      await reload()
      onSetNotice('API token revoked.')
    } catch (error) {
      onSetNotice(error.message)
    }
  }

  function toggleScope(scopeId) {
    setApiTokenForm((current) => {
      const scopes = current.scopes.includes(scopeId)
        ? current.scopes.filter((scope) => scope !== scopeId)
        : [...current.scopes, scopeId]
      return { ...current, scopes }
    })
  }

  function toggleWorkspace(workspaceId) {
    setApiTokenForm((current) => {
      const workspaceIds = current.workspaceIds.includes(workspaceId)
        ? current.workspaceIds.filter((id) => id !== workspaceId)
        : [...current.workspaceIds, workspaceId]
      return { ...current, workspaceIds }
    })
  }

  const canManageApiTokens = ['owner', 'admin'].includes(role)

  return (
    <div className="space-y-6">
      <PageIntro
        badge="Organization"
        title="Agency settings"
        description="This page now stays strictly organization-level: shared Google auth, credential vault, API access, and agency profile."
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Organization profile</CardTitle>
            <CardDescription>Shared settings that affect the whole agency account.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <form className="space-y-4" onSubmit={saveOrganization}>
              <Field label="Agency name">
                <Input value={name} onChange={(event) => setName(event.target.value)} />
              </Field>
              <Button type="submit">Save organization</Button>
            </form>

            <div className="rounded-[24px] border border-slate-200 bg-slate-50/70 p-5">
              <SectionHeading
                title="Google connection"
                description="OAuth client settings stay environment-managed. This UI only controls the shared connection state."
                action={<Badge variant={google.connected ? 'accent' : 'warning'}>{google.connected ? 'Connected' : 'Disconnected'}</Badge>}
              />
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <StatusTile label="Configured" value={google.configured ? 'Yes' : 'No'} />
                <StatusTile label="Connected" value={google.connected ? 'Yes' : 'No'} />
              </div>
              <div className="mt-4">
                {!google.connected ? <Button type="button" onClick={connectGoogle}>Connect Google</Button> : <Button type="button" variant="secondary" onClick={disconnectGoogle}>Disconnect Google</Button>}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Credential vault</CardTitle>
            <CardDescription>Store shared provider secrets once per organization, then let each workspace choose a saved label in Setup.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <form className="space-y-4" onSubmit={saveCredential}>
              <Field label="Provider">
                <Select value={credentialForm.provider} onChange={(event) => setCredentialForm((current) => ({ ...current, provider: event.target.value }))}>
                  {PROVIDERS.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
                </Select>
              </Field>
              <Field label="Label">
                <Input value={credentialForm.label} onChange={(event) => setCredentialForm((current) => ({ ...current, label: event.target.value }))} />
              </Field>
              <p className="text-xs leading-5 text-slate-400">Use labels like <code>default</code>, <code>client-a</code>, or <code>enterprise</code>.</p>
              <Field label="Value">
                <Textarea value={credentialForm.value} onChange={(event) => setCredentialForm((current) => ({ ...current, value: event.target.value }))} />
              </Field>
              <Button type="submit">Save credential</Button>
            </form>

            <div className="grid gap-3">
              {credentials.map((item) => (
                <div key={item.id} className="flex flex-col gap-3 rounded-[24px] border border-slate-200 bg-slate-50/70 px-4 py-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="font-semibold text-slate-950">{formatProviderLabel(item.provider)} / {item.label}</p>
                    <p className="mt-1 text-sm text-slate-500">{item.maskedValue}</p>
                  </div>
                  <Button type="button" variant="secondary" size="sm" onClick={() => deleteCredential(item.id)}>Delete</Button>
                </div>
              ))}
              {!credentials.length ? <p className="text-sm text-slate-500">No org credentials saved yet.</p> : null}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>API access</CardTitle>
          <CardDescription>Create workspace-scoped bearer tokens for external agents.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {createdToken ? (
            <div className="rounded-[24px] border border-emerald-200 bg-emerald-50 px-4 py-4">
              <p className="text-sm font-semibold text-emerald-800">Copy this token now</p>
              <code className="mt-2 block text-sm text-emerald-700">{createdToken}</code>
            </div>
          ) : null}

          {!canManageApiTokens ? (
            <p className="text-sm text-slate-500">Only organization owners and admins can manage API tokens.</p>
          ) : (
            <div className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <form className="space-y-5" onSubmit={createToken}>
                <Field label="Token label">
                  <Input value={apiTokenForm.label} onChange={(event) => setApiTokenForm((current) => ({ ...current, label: event.target.value }))} placeholder="Reporting agent" />
                </Field>

                <div className="space-y-3 rounded-[24px] border border-slate-200 bg-slate-50/70 p-4">
                  <p className="text-sm font-semibold text-slate-950">Scopes</p>
                  <div className="grid gap-3">
                    {API_SCOPES.map((scope) => (
                      <label key={scope.id} className="flex items-start gap-3 rounded-[20px] border border-slate-200 bg-white px-4 py-3">
                        <input type="checkbox" checked={apiTokenForm.scopes.includes(scope.id)} onChange={() => toggleScope(scope.id)} />
                        <span>
                          <strong className="block text-sm text-slate-950">{scope.label}</strong>
                          <span className="text-sm text-slate-500">{scope.copy}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="space-y-3 rounded-[24px] border border-slate-200 bg-slate-50/70 p-4">
                  <p className="text-sm font-semibold text-slate-950">Workspace access</p>
                  <div className="grid gap-3">
                    {workspaces.map((workspace) => (
                      <label key={workspace.id} className="flex items-start gap-3 rounded-[20px] border border-slate-200 bg-white px-4 py-3">
                        <input type="checkbox" checked={apiTokenForm.workspaceIds.includes(workspace.id)} onChange={() => toggleWorkspace(workspace.id)} />
                        <span>
                          <strong className="block text-sm text-slate-950">{workspace.name}</strong>
                          <span className="text-sm text-slate-500">{workspace.slug}</span>
                        </span>
                      </label>
                    ))}
                    {!workspaces.length ? <p className="text-sm text-slate-500">Create a workspace before issuing API tokens.</p> : null}
                  </div>
                </div>

                <label className="flex items-center gap-3 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={apiTokenForm.neverExpires}
                    onChange={(event) => setApiTokenForm((current) => ({ ...current, neverExpires: event.target.checked }))}
                  />
                  Never expire this token
                </label>

                {!apiTokenForm.neverExpires ? (
                  <Field label="Expiry date">
                    <Input type="date" value={apiTokenForm.expiresAt} onChange={(event) => setApiTokenForm((current) => ({ ...current, expiresAt: event.target.value }))} />
                  </Field>
                ) : null}

                <Button type="submit" disabled={!workspaces.length}>Create API token</Button>
              </form>

              <div className="grid gap-3">
                {apiTokens.map((item) => (
                  <div key={item.id} className="rounded-[24px] border border-slate-200 bg-slate-50/70 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-950">{item.label}</p>
                        <p className="mt-1 text-sm text-slate-500">{item.maskedToken}</p>
                      </div>
                      <Badge variant={item.status === 'active' ? 'accent' : 'warning'}>{item.status}</Badge>
                    </div>
                    <div className="mt-4 space-y-1 text-sm text-slate-500">
                      <p>Scopes: {item.scopes.join(', ') || 'none'}</p>
                      <p>Workspaces: {item.workspaces.map((workspace) => workspace.name).join(', ') || 'None selected'}</p>
                      <p>Last used: {formatDateLabel(item.lastUsedAt)}</p>
                      <p>Expires: {item.expiresAt ? formatDateLabel(item.expiresAt) : 'Never'}</p>
                    </div>
                    {item.status === 'active' ? <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={() => revokeToken(item.id)}>Revoke</Button> : null}
                  </div>
                ))}
                {!apiTokens.length ? <p className="text-sm text-slate-500">No API tokens created yet.</p> : null}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Field({ children, label }) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  )
}

function StatusTile({ label, value }) {
  return (
    <div className="rounded-[20px] border border-slate-200 bg-white px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</p>
      <p className="mt-2 text-lg font-semibold text-slate-950">{value}</p>
    </div>
  )
}

function createApiTokenForm() {
  return {
    label: '',
    scopes: ['read'],
    workspaceIds: [],
    expiresAt: defaultExpiryDate(),
    neverExpires: false,
  }
}

function synchronizeApiTokenForm(form, workspaces) {
  const workspaceIds = new Set((workspaces || []).map((workspace) => Number(workspace.id)))
  const nextWorkspaceIds = (form.workspaceIds || []).filter((workspaceId) => workspaceIds.has(Number(workspaceId)))

  if (!nextWorkspaceIds.length && (workspaces || []).length === 1) {
    nextWorkspaceIds.push(Number(workspaces[0].id))
  }

  return {
    ...form,
    workspaceIds: nextWorkspaceIds,
    expiresAt: form.expiresAt || defaultExpiryDate(),
  }
}

function defaultExpiryDate() {
  return new Date(Date.now() + (90 * 24 * 60 * 60 * 1000)).toISOString().slice(0, 10)
}

function formatDateLabel(value) {
  if (!value) return 'Never'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString()
}

function formatProviderLabel(providerId) {
  return PROVIDERS.find((provider) => provider.id === providerId)?.label || providerId
}
