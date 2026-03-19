import { useEffect, useMemo, useState } from 'react'

import { AppShellHeader } from './components/AppShellHeader'
import { apiRequest } from './lib/api'
import { getDateRangeState, mergeDateRangeQuery } from './lib/dateRange'
import { navigate, parseRoute, portfolioPath, settingsPath, workspacePath } from './lib/router'
import { getOnboardingSteps, getReadinessFocus } from './lib/workspace'
import { AcceptInvitePage, ForgotPasswordPage, LoginPage, ResetPasswordPage, SignupPage } from './pages/AuthPages'
import { AdsPage } from './pages/AdsPage'
import { AuditPage } from './pages/AuditPage'
import { CompetitorsPage } from './pages/CompetitorsPage'
import { OnboardingPage } from './pages/OnboardingPage'
import { OrganizationSettingsPage } from './pages/OrganizationSettingsPage'
import { OverviewPage } from './pages/OverviewPage'
import { PortfolioPage } from './pages/PortfolioPage'
import { RankingsPage } from './pages/RankingsPage'
import { ReportsPage } from './pages/ReportsPage'
import { TeamSettingsPage } from './pages/TeamSettingsPage'
import { WorkspaceSetupPage } from './pages/WorkspaceSetupPage'

function App() {
  const [route, setRoute] = useState(() => parseRoute())
  const [authState, setAuthState] = useState({ loading: true, payload: null, connectionError: '' })
  const [notice, setNotice] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [inviteInfo, setInviteInfo] = useState(null)
  const [workspaceActionBusy, setWorkspaceActionBusy] = useState('')
  const [workspaceRefreshToken, setWorkspaceRefreshToken] = useState(0)

  const session = authState.payload
  const dateRange = useMemo(() => getDateRangeState(route.query), [route.query])
  const currentWorkspace = useMemo(() => {
    if (!session?.workspaces?.length) return null
    if (route.type === 'workspace') {
      return session.workspaces.find((workspace) => workspace.slug === route.workspaceSlug) || session.workspaces[0]
    }
    return session.workspaces[0]
  }, [route, session])

  useEffect(() => {
    const handlePopState = () => setRoute(parseRoute())
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => {
    let cancelled = false

    async function bootstrapAuth() {
      setAuthState((current) => ({ ...current, loading: true, connectionError: '' }))
      const result = await requestAuthSnapshot({ retryCount: 8, retryDelayMs: 350 })
      if (cancelled) return

      if (result.payload) {
        setAuthState({ loading: false, payload: result.payload, connectionError: '' })
        setNotice('')
        return
      }

      setAuthState({
        loading: false,
        payload: { authenticated: false, publicSignupEnabled: false },
        connectionError: result.error,
      })
      setNotice(result.error)
    }

    bootstrapAuth()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (authState.loading || authState.connectionError) return

    if (!session?.authenticated) {
      if (route.type === 'workspace' || route.type === 'portfolio' || route.type === 'settings' || route.type === 'onboarding' || route.type === 'root' || route.type === 'notFound') {
        navigate('/login', { replace: true })
      }
      return
    }

    const onboardingIncomplete = !(session.onboarding?.hasWorkspace && session.onboarding?.googleConnected && session.onboarding?.workspaceConfigured)
    const defaultPath = currentWorkspace ? workspacePath(currentWorkspace.slug, 'overview', dateRange.query) : '/onboarding'

    if (route.type === 'root' || route.type === 'login' || route.type === 'signup' || route.type === 'acceptInvite' || route.type === 'forgotPassword' || route.type === 'resetPassword' || route.type === 'notFound') {
      navigate(onboardingIncomplete ? '/onboarding' : defaultPath, { replace: true })
      return
    }

    if (route.type === 'workspace' && !currentWorkspace) {
      navigate(defaultPath, { replace: true })
      return
    }

    if (route.type === 'onboarding' && !onboardingIncomplete) {
      navigate(defaultPath, { replace: true })
    }
  }, [authState.connectionError, authState.loading, currentWorkspace, dateRange.query, route, session])

  async function refreshAuth(options = {}) {
    const {
      preserveOnFailure = Boolean(session?.authenticated),
      retryCount = 1,
      retryDelayMs = 0,
      showLoading = false,
    } = options

    if (showLoading) {
      setAuthState((current) => ({ ...current, loading: true, connectionError: '' }))
    }

    const result = await requestAuthSnapshot({ retryCount, retryDelayMs })
    if (result.payload) {
      setAuthState({ loading: false, payload: result.payload, connectionError: '' })
      setNotice('')
      return result.payload
    }

    if (preserveOnFailure && session?.authenticated) {
      setAuthState((current) => ({ ...current, loading: false, connectionError: result.error }))
    } else {
      setAuthState({
        loading: false,
        payload: { authenticated: false, publicSignupEnabled: false },
        connectionError: result.error,
      })
    }

    setNotice(result.error)
    return null
  }

  async function handleReconnect() {
    setNotice('')
    await refreshAuth({ retryCount: 8, retryDelayMs: 350, preserveOnFailure: false, showLoading: true })
  }

  async function handleAuthAction(path, body, redirectPath = null) {
    setAuthBusy(true)
    try {
      const payload = await apiRequest(path, { method: 'POST', body })
      if (payload?.authenticated) {
        setAuthState({ loading: false, payload, connectionError: '' })
        setNotice('')
      }
      if (redirectPath) navigate(redirectPath)
      return payload
    } catch (error) {
      setNotice(normalizeApiError(error))
      return null
    } finally {
      setAuthBusy(false)
    }
  }

  async function loadInvite(token) {
    if (!token) return
    try {
      setInviteInfo(await apiRequest(`/api/auth/invite/${token}`))
    } catch (error) {
      setNotice(normalizeApiError(error))
    }
  }

  async function requestReset(body) {
    const result = await handleAuthAction('/api/auth/password/request-reset', body)
    setNotice(result?.resetUrl ? `Reset preview: ${result.resetUrl}` : 'If the account exists, a reset link was created.')
  }

  async function resetPassword(body) {
    const result = await handleAuthAction('/api/auth/password/reset', body, '/login')
    if (result?.ok) setNotice('Password reset complete. Log in with the new password.')
  }

  async function logout() {
    await apiRequest('/api/auth/logout', { method: 'POST' }).catch(() => null)
    setAuthState({
      loading: false,
      payload: { authenticated: false, publicSignupEnabled: session?.publicSignupEnabled || false },
      connectionError: '',
    })
    navigate('/login')
  }

  function navigateWithinApp(mode, section) {
    if (mode === 'portfolio') {
      navigate(portfolioPath(route.query))
      return
    }
    if (mode === 'settings') {
      navigate(settingsPath(section, route.query))
      return
    }
    if (currentWorkspace) {
      navigate(workspacePath(currentWorkspace.slug, section, route.query))
    }
  }

  function handleWorkspaceChange(workspaceId) {
    const workspace = session?.workspaces?.find((item) => String(item.id) === String(workspaceId))
    if (!workspace) return
    navigate(workspacePath(workspace.slug, route.type === 'workspace' ? route.section : 'overview', route.query))
  }

  async function handleWorkspaceCreate(name) {
    const workspaceName = String(name || '').trim()
    if (!workspaceName) return false

    try {
      const created = await apiRequest('/api/workspaces', {
        method: 'POST',
        body: { name: workspaceName },
      })

      const refreshed = await refreshAuth({ retryCount: 3, retryDelayMs: 150 })
      const targetWorkspace = refreshed?.workspaces?.find((workspace) => String(workspace.id) === String(created.id))

      if (targetWorkspace) {
        navigate(workspacePath(targetWorkspace.slug, 'overview', route.query))
      } else if (created?.slug) {
        navigate(workspacePath(created.slug, 'overview', route.query))
      }

      setNotice(`Workspace "${workspaceName}" created.`)
      return true
    } catch (error) {
      setNotice(normalizeApiError(error))
      return false
    }
  }

  async function handleWorkspaceAction(actionId, request, successMessage) {
    if (!currentWorkspace || workspaceActionBusy) return false

    setWorkspaceActionBusy(actionId)
    try {
      await request()
      await refreshAuth({ retryCount: 2, retryDelayMs: 150 })
      setWorkspaceRefreshToken((current) => current + 1)
      setNotice(successMessage)
      return true
    } catch (error) {
      setNotice(normalizeApiError(error))
      return false
    } finally {
      setWorkspaceActionBusy('')
    }
  }

  async function handleRunWorkspaceSync(source) {
    if (!currentWorkspace) return false

    const actionId = source === 'rank' ? 'sync-rank' : 'sync-all'
    const actionLabel = source === 'rank' ? 'Rank sync' : 'Full sync'

    return handleWorkspaceAction(
      actionId,
      () => apiRequest(`/api/workspaces/${currentWorkspace.id}/jobs/run-sync`, {
        method: 'POST',
        body: { source },
      }),
      `${actionLabel} completed for ${currentWorkspace.name}.`,
    )
  }

  async function handleRunSiteAudit() {
    if (!currentWorkspace) return false

    return handleWorkspaceAction(
      'site-audit',
      () => apiRequest(`/api/workspaces/${currentWorkspace.id}/audit/run`, {
        method: 'POST',
        body: {},
      }),
      `Site audit completed for ${currentWorkspace.name}.`,
    )
  }

  function handleDateRangeChange(nextRange) {
    const nextQuery = mergeDateRangeQuery(route.query, nextRange)
    if (route.type === 'portfolio') {
      navigate(portfolioPath(nextQuery), { replace: true })
      return
    }
    if (!currentWorkspace || route.type !== 'workspace') return
    navigate(workspacePath(currentWorkspace.slug, route.section, nextQuery), { replace: true })
  }

  if (authState.loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-shell px-4">
        <div className="rounded-[32px] border border-white/70 bg-white/90 px-8 py-6 text-base font-medium text-slate-600 shadow-[0_24px_80px_-40px_rgba(15,23,42,0.55)] backdrop-blur">
          Loading agency workspace...
        </div>
      </div>
    )
  }

  if (authState.connectionError && !session?.authenticated) {
    return <ApiConnectionPage message={authState.connectionError} onRetry={handleReconnect} />
  }

  if (!session?.authenticated) {
    if (route.type === 'signup' && session.publicSignupEnabled) {
      return <SignupPage busy={authBusy} notice={notice} onNavigate={(path) => navigate(path)} onSignup={(body) => handleAuthAction('/api/auth/register', body)} />
    }
    if (route.type === 'acceptInvite') {
      return <AcceptInvitePage busy={authBusy} inviteInfo={inviteInfo} notice={notice} onAcceptInvite={(body) => handleAuthAction('/api/auth/accept-invite', body)} onLoadInvite={loadInvite} onNavigate={(path) => navigate(path)} token={route.query.token || ''} />
    }
    if (route.type === 'forgotPassword') {
      return <ForgotPasswordPage busy={authBusy} notice={notice} onNavigate={(path) => navigate(path)} onRequestReset={requestReset} />
    }
    if (route.type === 'resetPassword') {
      return <ResetPasswordPage busy={authBusy} notice={notice} onNavigate={(path) => navigate(path)} onResetPassword={resetPassword} token={route.query.token || ''} />
    }

    return <LoginPage busy={authBusy} notice={notice} onLogin={(body) => handleAuthAction('/api/auth/login', body)} onNavigate={(path) => navigate(path)} publicSignupEnabled={session.publicSignupEnabled} />
  }

  const onboardingSteps = getOnboardingSteps({
    googleConnected: session.onboarding?.googleConnected,
    workspaceSettings: {
      gsc_site_url: session.onboarding?.workspaceConfigured ? 'configured' : '',
      ga4_property_id: session.onboarding?.workspaceConfigured ? 'configured' : '',
      rank_domain: session.onboarding?.workspaceConfigured ? 'configured' : '',
    },
    keywordCount: currentWorkspace?.keywordCount || 0,
    competitorCount: currentWorkspace?.competitorCount || 0,
  })

  return (
    <div className="min-h-screen bg-shell">
      <div className="mx-auto w-full max-w-[1480px] px-3 pb-16 pt-4 sm:px-6">
        <AppShellHeader
          activeWorkspaceId={currentWorkspace?.id}
          canManageWorkspaces={['owner', 'admin'].includes(session.role)}
          currentMode={route.type === 'settings' ? 'settings' : route.type === 'portfolio' ? 'portfolio' : 'workspace'}
          currentSection={route.type === 'settings' ? route.section : route.section || 'overview'}
          dateRange={dateRange}
          notice={notice}
          onCreateWorkspace={handleWorkspaceCreate}
          onDateRangeChange={handleDateRangeChange}
          onLogout={logout}
          onNavigate={navigateWithinApp}
          onRunFullSync={() => handleRunWorkspaceSync('all')}
          onRunRankSync={() => handleRunWorkspaceSync('rank')}
          onRunSiteAudit={handleRunSiteAudit}
          onWorkspaceChange={handleWorkspaceChange}
          organizationName={session.organization?.name}
          role={session.role}
          runningWorkspaceAction={workspaceActionBusy}
          showDateRange={route.type === 'workspace' || route.type === 'portfolio'}
          showWorkspaceActions={Boolean(currentWorkspace)}
          workspaces={session.workspaces || []}
        />

        <main className="mt-6 space-y-6">
          {route.type === 'onboarding' ? (
            <OnboardingPage
              focus={getReadinessFocus(onboardingSteps)}
              onOpenOrganization={() => navigate(settingsPath('organization', route.query))}
              onOpenWorkspace={() => currentWorkspace && navigate(workspacePath(currentWorkspace.slug, 'setup', dateRange.query))}
              steps={onboardingSteps}
            />
          ) : null}

          {route.type === 'portfolio' ? (
            <PortfolioPage
              dateRange={dateRange}
              onOpenWorkspace={(workspaceSlug, section = 'overview') => navigate(workspacePath(workspaceSlug, section, route.query))}
              onSetNotice={setNotice}
            />
          ) : null}

          {route.type === 'workspace' && currentWorkspace ? (
            <div key={`${currentWorkspace.id}:${route.section}:${workspaceRefreshToken}`}>
              {renderWorkspacePage(route.section, {
                dateRange,
                googleConnected: session.onboarding?.googleConnected,
                onOpenOrganizationSettings: () => navigate(settingsPath('organization', route.query)),
                onOpenReports: () => navigate(workspacePath(currentWorkspace.slug, 'reports', route.query)),
                onOpenSetup: () => navigate(workspacePath(currentWorkspace.slug, 'setup', route.query)),
                onRefreshAuth: refreshAuth,
                onSetNotice: setNotice,
                workspace: currentWorkspace,
              })}
            </div>
          ) : null}

          {route.type === 'settings' ? (
            route.section === 'organization'
              ? <OrganizationSettingsPage onRefreshAuth={refreshAuth} onSetNotice={setNotice} />
              : <TeamSettingsPage onRefreshAuth={refreshAuth} onSetNotice={setNotice} workspaces={session.workspaces || []} />
          ) : null}
        </main>
      </div>
    </div>
  )
}

function renderWorkspacePage(section, props) {
  if (section === 'setup') {
    return (
      <WorkspaceSetupPage
        googleConnected={props.googleConnected}
        onOpenOrganizationSettings={props.onOpenOrganizationSettings}
        onRefreshAuth={props.onRefreshAuth}
        onSetNotice={props.onSetNotice}
        workspace={props.workspace}
      />
    )
  }
  if (section === 'overview') {
    return (
      <OverviewPage
        dateRange={props.dateRange}
        googleConnected={props.googleConnected}
        onOpenOrganizationSettings={props.onOpenOrganizationSettings}
        onOpenReports={props.onOpenReports}
        onOpenSetup={props.onOpenSetup}
        onRefreshAuth={props.onRefreshAuth}
        onSetNotice={props.onSetNotice}
        workspace={props.workspace}
      />
    )
  }
  if (section === 'rankings') return <RankingsPage dateRange={props.dateRange} onOpenSetup={props.onOpenSetup} onRefreshAuth={props.onRefreshAuth} onSetNotice={props.onSetNotice} workspace={props.workspace} />
  if (section === 'audit') return <AuditPage googleConnected={props.googleConnected} onOpenSetup={props.onOpenSetup} onRefreshAuth={props.onRefreshAuth} onSetNotice={props.onSetNotice} workspace={props.workspace} />
  if (section === 'competitors') return <CompetitorsPage onRefreshAuth={props.onRefreshAuth} onSetNotice={props.onSetNotice} workspace={props.workspace} />
  if (section === 'reports') return <ReportsPage dateRange={props.dateRange} onRefreshAuth={props.onRefreshAuth} onSetNotice={props.onSetNotice} workspace={props.workspace} />
  if (section === 'ads') return <AdsPage dateRange={props.dateRange} onSetNotice={props.onSetNotice} workspace={props.workspace} />
  return null
}

function ApiConnectionPage({ message, onRetry }) {
  return (
    <section className="grid min-h-screen place-items-center bg-shell px-4">
      <div className="w-full max-w-xl rounded-[32px] border border-white/70 bg-white/90 p-8 shadow-[0_24px_80px_-40px_rgba(15,23,42,0.55)] backdrop-blur">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Agency SaaS Beta</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">Waiting for API</h1>
        <p className="mt-3 text-sm leading-7 text-slate-500">The frontend is up, but the API was not reachable yet. This usually happens during local startup.</p>
        <div className="mt-6 rounded-[24px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">{message}</div>
        <button type="button" className="mt-6 inline-flex rounded-full bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800" onClick={onRetry}>Retry connection</button>
      </div>
    </section>
  )
}

async function requestAuthSnapshot({ retryCount = 1, retryDelayMs = 0 } = {}) {
  let lastError = null

  for (let attempt = 1; attempt <= retryCount; attempt += 1) {
    try {
      return { payload: await apiRequest('/api/auth/me'), error: '' }
    } catch (error) {
      lastError = error
      if (attempt < retryCount) {
        await wait(retryDelayMs)
      }
    }
  }

  return { payload: null, error: normalizeApiError(lastError) }
}

function normalizeApiError(error) {
  if (!error?.message || error.message === 'Failed to fetch') {
    return 'The API is not reachable yet. Retry in a moment.'
  }

  return error.message
}

function wait(duration) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, duration)
  })
}

export default App
