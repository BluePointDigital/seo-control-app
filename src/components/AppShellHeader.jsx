import { BriefcaseBusiness, CalendarRange, ChevronsUpDown, LogOut, Plus, Settings2, Users } from 'lucide-react'
import { useEffect, useState } from 'react'

import { getDateRangeWindow } from '../lib/dateRange'
import { APP_SECTIONS, PORTFOLIO_NAV, SETTINGS_SECTIONS } from '../lib/workspace'
import { cn } from '../lib/utils'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import { Input } from './ui/input'
import { Select } from './ui/select'
import { Separator } from './ui/separator'

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
    <div className="space-y-5">
      <header className="sticky top-4 z-20 rounded-[34px] border border-white/70 bg-white/88 px-5 py-5 shadow-[0_24px_80px_-40px_rgba(15,23,42,0.55)] backdrop-blur xl:px-7">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
            <div className="max-w-2xl space-y-3">
              <Badge variant="accent">Agency SEO Control</Badge>
              <div className="space-y-2">
                <h1 className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">{organizationName || 'Agency Workspace'}</h1>
                <p className="max-w-2xl text-sm leading-7 text-slate-500 sm:text-base">
                  Client operations, monitoring, reporting, and delivery in one system.
                </p>
              </div>
            </div>

            <div className="flex w-full flex-col gap-4 xl:max-w-3xl xl:items-end">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(260px,1.1fr)_minmax(240px,1fr)_auto_auto]">
                <div className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-3 shadow-sm">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Active workspace</p>
                  <div className="flex gap-2">
                    <Select
                      className="bg-white"
                      value={String(activeWorkspaceId || '')}
                      onChange={(event) => onWorkspaceChange(event.target.value)}
                    >
                      {workspaces.map((workspace) => (
                        <option key={workspace.id} value={String(workspace.id)}>{workspace.name}</option>
                      ))}
                    </Select>
                    {canManageWorkspaces ? (
                      <Button type="button" variant="secondary" size="icon" onClick={() => setCreateWorkspaceOpen(true)}>
                        <Plus className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </div>
                </div>

                {showDateRange ? (
                  <div className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-3 shadow-sm">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Reporting window</p>
                    <div className="flex items-center gap-2">
                      <CalendarRange className="h-4 w-4 text-slate-400" />
                      <Select
                        className="bg-white"
                        value={dateRange.mode === 'custom' ? 'custom' : String(dateRange.days)}
                        onChange={(event) => handlePresetChange(event.target.value)}
                      >
                        <option value="7">Last 7 days</option>
                        <option value="30">Last 30 days</option>
                        <option value="90">Last 90 days</option>
                        <option value="custom">Custom range</option>
                      </Select>
                    </div>
                  </div>
                ) : null}

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant={currentMode === 'settings' ? 'default' : 'secondary'}
                      className="justify-between gap-2 px-4"
                    >
                      <span className="inline-flex items-center gap-2">
                        <Settings2 className="h-4 w-4" />
                        Admin
                      </span>
                      <ChevronsUpDown className="h-4 w-4 opacity-70" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>Agency settings</DropdownMenuLabel>
                    {SETTINGS_SECTIONS.map((item) => (
                      <DropdownMenuItem key={item.id} onSelect={() => onNavigate('settings', item.id)}>
                        {item.id === 'organization' ? <Settings2 className="h-4 w-4" /> : <Users className="h-4 w-4" />}
                        {item.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="secondary" className="justify-between gap-2 px-4">
                      <span className="inline-flex items-center gap-2">
                        <BriefcaseBusiness className="h-4 w-4" />
                        <span className="capitalize">{role || 'member'}</span>
                      </span>
                      <ChevronsUpDown className="h-4 w-4 opacity-70" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>Account</DropdownMenuLabel>
                    <DropdownMenuItem disabled>
                      <BriefcaseBusiness className="h-4 w-4" />
                      <span className="capitalize">{role || 'member'}</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={onLogout}>
                      <LogOut className="h-4 w-4" />
                      Log out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {createWorkspaceOpen ? (
                <form className="grid w-full gap-3 rounded-[24px] border border-slate-200 bg-slate-50/80 p-4 shadow-sm sm:grid-cols-[minmax(0,1fr)_auto_auto]" onSubmit={handleCreateWorkspace}>
                  <Input
                    aria-label="Workspace name"
                    autoFocus
                    value={createWorkspaceName}
                    onChange={(event) => setCreateWorkspaceName(event.target.value)}
                    placeholder="Acme Dental"
                    disabled={createWorkspaceBusy}
                    required
                  />
                  <Button type="submit" variant="accent" disabled={createWorkspaceBusy || !createWorkspaceName.trim()}>
                    {createWorkspaceBusy ? 'Creating...' : 'Create workspace'}
                  </Button>
                  <Button type="button" variant="secondary" onClick={closeCreateWorkspace} disabled={createWorkspaceBusy}>
                    Cancel
                  </Button>
                </form>
              ) : null}

              {showDateRange && dateRange.mode === 'custom' ? (
                <div className="grid w-full gap-3 rounded-[24px] border border-slate-200 bg-slate-50/80 p-4 shadow-sm sm:grid-cols-[repeat(2,minmax(0,1fr))_auto]">
                  <Input type="date" value={customDraft.startDate} onChange={(event) => setCustomDraft((current) => ({ ...current, startDate: event.target.value }))} />
                  <Input type="date" value={customDraft.endDate} onChange={(event) => setCustomDraft((current) => ({ ...current, endDate: event.target.value }))} />
                  <Button type="button" variant="accent" onClick={applyCustomRange}>
                    Apply range
                  </Button>
                </div>
              ) : null}
            </div>
          </div>

          <Separator />

          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <nav className="flex flex-wrap gap-2">
              <SectionButton active={currentMode === 'portfolio'} label={PORTFOLIO_NAV.label} onClick={() => onNavigate('portfolio', PORTFOLIO_NAV.id)} />
              {APP_SECTIONS.map((item) => (
                <SectionButton
                  key={item.id}
                  active={currentMode === 'workspace' && currentSection === item.id}
                  label={item.label}
                  onClick={() => onNavigate('workspace', item.id)}
                />
              ))}
            </nav>
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-slate-400">
              <span>Workspace scope</span>
              <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              <span>Single reporting window</span>
            </div>
          </div>
        </div>
      </header>

      {notice ? (
        <div className="rounded-[24px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700 shadow-sm">
          {notice}
        </div>
      ) : null}
    </div>
  )
}

function SectionButton({ active, label, onClick }) {
  return (
    <button
      type="button"
      className={cn(
        'rounded-full border px-4 py-2 text-sm font-medium transition-colors',
        active
          ? 'border-slate-950 bg-slate-950 text-white shadow-sm'
          : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-white hover:text-slate-950',
      )}
      onClick={onClick}
    >
      {label}
    </button>
  )
}
