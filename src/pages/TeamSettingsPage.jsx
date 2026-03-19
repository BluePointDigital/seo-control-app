import { useEffect, useState } from 'react'

import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Select } from '../components/ui/select'
import { MetricCard, PageIntro, SectionHeading, StatusPill } from '../components/ui/surface'
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

    return () => {
      cancelled = true
    }
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
    <div className="space-y-6">
      <PageIntro
        badge="Team"
        title="Team and workspace administration"
        description="Keep agency membership, invitations, and workspace inventory in one org-scoped admin area."
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <SectionHeading
              title="Team members"
              description="Agency roles are org-scoped while daily work stays inside client workspaces."
            />
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-3">
              <MetricCard label="Members" value={members.length} tone="accent" />
              <MetricCard label="Pending invites" value={invitations.filter((invite) => invite.status === 'pending').length} />
              <MetricCard label="Admins + owners" value={members.filter((member) => member.role === 'admin' || member.role === 'owner').length} />
            </div>

            <div className="grid gap-3">
              {members.map((member) => (
                <div key={member.id} className="flex flex-col gap-4 rounded-[24px] border border-slate-200 bg-slate-50/70 px-5 py-5 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-slate-950">{member.displayName}</p>
                      <Badge variant="neutral">{member.role}</Badge>
                      <StatusPill tone={member.status === 'active' ? 'success' : 'warning'} value={member.status} />
                    </div>
                    <p className="mt-2 text-sm text-slate-500">{member.email}</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.12em] text-slate-400">
                      Joined {formatDate(member.joinedAt)}{member.lastLoginAt ? ` / Last login ${formatDate(member.lastLoginAt)}` : ''}
                    </p>
                  </div>
                </div>
              ))}
              {!members.length ? <p className="text-sm text-slate-500">No team members found.</p> : null}
            </div>

            <div className="rounded-[28px] border border-slate-200 bg-white p-5">
              <SectionHeading
                title="Invite a teammate"
                description="Create an invite and share the preview link during the beta."
              />
              <form className="mt-5 space-y-4" onSubmit={sendInvite}>
                <Field label="Email">
                  <Input
                    value={inviteForm.email}
                    onChange={(event) => setInviteForm((current) => ({ ...current, email: event.target.value }))}
                    type="email"
                  />
                </Field>
                <Field label="Role">
                  <Select value={inviteForm.role} onChange={(event) => setInviteForm((current) => ({ ...current, role: event.target.value }))}>
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </Select>
                </Field>
                <Button type="submit">Send invite</Button>
              </form>
            </div>

            <div className="space-y-3">
              <SectionHeading
                title="Invitation history"
                description="Track pending, accepted, and expired invitations."
              />
              {invitations.map((invite) => (
                <div key={invite.id} className="flex flex-col gap-3 rounded-[24px] border border-slate-200 bg-slate-50/70 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-semibold text-slate-950">{invite.email}</p>
                    <p className="mt-1 text-sm text-slate-500">{invite.role}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <StatusPill tone={invite.status === 'accepted' ? 'success' : invite.status === 'pending' ? 'warning' : 'default'} value={invite.status} />
                    <span className="text-xs uppercase tracking-[0.12em] text-slate-400">Created {formatDate(invite.createdAt)}</span>
                  </div>
                </div>
              ))}
              {!invitations.length ? <p className="text-sm text-slate-500">No invites sent yet.</p> : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <SectionHeading
              title="Workspace management"
              description="Each workspace maps to one client account. Create, review, and clean up them here."
            />
          </CardHeader>
          <CardContent className="space-y-6">
            <form className="flex flex-col gap-3 sm:flex-row" onSubmit={createWorkspace}>
              <Input
                value={workspaceName}
                onChange={(event) => setWorkspaceName(event.target.value)}
                placeholder="New client workspace"
              />
              <Button type="submit">Create workspace</Button>
            </form>

            <div className="grid gap-3">
              {workspaces.map((workspace) => (
                <div key={workspace.id} className="flex flex-col gap-4 rounded-[24px] border border-slate-200 bg-slate-50/70 px-5 py-5 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="font-semibold text-slate-950">{workspace.name}</p>
                    <p className="mt-2 text-sm text-slate-500">
                      {workspace.keywordCount || 0} keywords tracked
                      {workspace.competitorCount ? ` / ${workspace.competitorCount} competitors` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <Badge variant="neutral">{workspace.slug}</Badge>
                    <Button type="button" variant="secondary" size="sm" onClick={() => deleteWorkspace(workspace.id)}>
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
              {!workspaces.length ? <p className="text-sm text-slate-500">No workspaces available.</p> : null}
            </div>
          </CardContent>
        </Card>
      </div>
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

function formatDate(value) {
  if (!value) return 'recently'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString()
}
