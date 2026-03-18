import { useEffect, useState } from 'react'

import { apiRequest } from '../lib/api'

export function TeamSettingsPage({ onRefreshAuth, onSetNotice, workspaces }) {
  const [members, setMembers] = useState([])
  const [invitations, setInvitations] = useState([])
  const [inviteForm, setInviteForm] = useState({ email: '', role: 'member' })
  const [workspaceName, setWorkspaceName] = useState('')

  async function reload() {
    const [membersJson, invitesJson] = await Promise.all([
      apiRequest('/api/org/members'),
      apiRequest('/api/org/invitations'),
    ])
    setMembers(membersJson.items || [])
    setInvitations(invitesJson.items || [])
  }

  useEffect(() => {
    let cancelled = false
    Promise.all([
      apiRequest('/api/org/members'),
      apiRequest('/api/org/invitations'),
    ]).then(([membersJson, invitesJson]) => {
      if (cancelled) return
      setMembers(membersJson.items || [])
      setInvitations(invitesJson.items || [])
    }).catch((error) => onSetNotice(error.message))

    return () => { cancelled = true }
  }, [onSetNotice])

  async function sendInvite(event) {
    event.preventDefault()
    try {
      const response = await apiRequest('/api/org/invitations', { method: 'POST', body: inviteForm })
      setInviteForm({ email: '', role: 'member' })
      await reload()
      onSetNotice(`Invite created. Preview link: ${response.acceptUrl}`)
    } catch (error) {
      onSetNotice(error.message)
    }
  }

  async function createWorkspace(event) {
    event.preventDefault()
    try {
      await apiRequest('/api/workspaces', { method: 'POST', body: { name: workspaceName } })
      setWorkspaceName('')
      await onRefreshAuth()
      onSetNotice('Workspace created.')
    } catch (error) {
      onSetNotice(error.message)
    }
  }

  async function deleteWorkspace(id) {
    try {
      await apiRequest(`/api/workspaces/${id}`, { method: 'DELETE' })
      await onRefreshAuth()
      onSetNotice('Workspace deleted.')
    } catch (error) {
      onSetNotice(error.message)
    }
  }

  return (
    <section className="page-grid">
      <article className="panel span-6">
        <div className="panel-head">
          <h2>Team members</h2>
          <p>Agency roles are org-scoped, while daily work stays inside client workspaces.</p>
        </div>
        <div className="list-table">
          {members.map((member) => (
            <div key={member.id} className="audit-row">
              <strong>{member.displayName}</strong>
              <span>{member.role}</span>
              <p>{member.email}</p>
            </div>
          ))}
        </div>
        <form className="stack mt" onSubmit={sendInvite}>
          <label>Email<input value={inviteForm.email} onChange={(event) => setInviteForm((current) => ({ ...current, email: event.target.value }))} type="email" /></label>
          <label>Role<select value={inviteForm.role} onChange={(event) => setInviteForm((current) => ({ ...current, role: event.target.value }))}><option value="member">Member</option><option value="admin">Admin</option></select></label>
          <button type="submit">Send invite</button>
        </form>
        <div className="list-table mt">
          {invitations.map((invite) => (
            <div key={invite.id} className="list-row">
              <span>{invite.email} ({invite.role})</span>
              <strong>{invite.status}</strong>
            </div>
          ))}
        </div>
      </article>
      <aside className="panel span-6">
        <div className="panel-head">
          <h2>Workspace management</h2>
          <p>Each workspace maps to one client account. Keep the portfolio tidy here.</p>
        </div>
        <form className="row-actions" onSubmit={createWorkspace}>
          <input value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} placeholder="New client workspace" />
          <button type="submit">Create workspace</button>
        </form>
        <div className="list-table mt">
          {workspaces.map((workspace) => (
            <div key={workspace.id} className="list-row">
              <span>{workspace.name}</span>
              <div className="row-actions tight">
                <small>{workspace.keywordCount} keywords</small>
                <button type="button" className="secondary small" onClick={() => deleteWorkspace(workspace.id)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      </aside>
    </section>
  )
}
