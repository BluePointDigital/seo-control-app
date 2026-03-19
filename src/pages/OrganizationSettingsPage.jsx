import { useEffect, useState } from 'react'

import { apiRequest } from '../lib/api'
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
      if (cancelled) return
      applyOrganizationSettings(payload)
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
    <section className="page-grid">
      <article className="panel span-6">
        <div className="panel-head">
          <h2>Organization profile</h2>
          <p>Org-level settings govern the whole agency account, including shared Google auth.</p>
        </div>
        <form className="stack" onSubmit={saveOrganization}>
          <label>Agency name<input value={name} onChange={(event) => setName(event.target.value)} /></label>
          <button type="submit">Save organization</button>
        </form>
        <div className="subpanel mt">
          <h3>Google connection</h3>
          <p className="muted-copy">OAuth client settings are environment-managed now. The UI only controls the shared connection state.</p>
          <div className="stack">
            <div className="metric-tile"><span>Configured</span><strong>{google.configured ? 'Yes' : 'No'}</strong></div>
            <div className="metric-tile"><span>Connected</span><strong>{google.connected ? 'Yes' : 'No'}</strong></div>
            {!google.connected ? <button type="button" onClick={connectGoogle}>Connect Google</button> : <button type="button" className="secondary" onClick={disconnectGoogle}>Disconnect Google</button>}
          </div>
        </div>
      </article>

      <aside className="panel span-6">
        <div className="panel-head">
          <h2>Credential vault</h2>
          <p>Store shared provider secrets once per organization, then let each workspace choose which saved label it should use for Rank, PageSpeed, and Google Ads.</p>
        </div>
        <form className="stack" onSubmit={saveCredential}>
          <label>Provider<select value={credentialForm.provider} onChange={(event) => setCredentialForm((current) => ({ ...current, provider: event.target.value }))}>{PROVIDERS.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}</select></label>
          <label>Label<input value={credentialForm.label} onChange={(event) => setCredentialForm((current) => ({ ...current, label: event.target.value }))} /></label>
          <p className="muted-copy inline-note">Use labels like <code>default</code>, <code>client-a</code>, or <code>enterprise</code>. Workspaces can choose among saved labels per provider.</p>
          <label>Value<textarea value={credentialForm.value} onChange={(event) => setCredentialForm((current) => ({ ...current, value: event.target.value }))} /></label>
          <button type="submit">Save credential</button>
        </form>
        <div className="list-table mt">
          {credentials.map((item) => (
            <div key={item.id} className="list-row">
              <span>{formatProviderLabel(item.provider)} / {item.label}</span>
              <div className="row-actions tight">
                <code>{item.maskedValue}</code>
                <button type="button" className="secondary small" onClick={() => deleteCredential(item.id)}>Delete</button>
              </div>
            </div>
          ))}
          {!credentials.length ? <p className="muted-copy">No org credentials saved yet.</p> : null}
        </div>
      </aside>

      <article className="panel span-12">
        <div className="panel-head">
          <h2>API access</h2>
          <p>Create workspace-scoped bearer tokens for external agents. Send them as <code>Authorization: Bearer ...</code>.</p>
        </div>

        {createdToken ? (
          <div className="notice-bar token-secret">
            <strong>Copy this token now.</strong>
            <code>{createdToken}</code>
          </div>
        ) : null}

        {!canManageApiTokens ? (
          <p className="muted-copy">Only organization owners and admins can manage API tokens.</p>
        ) : (
          <div className="two-column mt">
            <form className="stack" onSubmit={createToken}>
              <label>
                Token label
                <input value={apiTokenForm.label} onChange={(event) => setApiTokenForm((current) => ({ ...current, label: event.target.value }))} placeholder="Reporting agent" />
              </label>

              <div className="subpanel">
                <h3>Scopes</h3>
                <div className="choice-grid mt">
                  {API_SCOPES.map((scope) => (
                    <label key={scope.id} className="choice-card">
                      <input type="checkbox" checked={apiTokenForm.scopes.includes(scope.id)} onChange={() => toggleScope(scope.id)} />
                      <strong>{scope.label}</strong>
                      <span>{scope.copy}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="subpanel">
                <h3>Workspace access</h3>
                <div className="choice-grid mt">
                  {workspaces.map((workspace) => (
                    <label key={workspace.id} className="choice-card">
                      <input type="checkbox" checked={apiTokenForm.workspaceIds.includes(workspace.id)} onChange={() => toggleWorkspace(workspace.id)} />
                      <strong>{workspace.name}</strong>
                      <span>{workspace.slug}</span>
                    </label>
                  ))}
                </div>
                {!workspaces.length ? <p className="muted-copy mt">Create a workspace before issuing API tokens.</p> : null}
              </div>

              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={apiTokenForm.neverExpires}
                  onChange={(event) => setApiTokenForm((current) => ({ ...current, neverExpires: event.target.checked }))}
                />
                <span>Never expire this token</span>
              </label>

              {!apiTokenForm.neverExpires ? (
                <label>
                  Expiry date
                  <input type="date" value={apiTokenForm.expiresAt} onChange={(event) => setApiTokenForm((current) => ({ ...current, expiresAt: event.target.value }))} />
                </label>
              ) : null}

              <button type="submit" disabled={!workspaces.length}>Create API token</button>
            </form>

            <div className="stack">
              {apiTokens.map((item) => (
                <div key={item.id} className="list-row token-row">
                  <div className="page-stack">
                    <strong>{item.label}</strong>
                    <span className="muted-copy">{item.maskedToken}</span>
                    <span className="muted-copy">Scopes: {item.scopes.join(', ') || 'none'}</span>
                    <span className="muted-copy">Workspaces: {item.workspaces.map((workspace) => workspace.name).join(', ') || 'None selected'}</span>
                    <span className="muted-copy">Status: {item.status}</span>
                    <span className="muted-copy">Last used: {formatDateLabel(item.lastUsedAt)}</span>
                    <span className="muted-copy">Expires: {item.expiresAt ? formatDateLabel(item.expiresAt) : 'Never'}</span>
                  </div>
                  <div className="row-actions tight">
                    {item.status === 'active' ? (
                      <button type="button" className="secondary small" onClick={() => revokeToken(item.id)}>Revoke</button>
                    ) : null}
                  </div>
                </div>
              ))}
              {!apiTokens.length ? <p className="muted-copy">No API tokens created yet.</p> : null}
            </div>
          </div>
        )}
      </article>
    </section>
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
