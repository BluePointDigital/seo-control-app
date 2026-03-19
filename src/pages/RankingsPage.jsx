import { useEffect, useMemo, useRef, useState } from 'react'

import { LineChart } from '../components/LineChart'
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

export function RankingsPage({ dateRange, onRefreshAuth, onSetNotice, workspace }) {
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
  const [savingConfig, setSavingConfig] = useState(false)
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
  async function saveConfig(event) {
    event.preventDefault()
    setSavingConfig(true)
    try {
      await apiRequest(`/api/workspaces/${workspace.id}/rank/config`, { method: 'PATCH', body: config })
      await reloadAfterRankChange(selectedProfile?.id || null)
      onSetNotice('Rank settings updated.')
    } catch (error) {
      onSetNotice(error.message)
    } finally {
      setSavingConfig(false)
    }
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
    <div className="page-stack rankings-page">
      <section className="page-grid rankings-overview-grid">
        <article className="panel span-8 rankings-hero-panel">
          <div className="panel-head rankings-hero-head">
            <div>
              <h2>Rank command center</h2>
              <p>{aggregateInsights.narrative || 'Run rank sync to collect the first baseline.'}</p>
            </div>
            <div className="row-actions">
              <button type="button" className="secondary" disabled={runningSync} onClick={() => runRankSync(null)}>
                {runningSync ? 'Syncing...' : 'Sync all profiles'}
              </button>
              {selectedProfile ? (
                <button type="button" className="secondary" disabled={runningSync} onClick={() => runRankSync(selectedProfile.id)}>
                  Sync selected profile
                </button>
              ) : null}
            </div>
          </div>
          <div className="view-toggle" role="tablist" aria-label="Rank result type">
            <button type="button" className={rankView === 'organic' ? 'tab active' : 'tab'} onClick={() => setRankView('organic')}>Organic</button>
            <button type="button" className={rankView === 'mapPack' ? 'tab active' : 'tab'} onClick={() => setRankView('mapPack')}>Map Pack</button>
          </div>
          <div className="kpi-row compact">
            <MetricTile label={rankView === 'mapPack' ? 'Map visibility' : 'Visibility score'} value={aggregateInsights.visibilityScore || 0} />
            <MetricTile label="Tracked keywords" value={aggregateInsights.trackedKeywords || 0} />
            <MetricTile label={rankView === 'mapPack' ? 'Ranked in pack' : 'Ranked keywords'} value={aggregateInsights.rankedKeywords || 0} />
            <MetricTile label={rankView === 'mapPack' ? 'Top 3 pack' : 'Top 10 keywords'} value={rankView === 'mapPack' ? (aggregateInsights.top3Keywords || 0) : (aggregateInsights.top10Keywords || 0)} />
          </div>
          <div className="rankings-meta-strip">
            <MetaPill label="Last scan" value={formatDateTime(config.lastCompletedAt) || 'Not yet run'} />
            <MetaPill label="Status" value={humanizeStatus(config.lastStatus)} tone={statusTone(config.lastStatus)} />
            <MetaPill label="Comparison" value={aggregateInsights.prevDate ? `vs ${aggregateInsights.prevDate}` : 'First baseline'} />
            <MetaPill label="Refresh schedule" value={formatSchedule(config)} />
          </div>
          {config.lastError ? <p className="muted-copy inline-note mt">{config.lastError}</p> : null}
          <div className="chart-header mt"><strong>{rankView === 'mapPack' ? 'Workspace map pack trend' : 'Workspace movement trend'}</strong><span>{activeSummary.range?.label || dateRange.label}</span></div>
          <LineChart
            rows={aggregateInsights.trendRows || []}
            series={trendSeries}
          />
        </article>

        <aside className="panel span-4 rankings-profile-panel">
          <div className="panel-head">
            <h2>Profiles at a glance</h2>
            <p>Select a market profile to manage it without losing the overall workspace view.</p>
          </div>
          <div className="profile-list">
            {profiles.map((profile) => (
              <button
                key={profile.id}
                type="button"
                className={selectedProfile?.id === profile.id ? 'profile-card selected' : 'profile-card'}
                onClick={() => setSelectedProfileId(profile.id)}
              >
                <div className="profile-card-top">
                  <strong>{profile.name}</strong>
                  <span className={`status-pill ${profile.active ? 'status-ok' : 'status-stale'}`}>{profile.active ? 'Active' : 'Paused'}</span>
                </div>
                <p className="muted-copy">{profile.locationLabel || profile.searchLocationName || 'Primary market'}</p>
                <div className="profile-card-metrics">
                  <span>{profile.keywordCount} keywords</span>
                  <span>{profile.openAlertCount} alerts</span>
                  <span>{rankView === 'mapPack' ? 'Map visibility' : 'Visibility'} {rankView === 'mapPack' ? (profile.mapPackVisibilityScore || 0) : (profile.visibilityScore || 0)}</span>
                </div>
              </button>
            ))}
            {!profiles.length ? <p className="muted-copy">No profiles yet.</p> : null}
          </div>
        </aside>
      </section>

      <section className="panel">
        <div className="panel-head rankings-table-head">
          <div>
            <h2>{rankView === 'mapPack' ? 'Current map pack results' : 'Current rankings'}</h2>
            <p>{rankView === 'mapPack' ? 'Every tracked keyword in this workspace, sorted by current map pack position.' : 'Every tracked keyword in this workspace, sorted by current position.'}</p>
          </div>
          <div className="muted-copy rankings-table-note">
            Change since last scan: {aggregateInsights.prevDate ? aggregateInsights.prevDate : 'first baseline'}
          </div>
        </div>
        <RankingsTable rows={aggregateRows} hasBaseline={Boolean(aggregateInsights.prevDate)} showProfile resultType={rankView} />
      </section>
      <section className="page-grid rank-detail-grid">
        <article className="panel span-7">
          <div className="panel-head">
            <h2>{selectedProfile ? `${selectedProfile.name} detail` : 'Profile detail'}</h2>
            <p>{profileInsights.narrative || 'Select a profile to review its movement and keyword set.'}</p>
          </div>
          {selectedProfile ? (
            <>
              <div className="kpi-row compact">
                <MetricTile label={rankView === 'mapPack' ? 'Map visibility' : 'Profile visibility'} value={profileInsights.visibilityScore || 0} />
                <MetricTile label="Tracked" value={profileInsights.trackedKeywords || 0} />
                <MetricTile label={rankView === 'mapPack' ? 'Top 3 pack' : 'Top 10'} value={rankView === 'mapPack' ? (profileInsights.top3Keywords || 0) : (profileInsights.top10Keywords || 0)} />
                <MetricTile label="Open alerts" value={alerts.length} />
              </div>
              <div className="chart-header"><strong>{selectedProfile.name} {rankView === 'mapPack' ? 'map pack trend' : 'trend'}</strong><span>{activeProfileSummary.range?.label || dateRange.label}</span></div>
              <LineChart
                rows={profileInsights.trendRows || []}
                series={trendSeries}
              />
              <div className="panel-head mt compact-head">
                <h3>{rankView === 'mapPack' ? 'Selected profile map pack' : 'Selected profile rankings'}</h3>
                <p>{rankView === 'mapPack' ? 'The exact terms, current local-pack positions, last-scan change, and matched listing details for this profile.' : 'The exact terms, current positions, last-scan change, and ranked URLs for this profile.'}</p>
              </div>
              <RankingsTable rows={selectedProfileRows} hasBaseline={Boolean(profileInsights.prevDate)} showProfile={false} resultType={rankView} />
              <div className="stack tight mt">
                <strong>Recent profile alerts</strong>
                {alerts.length ? alerts.map((alert) => (
                  <div key={alert.id} className="alert-card compact-alert">
                    <div className="spread">
                      <strong>{alert.title}</strong>
                      <span className={`severity-pill severity-${alert.severity}`}>{alert.severity}</span>
                    </div>
                    <p>{alert.message}</p>
                  </div>
                )) : <p className="muted-copy">No open alerts for this profile.</p>}
              </div>
            </>
          ) : (
            <p className="muted-copy">Create or select a rank profile to see profile-specific details.</p>
          )}
        </article>

        <aside className="panel span-5">
          <div className="panel-head">
            <h2>Sync and settings</h2>
            <p>Control domain defaults, schedule, and the selected profile configuration in one place.</p>
          </div>
          <form className="stack" onSubmit={saveConfig}>
            <label>
              Rank domain
              <input value={config.domain} onChange={(event) => setConfig((current) => ({ ...current, domain: event.target.value }))} placeholder="precision-door.com" />
            </label>
            <div className="two-column">
              <label>
                Default country
                <input value={config.gl} onChange={(event) => setConfig((current) => ({ ...current, gl: event.target.value.toLowerCase() }))} placeholder="us" maxLength={10} />
              </label>
              <label>
                Default language
                <input value={config.hl} onChange={(event) => setConfig((current) => ({ ...current, hl: event.target.value.toLowerCase() }))} placeholder="en" maxLength={10} />
              </label>
            </div>
            <div className="two-column">
              <label>
                Frequency
                <select value={config.frequency} onChange={(event) => setConfig((current) => ({ ...current, frequency: event.target.value }))}>
                  <option value="manual">Manual</option>
                  <option value="weekly">Weekly</option>
                  <option value="daily">Daily</option>
                </select>
              </label>
              <label>
                Hour
                <select value={config.hour} onChange={(event) => setConfig((current) => ({ ...current, hour: Number(event.target.value) }))}>
                  {Array.from({ length: 24 }, (_, index) => (
                    <option key={index} value={index}>{String(index).padStart(2, '0')}:00</option>
                  ))}
                </select>
              </label>
            </div>
            {config.frequency === 'weekly' ? (
              <label>
                Weekday
                <select value={config.weekday} onChange={(event) => setConfig((current) => ({ ...current, weekday: Number(event.target.value) }))}>
                  <option value={1}>Monday</option>
                  <option value={2}>Tuesday</option>
                  <option value={3}>Wednesday</option>
                  <option value={4}>Thursday</option>
                  <option value={5}>Friday</option>
                  <option value={6}>Saturday</option>
                  <option value={0}>Sunday</option>
                </select>
              </label>
            ) : null}
            <button type="submit" disabled={savingConfig}>{savingConfig ? 'Saving...' : 'Save rank settings'}</button>
          </form>

          {selectedProfile ? (
            <form className="stack mt" onSubmit={updateSelectedProfile}>
              <strong>Selected profile</strong>
              <label>
                Profile name
                <input value={profileForm.name} onChange={(event) => setProfileForm((current) => ({ ...current, name: event.target.value }))} />
              </label>
              <label>
                Search location
                <LocationLookupField
                  key={`selected-${selectedProfile.id}-${profileForm.searchLocationId}-${profileForm.searchLocationName}`}
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
              </label>
              <label>
                Display label
                <input value={profileForm.locationLabel} onChange={(event) => setProfileForm((current) => ({ ...current, locationLabel: event.target.value }))} />
              </label>
              <label>
                Business name
                <input value={profileForm.businessName} onChange={(event) => setProfileForm((current) => ({ ...current, businessName: event.target.value }))} placeholder="Precision Garage Door Service" required />
              </label>
              <div className="two-column">
                <label>
                  Country
                  <input value={profileForm.gl} onChange={(event) => setProfileForm((current) => ({ ...current, gl: event.target.value.toLowerCase() }))} placeholder="us" maxLength={10} />
                </label>
                <label>
                  Language
                  <input value={profileForm.hl} onChange={(event) => setProfileForm((current) => ({ ...current, hl: event.target.value.toLowerCase() }))} placeholder="en" maxLength={10} />
                </label>
              </div>
              <label className="checkbox-row">
                <input type="checkbox" checked={Boolean(profileForm.active)} onChange={(event) => setProfileForm((current) => ({ ...current, active: event.target.checked }))} />
                Active profile
              </label>
              <div className="row-actions">
                <button type="submit" disabled={savingProfile}>{savingProfile ? 'Saving...' : 'Save profile'}</button>
                <button type="button" className="secondary" onClick={deleteSelectedProfile}>Delete profile</button>
              </div>
            </form>
          ) : null}
        </aside>
      </section>
      <section className="page-grid rank-management-grid">
        <article className="panel span-5">
          <div className="panel-head">
            <h2>Create profile</h2>
            <p>Use separate profiles for cities, services, or market clusters that need their own baseline.</p>
          </div>
          <form className="stack" onSubmit={createProfile}>
            <label>
              Profile name
              <input value={newProfile.name} onChange={(event) => setNewProfile((current) => ({ ...current, name: event.target.value }))} placeholder="Spartanburg Repair" />
            </label>
            <label>
              Search location
              <LocationLookupField
                key={`new-${newProfile.searchLocationId}-${newProfile.searchLocationName}`}
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
            </label>
            <label>
              Display label
              <input value={newProfile.locationLabel} onChange={(event) => setNewProfile((current) => ({ ...current, locationLabel: event.target.value }))} placeholder="Spartanburg, SC" />
            </label>
            <label>
              Business name
              <input value={newProfile.businessName} onChange={(event) => setNewProfile((current) => ({ ...current, businessName: event.target.value }))} placeholder="Precision Garage Door Service" required />
            </label>
            <div className="two-column">
              <label>
                Country
                <input value={newProfile.gl} onChange={(event) => setNewProfile((current) => ({ ...current, gl: event.target.value.toLowerCase() }))} placeholder="us" maxLength={10} />
              </label>
              <label>
                Language
                <input value={newProfile.hl} onChange={(event) => setNewProfile((current) => ({ ...current, hl: event.target.value.toLowerCase() }))} placeholder="en" maxLength={10} />
              </label>
            </div>
            <button type="submit" disabled={savingProfile}>{savingProfile ? 'Saving...' : 'Create profile'}</button>
          </form>
        </article>

        <article className="panel span-7">
          <div className="panel-head">
            <h2>Keyword management</h2>
            <p>{selectedProfile ? `Add and maintain tracked keywords for ${selectedProfile.name}.` : 'Select a profile before adding keywords.'}</p>
          </div>
          {selectedProfile ? (
            <>
              <form className="stack" onSubmit={addKeyword}>
                <label>
                  Keyword
                  <input value={keywordForm.keyword} onChange={(event) => setKeywordForm((current) => ({ ...current, keyword: event.target.value }))} placeholder="garage door repair spartanburg sc" />
                </label>
                <label>
                  Landing page hint
                  <input value={keywordForm.landingPage} onChange={(event) => setKeywordForm((current) => ({ ...current, landingPage: event.target.value }))} placeholder="https://www.client.com/service-area/" />
                </label>
                <div className="two-column">
                  <label>
                    Intent
                    <input value={keywordForm.intent} onChange={(event) => setKeywordForm((current) => ({ ...current, intent: event.target.value }))} placeholder="repair" />
                  </label>
                  <label>
                    Priority
                    <select value={keywordForm.priority} onChange={(event) => setKeywordForm((current) => ({ ...current, priority: event.target.value }))}>
                      <option value="high">High</option>
                      <option value="medium">Medium</option>
                      <option value="low">Low</option>
                    </select>
                  </label>
                </div>
                <button type="submit" disabled={savingKeyword}>{savingKeyword ? 'Saving...' : 'Add keyword'}</button>
              </form>

              <form className="stack mt" onSubmit={bulkAddKeywords}>
                <label>
                  Bulk add keywords
                  <textarea
                    rows="5"
                    value={bulkText}
                    onChange={(event) => setBulkText(event.target.value)}
                    placeholder={[
                      'garage door repair spartanburg sc|https://www.client.com/service-area/spartanburg/',
                      'commercial garage doors upstate sc|https://www.client.com/commercial-garage-doors/',
                    ].join('\n')}
                  />
                </label>
                <button type="submit" className="secondary" disabled={savingKeyword}>{savingKeyword ? 'Saving...' : 'Bulk add keywords'}</button>
              </form>

              <div className="panel-head mt compact-head">
                <h3>Tracked keyword list</h3>
                <p>Landing-page hints and priorities stay attached to each keyword in the selected profile.</p>
              </div>
              <div className="tracked-keyword-list">
                {keywords.map((item) => (
                  <div key={item.id} className="tracked-keyword-row">
                    <div>
                      <strong>{item.keyword}</strong>
                      <p className="muted-copy">
                        {item.landingPage || 'No landing-page hint'}
                        {item.intent ? ` / ${item.intent}` : ''}
                        {item.priority ? ` / ${item.priority}` : ''}
                      </p>
                    </div>
                    <button type="button" className="secondary small" onClick={() => removeKeyword(item.id)}>Remove</button>
                  </div>
                ))}
                {!keywords.length ? <p className="muted-copy">No tracked keywords yet for this profile.</p> : null}
              </div>
            </>
          ) : (
            <p className="muted-copy">Select a profile to add and manage keywords.</p>
          )}
        </article>
      </section>
    </div>
  )
}

function RankingsTable({ rows, hasBaseline, showProfile, resultType = 'organic' }) {
  return (
    <div className="ranking-table-shell">
      <table className="ranking-table">
        <thead>
          <tr>
            <th>Keyword</th>
            {showProfile ? <th>Profile</th> : null}
            <th>Position</th>
            <th>Change</th>
            <th>Last scan</th>
            <th>{resultType === 'mapPack' ? 'Matched listing' : 'Ranked URL'}</th>
          </tr>
        </thead>
        <tbody>
          {rows.length ? rows.map((row) => (
            <tr key={`${row.profileId || 'workspace'}-${row.keyword}`}>
              <td><strong>{row.keyword}</strong></td>
              {showProfile ? <td>{row.profileName || 'Workspace'}</td> : null}
              <td>{formatPosition(row.position)}</td>
              <td><span className={changeClassName(row.delta, hasBaseline)}>{formatChange(row.delta, hasBaseline)}</span></td>
              <td>{row.date || '-'}</td>
              <td>
                {resultType === 'mapPack' ? (
                  row.foundName || row.foundUrl ? (
                    <div className="ranking-result">
                      {row.foundName ? <strong className="result-name">{row.foundName}</strong> : null}
                      {row.foundUrl ? <a className="ranked-url" href={row.foundUrl} target="_blank" rel="noreferrer">{shortenUrl(row.foundUrl)}</a> : null}
                    </div>
                  ) : 'Not found'
                ) : row.foundUrl ? (
                  <a className="ranked-url" href={row.foundUrl} target="_blank" rel="noreferrer">{shortenUrl(row.foundUrl)}</a>
                ) : 'Not found'}
              </td>
            </tr>
          )) : (
            <tr>
              <td colSpan={showProfile ? 6 : 5} className="ranking-table-empty">No {resultType === 'mapPack' ? 'map pack' : 'rank'} data in this range yet.</td>
            </tr>
          )}
        </tbody>
      </table>
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
    <div className="location-field">
      <input
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
      {loading ? <small>Searching locations...</small> : null}
      {items.length ? (
        <div className="location-suggestions">
          {items.map((item) => (
            <button
              key={`${item.id || item.canonicalName}-${item.targetType}`}
              type="button"
              className="location-suggestion"
              onClick={() => {
                skipNextLookupRef.current = true
                userTypedRef.current = false
                setItems([])
                onSelect(item)
              }}
            >
              <strong>{item.name}</strong>
              <span>{item.canonicalName || item.name}</span>
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

function MetricTile({ label, value }) {
  return <div className="metric-tile"><span>{label}</span><strong>{value}</strong></div>
}

function MetaPill({ label, value, tone = '' }) {
  return (
    <div className={`meta-pill ${tone}`.trim()}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
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
  if (!hasBaseline) return 'change-pill neutral'
  if (delta === 100 || delta > 0) return 'change-pill up'
  if (delta === -100 || delta < 0) return 'change-pill down'
  return 'change-pill neutral'
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
  if (normalized === 'completed') return 'status-ok'
  if (normalized === 'partial') return 'status-stale'
  if (normalized === 'failed') return 'status-down'
  return ''
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

