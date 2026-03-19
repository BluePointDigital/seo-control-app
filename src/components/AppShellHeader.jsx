import { useEffect, useState } from 'react'

import { getDateRangeWindow } from '../lib/dateRange'
import { APP_SECTIONS, PORTFOLIO_NAV, SETTINGS_SECTIONS } from '../lib/workspace'

export function AppShellHeader({
  activeWorkspaceId,
  canManageWorkspaces = false,
  currentMode,
  currentSection,
  dateRange,
  notice,
  onDateRangeChange,
  onCreateWorkspace,
  onLogout,
  onNavigate,
  onWorkspaceChange,
  organizationName,
  role,
  showDateRange = false,
  workspaces,
}) {
  const [customDraft, setCustomDraft] = useState(() => getDateRangeWindow(dateRange))
  const [createWorkspaceOpen, setCreateWorkspaceOpen] = useState(false)
  const [createWorkspaceName, setCreateWorkspaceName] = useState('')
  const [createWorkspaceBusy, setCreateWorkspaceBusy] = useState(false)

  useEffect(() => {
    setCustomDraft(getDateRangeWindow(dateRange))
  }, [dateRange])

  function handlePresetChange(value) {
    if (value === 'custom') {
      const draft = getDateRangeWindow(dateRange)
      setCustomDraft(draft)
      onDateRangeChange({ mode: 'custom', ...draft })
      return
    }

    onDateRangeChange({ mode: 'preset', days: Number(value) })
  }

  function applyCustomRange() {
    if (!customDraft.startDate || !customDraft.endDate) return
    onDateRangeChange({ mode: 'custom', ...customDraft })
  }

  async function handleCreateWorkspace(event) {
    event.preventDefault()

    if (!onCreateWorkspace || !createWorkspaceName.trim()) return

    setCreateWorkspaceBusy(true)
    const created = await onCreateWorkspace(createWorkspaceName.trim())
    setCreateWorkspaceBusy(false)

    if (!created) return

    setCreateWorkspaceName('')
    setCreateWorkspaceOpen(false)
  }

  function closeCreateWorkspace() {
    setCreateWorkspaceName('')
    setCreateWorkspaceOpen(false)
  }

  return (
    <>
      <header className="shell-header">
        <div>
          <p className="eyebrow">Agency SEO Control</p>
          <h1>{organizationName || 'Agency Workspace'}</h1>
          <p className="shell-subcopy">Client operations, monitoring, reporting, and delivery in one system.</p>
        </div>
        <div className="header-controls">
          <div className="workspace-switcher">
            <label htmlFor="active-workspace-select">Active workspace</label>
            <div className="workspace-switcher-row">
              <select id="active-workspace-select" value={String(activeWorkspaceId || '')} onChange={(event) => onWorkspaceChange(event.target.value)}>
                {workspaces.map((workspace) => (
                  <option key={workspace.id} value={String(workspace.id)}>{workspace.name}</option>
                ))}
              </select>
              {canManageWorkspaces && !createWorkspaceOpen ? (
                <button type="button" className="secondary small" onClick={() => setCreateWorkspaceOpen(true)}>New workspace</button>
              ) : null}
            </div>
            {canManageWorkspaces && createWorkspaceOpen ? (
              <form className="workspace-create-form" onSubmit={handleCreateWorkspace}>
                <input
                  aria-label="Workspace name"
                  autoFocus
                  value={createWorkspaceName}
                  onChange={(event) => setCreateWorkspaceName(event.target.value)}
                  placeholder="Acme Dental"
                  disabled={createWorkspaceBusy}
                  required
                />
                <div className="row-actions tight">
                  <button type="submit" className="small" disabled={createWorkspaceBusy || !createWorkspaceName.trim()}>
                    {createWorkspaceBusy ? 'Creating...' : 'Create'}
                  </button>
                  <button type="button" className="secondary small" onClick={closeCreateWorkspace} disabled={createWorkspaceBusy}>Cancel</button>
                </div>
              </form>
            ) : null}
          </div>
          {showDateRange ? (
            <div className="date-range-control">
              <label>
                Reporting window
                <select value={dateRange.mode === 'custom' ? 'custom' : String(dateRange.days)} onChange={(event) => handlePresetChange(event.target.value)}>
                  <option value="7">Last 7 days</option>
                  <option value="30">Last 30 days</option>
                  <option value="90">Last 90 days</option>
                  <option value="custom">Custom range</option>
                </select>
              </label>
              {dateRange.mode === 'custom' ? (
                <div className="date-range-row">
                  <label>
                    Start
                    <input type="date" value={customDraft.startDate} onChange={(event) => setCustomDraft((current) => ({ ...current, startDate: event.target.value }))} />
                  </label>
                  <label>
                    End
                    <input type="date" value={customDraft.endDate} onChange={(event) => setCustomDraft((current) => ({ ...current, endDate: event.target.value }))} />
                  </label>
                  <button type="button" className="secondary small" onClick={applyCustomRange}>Apply</button>
                </div>
              ) : <p className="muted-copy range-pill">{dateRange.label}</p>}
            </div>
          ) : null}
          <div className="role-pill">{role || 'member'}</div>
          <button type="button" className="secondary" onClick={onLogout}>Log out</button>
        </div>
      </header>

      <nav className="shell-nav">
        <div className="tabbar">
          <button
            type="button"
            className={currentMode === 'portfolio' ? 'tab active' : 'tab'}
            onClick={() => onNavigate('portfolio', PORTFOLIO_NAV.id)}
          >
            {PORTFOLIO_NAV.label}
          </button>
          {APP_SECTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={currentMode === 'workspace' && currentSection === item.id ? 'tab active' : 'tab'}
              onClick={() => onNavigate('workspace', item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="tabbar muted">
          {SETTINGS_SECTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={currentMode === 'settings' && currentSection === item.id ? 'tab active' : 'tab'}
              onClick={() => onNavigate('settings', item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </nav>

      {notice ? <div className="notice-bar">{notice}</div> : null}
    </>
  )
}
