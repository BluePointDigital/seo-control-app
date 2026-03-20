import { useEffect, useMemo, useRef, useState } from 'react'

import { LineChart } from '../components/LineChart'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Select } from '../components/ui/select'
import { PageIntro, SectionHeading, StatusPill } from '../components/ui/surface'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { Textarea } from '../components/ui/textarea'
import { apiRequest, buildApiPath } from '../lib/api'

function createEmptyInsights() {
  return {
    moversUp: [],
    moversDown: [],
    trendRows: [],
    visibilityScore: 0,
    trackedKeywords: 0,
    rankedKeywords: 0,
    top10Keywords: 0,
    top3Keywords: 0,
    top1Keywords: 0,
    latestDate: null,
    prevDate: null,
    narrative: '',
  }
}

function createEmptySummary(label = '') {
  return {
    items: [],
    insights: createEmptyInsights(),
    range: { label },
    profiles: [],
  }
}

function ensureRankSummary(summary, label = '') {
  const organic = summary || {}
  const mapPack = organic.mapPack || {}
  return {
    ...createEmptySummary(label),
    ...organic,
    insights: { ...createEmptyInsights(), ...(organic.insights || {}) },
    range: { label, ...(organic.range || {}) },
    profiles: organic.profiles || [],
    mapPack: {
      ...createEmptySummary(label),
      ...mapPack,
      insights: { ...createEmptyInsights(), ...(mapPack.insights || {}) },
      range: { label, ...(mapPack.range || {}) },
      profiles: mapPack.profiles || [],
    },
  }
}

const EMPTY_PROFILE_FORM = {
  name: '',
  locationLabel: '',
  searchLocationId: '',
  searchLocationName: '',
  businessName: '',
  gl: 'us',
  hl: 'en',
  active: true,
}
const EMPTY_KEYWORD_FORM = { keyword: '', landingPage: '', intent: '', priority: 'medium' }

export function RankingsPage({ dateRange, onOpenSetup, onRefreshAuth, onSetNotice, workspace }) {
  const [config, setConfig] = useState({
    domain: '',
    gl: 'us',
    hl: 'en',
    frequency: 'weekly',
    weekday: 1,
    hour: 6,
    lastStatus: 'idle',
    lastCompletedAt: null,
    lastError: '',
  })
  const [profiles, setProfiles] = useState([])
  const [selectedProfileId, setSelectedProfileId] = useState(null)
  const [profileForm, setProfileForm] = useState(EMPTY_PROFILE_FORM)
  const [newProfile, setNewProfile] = useState(EMPTY_PROFILE_FORM)
  const [keywords, setKeywords] = useState([])
  const [keywordForm, setKeywordForm] = useState(EMPTY_KEYWORD_FORM)
  const [bulkText, setBulkText] = useState('')
  const [summary, setSummary] = useState(ensureRankSummary(null, dateRange.label))
  const [profileSummary, setProfileSummary] = useState(ensureRankSummary(null, dateRange.label))
  const [alerts, setAlerts] = useState([])
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingKeyword, setSavingKeyword] = useState(false)
  const [runningSync, setRunningSync] = useState(false)
  const [rankView, setRankView] = useState('organic')
  const rangeKey = JSON.stringify(dateRange.query)

  const activeSummary = rankView === 'mapPack' ? summary.mapPack || createEmptySummary(dateRange.label) : summary
  const activeProfileSummary = rankView === 'mapPack' ? profileSummary.mapPack || createEmptySummary(dateRange.label) : profileSummary

  const selectedProfile = useMemo(
    () => profiles.find((profile) => String(profile.id) === String(selectedProfileId)) || profiles[0] || null,
    [profiles, selectedProfileId],
  )

  const aggregateRows = useMemo(
    () => [...(activeSummary.items || [])].sort(compareRankRows),
    [activeSummary.items],
  )

  const selectedProfileRows = useMemo(
    () => [...(activeProfileSummary.items || [])].sort(compareRankRows),
    [activeProfileSummary.items],
  )

  useEffect(() => {
    let cancelled = false

    async function loadAggregate() {
      const [configJson, profilesJson, summaryJson] = await Promise.all([
        apiRequest(`/api/workspaces/${workspace.id}/rank/config`),
        apiRequest(`/api/workspaces/${workspace.id}/rank/profiles`),
        apiRequest(buildApiPath(`/api/workspaces/${workspace.id}/rank/summary`, dateRange.query)),
      ])

      if (cancelled) return

      setConfig({
        domain: configJson.domain || '',
        gl: configJson.gl || 'us',
        hl: configJson.hl || 'en',
        frequency: configJson.frequency || 'weekly',
        weekday: Number(configJson.weekday || 1),
        hour: Number(configJson.hour || 6),
        lastStatus: configJson.lastStatus || 'idle',
        lastCompletedAt: configJson.lastCompletedAt || null,
        lastError: configJson.lastError || '',
      })

      const normalizedSummary = ensureRankSummary(summaryJson, dateRange.label)
      const nextProfiles = profilesJson.items || []
      setProfiles(decorateProfiles(nextProfiles, normalizedSummary))
      setSummary(normalizedSummary)

      if (!nextProfiles.length) {
        setSelectedProfileId(null)
        setProfileForm(EMPTY_PROFILE_FORM)
        return
      }

      const activeProfile = nextProfiles.find((profile) => String(profile.id) === String(selectedProfileId)) || nextProfiles[0]
      setSelectedProfileId(activeProfile.id)
      setProfileForm({
        name: activeProfile.name,
        locationLabel: activeProfile.locationLabel || '',
        searchLocationId: activeProfile.searchLocationId || '',
        searchLocationName: activeProfile.searchLocationName || '',
        businessName: activeProfile.businessName || activeProfile.name || '',
        gl: activeProfile.gl || 'us',
        hl: activeProfile.hl || 'en',
        active: activeProfile.active,
      })
    }

    loadAggregate().catch((error) => onSetNotice(error.message))

    return () => {
      cancelled = true
    }
  }, [dateRange.label, dateRange.query, onSetNotice, rangeKey, selectedProfileId, workspace.id])

  useEffect(() => {
    if (!selectedProfile) {
      setKeywords([])
      setAlerts([])
      setProfileSummary(ensureRankSummary(null, dateRange.label))
      return
    }

    let cancelled = false

    Promise.all([
      apiRequest(`/api/workspaces/${workspace.id}/rank/profiles/${selectedProfile.id}/keywords`),
      apiRequest(buildApiPath(`/api/workspaces/${workspace.id}/rank/summary`, { ...dateRange.query, profileId: selectedProfile.id })),
      apiRequest(`/api/workspaces/${workspace.id}/alerts?status=open&profileId=${selectedProfile.id}&limit=8`),
    ]).then(([keywordsJson, profileSummaryJson, alertsJson]) => {
      if (cancelled) return

      setKeywords(keywordsJson.items || [])
      setProfileSummary(ensureRankSummary(profileSummaryJson, dateRange.label))
      setAlerts(alertsJson.items || [])
      setProfileForm({
        name: selectedProfile.name,
        locationLabel: selectedProfile.locationLabel || '',
        searchLocationId: selectedProfile.searchLocationId || '',
        searchLocationName: selectedProfile.searchLocationName || '',
        businessName: selectedProfile.businessName || selectedProfile.name || '',
        gl: selectedProfile.gl || 'us',
        hl: selectedProfile.hl || 'en',
        active: selectedProfile.active,
      })
    }).catch((error) => onSetNotice(error.message))

    return () => {
      cancelled = true
    }
  }, [dateRange.label, dateRange.query, onSetNotice, rangeKey, selectedProfile, workspace.id])

  async function reloadAfterRankChange(nextProfileId = selectedProfile?.id) {
    const [configJson, profilesJson, summaryJson] = await Promise.all([
      apiRequest(`/api/workspaces/${workspace.id}/rank/config`),
      apiRequest(`/api/workspaces/${workspace.id}/rank/profiles`),
      apiRequest(buildApiPath(`/api/workspaces/${workspace.id}/rank/summary`, dateRange.query)),
    ])

    const normalizedSummary = ensureRankSummary(summaryJson, dateRange.label)
    setConfig((current) => ({
      ...current,
      domain: configJson.domain || current.domain,
      gl: configJson.gl || current.gl,
      hl: configJson.hl || current.hl,
      frequency: configJson.frequency || current.frequency,
      weekday: Number(configJson.weekday || current.weekday),
      hour: Number(configJson.hour || current.hour),
      lastStatus: configJson.lastStatus || 'idle',
      lastCompletedAt: configJson.lastCompletedAt || null,
      lastError: configJson.lastError || '',
    }))
    setProfiles(decorateProfiles(profilesJson.items || [], normalizedSummary))
    setSummary(normalizedSummary)
    if (nextProfileId != null) setSelectedProfileId(nextProfileId)
    await onRefreshAuth()
  }
  async function createProfile(event) {
    event.preventDefault()
    setSavingProfile(true)
    try {
      const result = await apiRequest(`/api/workspaces/${workspace.id}/rank/profiles`, { method: 'POST', body: newProfile })
      setNewProfile(EMPTY_PROFILE_FORM)
      await reloadAfterRankChange(result.item?.id)
      onSetNotice('Rank profile created.')
    } catch (error) {
      onSetNotice(error.message)
    } finally {
      setSavingProfile(false)
    }
  }

  async function updateSelectedProfile(event) {
    event.preventDefault()
    if (!selectedProfile) return
    setSavingProfile(true)
    try {
      await apiRequest(`/api/workspaces/${workspace.id}/rank/profiles/${selectedProfile.id}`, { method: 'PATCH', body: profileForm })
      await reloadAfterRankChange(selectedProfile.id)
      onSetNotice('Selected profile updated.')
    } catch (error) {
      onSetNotice(error.message)
    } finally {
      setSavingProfile(false)
    }
  }

  async function deleteSelectedProfile() {
    if (!selectedProfile) return
    if (profiles.length <= 1) {
      onSetNotice('At least one rank profile must remain.')
      return
    }

    try {
      await apiRequest(`/api/workspaces/${workspace.id}/rank/profiles/${selectedProfile.id}`, { method: 'DELETE' })
      const fallbackProfile = profiles.find((profile) => profile.id !== selectedProfile.id)
      await reloadAfterRankChange(fallbackProfile?.id || null)
      onSetNotice('Selected profile deleted.')
    } catch (error) {
      onSetNotice(error.message)
    }
  }

  async function addKeyword(event) {
    event.preventDefault()
    if (!selectedProfile) return
    setSavingKeyword(true)
    try {
      await apiRequest(`/api/workspaces/${workspace.id}/rank/profiles/${selectedProfile.id}/keywords`, {
        method: 'POST',
        body: keywordForm,
      })
      setKeywordForm(EMPTY_KEYWORD_FORM)
      await reloadAfterRankChange(selectedProfile.id)
      onSetNotice('Keyword saved.')
    } catch (error) {
      onSetNotice(error.message)
    } finally {
      setSavingKeyword(false)
    }
  }

  async function bulkAddKeywords(event) {
    event.preventDefault()
    if (!selectedProfile) return

    const items = bulkText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [keyword, landingPage] = line.split('|').map((part) => part.trim())
        return {
          keyword,
          landingPage: landingPage || '',
          priority: 'medium',
        }
      })

    if (!items.length) return

    setSavingKeyword(true)
    try {
      await apiRequest(`/api/workspaces/${workspace.id}/rank/keywords/bulk`, {
        method: 'POST',
        body: { profileId: selectedProfile.id, items },
      })
      setBulkText('')
      await reloadAfterRankChange(selectedProfile.id)
      onSetNotice(`Added ${items.length} keywords.`)
    } catch (error) {
      onSetNotice(error.message)
    } finally {
      setSavingKeyword(false)
    }
  }

  async function removeKeyword(keywordId) {
    try {
      await apiRequest(`/api/workspaces/${workspace.id}/rank/keywords/${keywordId}`, { method: 'DELETE' })
      await reloadAfterRankChange(selectedProfile?.id || null)
    } catch (error) {
      onSetNotice(error.message)
    }
  }

  async function runRankSync(profileId = null) {
    setRunningSync(true)
    try {
      await apiRequest(`/api/workspaces/${workspace.id}/jobs/run-sync`, {
        method: 'POST',
        body: { source: 'rank', profileId },
      })
      await reloadAfterRankChange(profileId || selectedProfile?.id || null)
      onSetNotice(profileId ? 'Profile rank sync finished.' : 'Workspace rank sync finished.')
    } catch (error) {
      onSetNotice(error.message)
    } finally {
      setRunningSync(false)
    }
  }

  const aggregateInsights = activeSummary.insights || createEmptyInsights()
  const profileInsights = activeProfileSummary.insights || createEmptyInsights()
  const trendSeries = rankView === 'mapPack'
    ? [
        { key: 'top1', label: 'Top 1', color: '#059669' },
        { key: 'top3', label: 'Top 3', color: '#0284c7' },
        { key: 'ranked', label: 'In pack', color: '#ca8a04' },
        { key: 'notRanked', label: 'Not in pack', color: '#dc2626' },
      ]
    : [
        { key: 'top3', label: 'Top 3', color: '#059669' },
        { key: 'top10', label: 'Top 10', color: '#0284c7' },
        { key: 'notRanked', label: 'Not ranked', color: '#dc2626' },
      ]

  return (
    <div className="space-y-6">
      <PageIntro
        badge="Rankings"
        title="Rank command center"
        description="Review workspace movement first, then manage profile structure and keywords in focused tabs instead of one long page."
        actions={<Button type="button" variant="secondary" onClick={onOpenSetup}>Open setup</Button>}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_360px]">
        <Card>
          <CardHeader>
            <SectionHeading
              title={rankView === 'mapPack' ? 'Workspace map pack performance' : 'Workspace organic performance'}
              description={aggregateInsights.narrative || 'Run rank sync to collect the first baseline.'}
              action={<Badge variant="neutral">{activeSummary.range?.label || dateRange.label}</Badge>}
            />
          </CardHeader>
          <CardContent className="space-y-6">
            <Tabs value={rankView} onValueChange={setRankView}>
              <TabsList>
                <TabsTrigger value="organic">Organic</TabsTrigger>
                <TabsTrigger value="mapPack">Map pack</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <MetricTile label={rankView === 'mapPack' ? 'Map visibility' : 'Visibility score'} value={aggregateInsights.visibilityScore || 0} tone="accent" />
              <MetricTile label="Tracked keywords" value={aggregateInsights.trackedKeywords || 0} />
              <MetricTile label={rankView === 'mapPack' ? 'Ranked in pack' : 'Ranked keywords'} value={aggregateInsights.rankedKeywords || 0} />
              <MetricTile label={rankView === 'mapPack' ? 'Top 3 pack' : 'Top 10 keywords'} value={rankView === 'mapPack' ? (aggregateInsights.top3Keywords || 0) : (aggregateInsights.top10Keywords || 0)} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <MetricTile label="Rank domain" value={config.domain || 'Not set'} tone="subtle" />
              <MetricTile label="Status" value={humanizeStatus(config.lastStatus)} tone={statusTone(config.lastStatus)} />
              <MetricTile label="Last scan" value={formatDateTime(config.lastCompletedAt) || 'Not yet run'} tone="subtle" />
              <MetricTile label="Schedule" value={formatSchedule(config)} tone="subtle" />
            </div>
            {config.lastError ? (
              <div className="rounded-[20px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-700">
                {config.lastError}
              </div>
            ) : null}
            <LineChart rows={aggregateInsights.trendRows || []} series={trendSeries} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Profiles at a glance</CardTitle>
            <CardDescription>Select a market profile without losing the workspace picture.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {profiles.map((profile) => (
              <button
                key={profile.id}
                type="button"
                className={`w-full rounded-[24px] border px-4 py-4 text-left transition-colors ${
                  selectedProfile?.id === profile.id
                    ? 'border-slate-950 bg-slate-950 text-white shadow-sm'
                    : 'border-slate-200 bg-slate-50/70 text-slate-700 hover:border-slate-300 hover:bg-white'
                }`}
                onClick={() => setSelectedProfileId(profile.id)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{profile.name}</p>
                    <p className={`mt-1 text-sm ${selectedProfile?.id === profile.id ? 'text-slate-300' : 'text-slate-500'}`}>
                      {profile.locationLabel || profile.searchLocationName || 'Primary market'}
                    </p>
                  </div>
                  <StatusPill tone={profile.active ? 'success' : 'warning'} value={profile.active ? 'Active' : 'Paused'} />
                </div>
                <div className={`mt-4 grid gap-2 text-xs uppercase tracking-[0.12em] ${selectedProfile?.id === profile.id ? 'text-slate-300' : 'text-slate-400'}`}>
                  <span>{profile.keywordCount} keywords</span>
                  <span>{profile.openAlertCount} alerts</span>
                  <span>{rankView === 'mapPack' ? 'Map visibility' : 'Visibility'} {rankView === 'mapPack' ? (profile.mapPackVisibilityScore || 0) : (profile.visibilityScore || 0)}</span>
                </div>
              </button>
            ))}
            {!profiles.length ? <p className="text-sm text-slate-500">No profiles yet.</p> : null}
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="results">
        <TabsList>
          <TabsTrigger value="results">Results</TabsTrigger>
          <TabsTrigger value="profiles">Profiles</TabsTrigger>
          <TabsTrigger value="keywords">Keywords</TabsTrigger>
        </TabsList>

        <TabsContent value="results">
          <Card>
            <CardHeader>
              <SectionHeading
                title={rankView === 'mapPack' ? 'Current map pack results' : 'Current rankings'}
                description={rankView === 'mapPack' ? 'Every tracked keyword in this workspace, sorted by current map pack position.' : 'Every tracked keyword in this workspace, sorted by current position.'}
                action={selectedProfile ? (
                  <Button type="button" variant="secondary" onClick={() => runRankSync(selectedProfile.id)} disabled={runningSync}>
                    {runningSync ? 'Syncing profile...' : 'Sync selected profile'}
                  </Button>
                ) : null}
              />
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-slate-500">Change since last scan: {aggregateInsights.prevDate ? aggregateInsights.prevDate : 'first baseline'}</p>
              <RankingsTable rows={aggregateRows} hasBaseline={Boolean(aggregateInsights.prevDate)} showProfile resultType={rankView} />
            </CardContent>
          </Card>
          <div className="mt-6 space-y-6">
            <Card>
              <CardHeader>
                <SectionHeading
                  title={selectedProfile ? `${selectedProfile.name} detail` : 'Profile detail'}
                  description={profileInsights.narrative || 'Select a profile to review its movement and keyword set.'}
                  action={selectedProfile ? <Badge variant="neutral">{activeProfileSummary.range?.label || dateRange.label}</Badge> : null}
                />
              </CardHeader>
              <CardContent className="space-y-6">
                {selectedProfile ? (
                  <>
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                      <MetricTile label={rankView === 'mapPack' ? 'Map visibility' : 'Profile visibility'} value={profileInsights.visibilityScore || 0} tone="accent" />
                      <MetricTile label="Tracked" value={profileInsights.trackedKeywords || 0} />
                      <MetricTile label={rankView === 'mapPack' ? 'Top 3 pack' : 'Top 10'} value={rankView === 'mapPack' ? (profileInsights.top3Keywords || 0) : (profileInsights.top10Keywords || 0)} />
                      <MetricTile label="Open alerts" value={alerts.length} tone={alerts.length ? 'warning' : 'subtle'} />
                    </div>
                    <LineChart rows={profileInsights.trendRows || []} series={trendSeries} />
                    <div className="space-y-4">
                      <SectionHeading
                        title={rankView === 'mapPack' ? 'Selected profile map pack' : 'Selected profile rankings'}
                        description={rankView === 'mapPack' ? 'Current local-pack positions and matched listings for this profile.' : 'Current positions, last-scan change, and ranked URLs for this profile.'}
                      />
                      <RankingsTable rows={selectedProfileRows} hasBaseline={Boolean(profileInsights.prevDate)} showProfile={false} resultType={rankView} />
                    </div>
                    <div className="grid gap-3">
                      <p className="text-sm font-semibold text-slate-950">Recent profile alerts</p>
                      {alerts.length ? alerts.map((alert) => (
                        <div key={alert.id} className="rounded-[22px] border border-slate-200 bg-slate-50/70 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="font-semibold text-slate-950">{alert.title}</p>
                              <p className="mt-1 text-sm leading-6 text-slate-500">{alert.message}</p>
                            </div>
                            <Badge variant={alert.severity === 'high' ? 'danger' : alert.severity === 'medium' ? 'warning' : 'neutral'}>
                              {alert.severity}
                            </Badge>
                          </div>
                        </div>
                      )) : <p className="text-sm text-slate-500">No open alerts for this profile.</p>}
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-slate-500">Create or select a rank profile to see profile-specific results.</p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="profiles">
          <div className="grid gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>{selectedProfile ? 'Selected profile' : 'No profile selected'}</CardTitle>
                <CardDescription>Profiles are for market, service, or location-specific baselines.</CardDescription>
              </CardHeader>
              <CardContent>
                {selectedProfile ? (
                  <form className="space-y-4" onSubmit={updateSelectedProfile}>
                    <Field label="Profile name">
                      <Input value={profileForm.name} onChange={(event) => setProfileForm((current) => ({ ...current, name: event.target.value }))} />
                    </Field>
                    <Field label="Search location">
                      <LocationLookupField
                        key={`selected-${selectedProfile.id}`}
                        workspaceId={workspace.id}
                        value={profileForm.searchLocationName}
                        onSetNotice={onSetNotice}
                        onChange={(value) => setProfileForm((current) => ({ ...current, searchLocationName: value, searchLocationId: '' }))}
                        onSelect={(item) => setProfileForm((current) => ({
                          ...current,
                          searchLocationId: item.id,
                          searchLocationName: item.canonicalName || item.name,
                          gl: item.countryCode ? mapCountryCodeToCode(item.countryCode) : current.gl,
                        }))}
                        placeholder="Search for a city or market"
                      />
                    </Field>
                    <Field label="Display label">
                      <Input value={profileForm.locationLabel} onChange={(event) => setProfileForm((current) => ({ ...current, locationLabel: event.target.value }))} />
                    </Field>
                    <Field label="Business name">
                      <Input value={profileForm.businessName} onChange={(event) => setProfileForm((current) => ({ ...current, businessName: event.target.value }))} placeholder="Precision Garage Door Service" required />
                    </Field>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Country">
                        <Input value={profileForm.gl} onChange={(event) => setProfileForm((current) => ({ ...current, gl: event.target.value.toLowerCase() }))} placeholder="us" maxLength={10} />
                      </Field>
                      <Field label="Language">
                        <Input value={profileForm.hl} onChange={(event) => setProfileForm((current) => ({ ...current, hl: event.target.value.toLowerCase() }))} placeholder="en" maxLength={10} />
                      </Field>
                    </div>
                    <label className="flex items-center gap-3 text-sm text-slate-600">
                      <input type="checkbox" checked={Boolean(profileForm.active)} onChange={(event) => setProfileForm((current) => ({ ...current, active: event.target.checked }))} />
                      Active profile
                    </label>
                    <div className="flex flex-wrap gap-3">
                      <Button type="submit" disabled={savingProfile}>{savingProfile ? 'Saving...' : 'Save profile'}</Button>
                      <Button type="button" variant="danger" onClick={deleteSelectedProfile}>Delete profile</Button>
                    </div>
                  </form>
                ) : (
                  <p className="text-sm text-slate-500">Select a profile from the right rail first.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Create profile</CardTitle>
                <CardDescription>Use separate profiles for cities, services, or market clusters that need their own baseline.</CardDescription>
              </CardHeader>
              <CardContent>
                <form className="space-y-4" onSubmit={createProfile}>
                  <Field label="Profile name">
                    <Input value={newProfile.name} onChange={(event) => setNewProfile((current) => ({ ...current, name: event.target.value }))} placeholder="Spartanburg Repair" />
                  </Field>
                  <Field label="Search location">
                    <LocationLookupField
                      workspaceId={workspace.id}
                      value={newProfile.searchLocationName}
                      onSetNotice={onSetNotice}
                      onChange={(value) => setNewProfile((current) => ({ ...current, searchLocationName: value, searchLocationId: '' }))}
                      onSelect={(item) => setNewProfile((current) => ({
                        ...current,
                        searchLocationId: item.id,
                        searchLocationName: item.canonicalName || item.name,
                        gl: item.countryCode ? mapCountryCodeToCode(item.countryCode) : current.gl,
                      }))}
                      placeholder="Search for a city or market"
                    />
                  </Field>
                  <Field label="Display label">
                    <Input value={newProfile.locationLabel} onChange={(event) => setNewProfile((current) => ({ ...current, locationLabel: event.target.value }))} placeholder="Spartanburg, SC" />
                  </Field>
                  <Field label="Business name">
                    <Input value={newProfile.businessName} onChange={(event) => setNewProfile((current) => ({ ...current, businessName: event.target.value }))} placeholder="Precision Garage Door Service" required />
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Country">
                      <Input value={newProfile.gl} onChange={(event) => setNewProfile((current) => ({ ...current, gl: event.target.value.toLowerCase() }))} placeholder="us" maxLength={10} />
                    </Field>
                    <Field label="Language">
                      <Input value={newProfile.hl} onChange={(event) => setNewProfile((current) => ({ ...current, hl: event.target.value.toLowerCase() }))} placeholder="en" maxLength={10} />
                    </Field>
                  </div>
                  <Button type="submit" disabled={savingProfile}>{savingProfile ? 'Saving...' : 'Create profile'}</Button>
                </form>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="keywords">
          <Card>
            <CardHeader>
              <CardTitle>Keyword management</CardTitle>
              <CardDescription>{selectedProfile ? `Add and maintain tracked keywords for ${selectedProfile.name}.` : 'Select a profile before adding keywords.'}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {selectedProfile ? (
                <>
                  <div className="grid gap-6 xl:grid-cols-2">
                    <form className="space-y-4" onSubmit={addKeyword}>
                      <Field label="Keyword">
                        <Input value={keywordForm.keyword} onChange={(event) => setKeywordForm((current) => ({ ...current, keyword: event.target.value }))} placeholder="garage door repair spartanburg sc" />
                      </Field>
                      <Field label="Landing page hint">
                        <Input value={keywordForm.landingPage} onChange={(event) => setKeywordForm((current) => ({ ...current, landingPage: event.target.value }))} placeholder="https://www.client.com/service-area/" />
                      </Field>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field label="Intent">
                          <Input value={keywordForm.intent} onChange={(event) => setKeywordForm((current) => ({ ...current, intent: event.target.value }))} placeholder="repair" />
                        </Field>
                        <Field label="Priority">
                          <Select value={keywordForm.priority} onChange={(event) => setKeywordForm((current) => ({ ...current, priority: event.target.value }))}>
                            <option value="high">High</option>
                            <option value="medium">Medium</option>
                            <option value="low">Low</option>
                          </Select>
                        </Field>
                      </div>
                      <Button type="submit" disabled={savingKeyword}>{savingKeyword ? 'Saving...' : 'Add keyword'}</Button>
                    </form>

                    <form className="space-y-4" onSubmit={bulkAddKeywords}>
                      <Field label="Bulk add keywords">
                        <Textarea
                          rows="7"
                          value={bulkText}
                          onChange={(event) => setBulkText(event.target.value)}
                          placeholder={[
                            'garage door repair spartanburg sc|https://www.client.com/service-area/spartanburg/',
                            'commercial garage doors upstate sc|https://www.client.com/commercial-garage-doors/',
                          ].join('\n')}
                        />
                      </Field>
                      <Button type="submit" variant="secondary" disabled={savingKeyword}>{savingKeyword ? 'Saving...' : 'Bulk add keywords'}</Button>
                    </form>
                  </div>

                  <div className="space-y-4">
                    <SectionHeading
                      title="Tracked keyword list"
                      description="Landing-page hints and priorities stay attached to each keyword in the selected profile."
                    />
                    <div className="grid gap-3">
                      {keywords.map((item) => (
                        <div key={item.id} className="flex flex-col gap-4 rounded-[24px] border border-slate-200 bg-slate-50/70 px-4 py-4 md:flex-row md:items-start md:justify-between">
                          <div>
                            <p className="font-semibold text-slate-950">{item.keyword}</p>
                            <p className="mt-1 text-sm leading-6 text-slate-500">
                              {item.landingPage || 'No landing-page hint'}
                              {item.intent ? ` / ${item.intent}` : ''}
                              {item.priority ? ` / ${item.priority}` : ''}
                            </p>
                          </div>
                          <Button type="button" variant="secondary" size="sm" onClick={() => removeKeyword(item.id)}>Remove</Button>
                        </div>
                      ))}
                      {!keywords.length ? <p className="text-sm text-slate-500">No tracked keywords yet for this profile.</p> : null}
                    </div>
                  </div>
                </>
              ) : (
                <p className="text-sm text-slate-500">Select a profile to add and manage keywords.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function RankingsTable({ rows, hasBaseline, showProfile, resultType = 'organic' }) {
  return (
    <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-left">
          <thead className="bg-slate-50">
            <tr className="text-xs uppercase tracking-[0.14em] text-slate-400">
              <th className="px-4 py-3 font-semibold">Keyword</th>
              {showProfile ? <th className="px-4 py-3 font-semibold">Profile</th> : null}
              <th className="px-4 py-3 font-semibold">Position</th>
              <th className="px-4 py-3 font-semibold">Change</th>
              <th className="px-4 py-3 font-semibold">Last scan</th>
              <th className="px-4 py-3 font-semibold">{resultType === 'mapPack' ? 'Matched listing' : 'Ranked URL'}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 text-sm text-slate-600">
            {rows.length ? rows.map((row) => (
              <tr key={`${row.profileId || 'workspace'}-${row.keyword}`} className="align-top">
                <td className="px-4 py-4 font-semibold text-slate-950">{row.keyword}</td>
                {showProfile ? <td className="px-4 py-4">{row.profileName || 'Workspace'}</td> : null}
                <td className="px-4 py-4">{formatPosition(row.position)}</td>
                <td className="px-4 py-4"><span className={changeClassName(row.delta, hasBaseline)}>{formatChange(row.delta, hasBaseline)}</span></td>
                <td className="px-4 py-4">{row.date || '-'}</td>
                <td className="px-4 py-4">
                  {resultType === 'mapPack' ? (
                    row.foundName || row.foundUrl ? (
                      <div className="grid gap-1">
                        {row.foundName ? <strong className="text-slate-950">{row.foundName}</strong> : null}
                        {row.foundUrl ? <a className="text-emerald-700 hover:text-emerald-600" href={row.foundUrl} target="_blank" rel="noreferrer">{shortenUrl(row.foundUrl)}</a> : null}
                      </div>
                    ) : 'Not found'
                  ) : row.foundUrl ? (
                    <a className="text-emerald-700 hover:text-emerald-600" href={row.foundUrl} target="_blank" rel="noreferrer">{shortenUrl(row.foundUrl)}</a>
                  ) : 'Not found'}
                </td>
              </tr>
            )) : (
              <tr>
                <td colSpan={showProfile ? 6 : 5} className="px-4 py-8 text-center text-sm text-slate-500">
                  No {resultType === 'mapPack' ? 'map pack' : 'rank'} data in this range yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function LocationLookupField({ workspaceId, value, onChange, onSelect, onSetNotice, placeholder }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const skipNextLookupRef = useRef(false)
  const userTypedRef = useRef(false)

  useEffect(() => {
    const trimmed = String(value || '').trim()
    if (skipNextLookupRef.current) {
      skipNextLookupRef.current = false
      return
    }
    if (!userTypedRef.current || trimmed.length < 2) {
      return
    }

    let cancelled = false
    const timer = setTimeout(() => {
      setLoading(true)
      apiRequest(`/api/workspaces/${workspaceId}/rank/locations?q=${encodeURIComponent(trimmed)}`)
        .then((json) => {
          if (cancelled) return
          setItems(json.items || [])
        })
        .catch((error) => {
          if (cancelled) return
          setItems([])
          onSetNotice(error.message)
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 250)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [value, workspaceId, onSetNotice])

  return (
    <div className="relative space-y-2">
      <Input
        value={value}
        onChange={(event) => {
          const nextValue = event.target.value
          userTypedRef.current = true
          if (String(nextValue || '').trim().length < 2) {
            setItems([])
            setLoading(false)
          }
          onChange(nextValue)
        }}
        placeholder={placeholder}
        required
      />
      {loading ? <small className="text-xs text-slate-400">Searching locations...</small> : null}
      {items.length ? (
        <div className="absolute z-10 mt-1 grid w-full gap-2 rounded-[24px] border border-slate-200 bg-white p-3 shadow-[0_18px_48px_-24px_rgba(15,23,42,0.35)]">
          {items.map((item) => (
            <button
              key={`${item.id || item.canonicalName}-${item.targetType}`}
              type="button"
              className="rounded-[20px] border border-slate-200 px-4 py-3 text-left hover:border-slate-300 hover:bg-slate-50"
              onClick={() => {
                skipNextLookupRef.current = true
                userTypedRef.current = false
                setItems([])
                onSelect(item)
              }}
            >
              <strong className="block text-sm text-slate-950">{item.name}</strong>
              <span className="text-xs text-slate-400">{item.canonicalName || item.name}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function decorateProfiles(profiles = [], summary = null) {
  const organicById = new Map((summary?.profiles || []).map((item) => [String(item.id), item]))
  const mapPackById = new Map((summary?.mapPack?.profiles || []).map((item) => [String(item.id), item]))

  return profiles.map((profile) => ({
    ...profile,
    visibilityScore: organicById.get(String(profile.id))?.visibilityScore || 0,
    rankedKeywords: organicById.get(String(profile.id))?.rankedKeywords || 0,
    top10Keywords: organicById.get(String(profile.id))?.top10Keywords || 0,
    mapPackVisibilityScore: mapPackById.get(String(profile.id))?.visibilityScore || 0,
    mapPackRankedKeywords: mapPackById.get(String(profile.id))?.rankedKeywords || 0,
    mapPackTop3Keywords: mapPackById.get(String(profile.id))?.top3Keywords || 0,
  }))
}

function mapCountryCodeToCode(value = '') {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return ''
  if (normalized === 'gb') return 'uk'
  return normalized
}

function MetricTile({ label, tone = 'default', value }) {
  const toneClassName = {
    default: 'border-slate-200 bg-white',
    accent: 'border-emerald-200 bg-emerald-50/70',
    warning: 'border-amber-200 bg-amber-50/70',
    subtle: 'border-transparent bg-slate-100/80',
  }[tone]

  return (
    <div className={`rounded-[24px] border px-4 py-4 shadow-sm ${toneClassName}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</p>
      <p className="mt-3 text-lg font-semibold tracking-tight text-slate-950">{value}</p>
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

function compareRankRows(left, right) {
  const leftPosition = Number.isInteger(left.position) ? left.position : Number.MAX_SAFE_INTEGER
  const rightPosition = Number.isInteger(right.position) ? right.position : Number.MAX_SAFE_INTEGER
  if (leftPosition !== rightPosition) return leftPosition - rightPosition
  return String(left.keyword || '').localeCompare(String(right.keyword || ''))
}

function formatPosition(position) {
  return Number.isInteger(position) ? `#${position}` : 'Not ranked'
}

function formatChange(delta, hasBaseline) {
  if (!hasBaseline) return 'Baseline'
  if (delta === 100) return 'New'
  if (delta === -100) return 'Lost'
  if (!Number.isFinite(delta) || delta === null) return '--'
  if (delta > 0) return `+${delta}`
  if (delta < 0) return `${delta}`
  return '0'
}

function changeClassName(delta, hasBaseline) {
  if (!hasBaseline) return 'inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500'
  if (delta === 100 || delta > 0) return 'inline-flex rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700'
  if (delta === -100 || delta < 0) return 'inline-flex rounded-full bg-rose-100 px-2.5 py-1 text-xs font-semibold text-rose-700'
  return 'inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500'
}

function shortenUrl(value) {
  try {
    const url = new URL(value)
    return `${url.hostname}${url.pathname}`
  } catch {
    return value
  }
}

function formatDateTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function humanizeStatus(status) {
  const normalized = String(status || 'idle')
  if (normalized === 'completed') return 'Completed'
  if (normalized === 'partial') return 'Partial'
  if (normalized === 'failed') return 'Failed'
  if (normalized === 'running') return 'Running'
  return 'Idle'
}

function statusTone(status) {
  const normalized = String(status || 'idle')
  if (normalized === 'completed') return 'accent'
  if (normalized === 'partial') return 'warning'
  if (normalized === 'failed') return 'warning'
  return 'subtle'
}

function formatSchedule(config) {
  if (config.frequency === 'manual') return 'Manual'
  if (config.frequency === 'daily') return `Daily at ${padHour(config.hour)}`
  return `Weekly ${weekdayLabel(config.weekday)} at ${padHour(config.hour)}`
}

function weekdayLabel(weekday) {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][Number(weekday) || 0]
}

function padHour(hour) {
  const normalized = Number(hour) || 0
  return `${String(normalized).padStart(2, '0')}:00`
}

