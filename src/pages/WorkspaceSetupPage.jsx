import { CheckCircle2, Link2, LoaderCircle, Rocket, SearchCheck, Settings2 } from 'lucide-react'

import { formatAdsCustomerLabel, useWorkspaceSetupModel } from '../lib/workspaceSetup'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { FocusCard, FormField, KeyValueRow, MetricCard, PageIntro, SectionHeading, StepCard, StatusPill } from '../components/ui/surface'
import { Input } from '../components/ui/input'
import { Select } from '../components/ui/select'
import { Separator } from '../components/ui/separator'

export function WorkspaceSetupPage({
  googleConnected,
  onOpenOrganizationSettings,
  onSetNotice,
  onRefreshAuth,
  workspace,
}) {
  const {
    adsCustomerOptions,
    assets,
    googleAdsTokenSelection,
    loading,
    pageSpeedSelection,
    providers,
    rankApiSelection,
    rankStatus,
    runAudit,
    runningAudit,
    runningSync,
    saveSetup,
    saving,
    setSetup,
    setup,
    summary,
    runSync,
  } = useWorkspaceSetupModel({
    googleConnected,
    onRefreshAuth,
    onSetNotice,
    workspace,
  })

  function handleFocusAction() {
    if (summary.focus.action === 'Open organization settings') {
      onOpenOrganizationSettings()
      return
    }
  }

  if (loading) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex min-h-[320px] items-center justify-center gap-3 text-slate-500">
          <LoaderCircle className="h-5 w-5 animate-spin" />
          Loading workspace setup...
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <PageIntro
        badge="Workspace Setup"
        title={`${workspace.name} setup`}
        description="Keep all workspace-specific source mapping, rank defaults, audit defaults, and sync actions in one place."
        actions={(
          <Button type="button" variant="accent" onClick={saveSetup} disabled={saving}>
            {saving ? 'Saving...' : 'Save workspace setup'}
          </Button>
        )}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_360px]">
        <form className="space-y-6" onSubmit={(event) => { event.preventDefault(); saveSetup() }}>
          <Card>
            <CardHeader>
              <SectionHeading
                title="Data sources"
                description="Assign production properties and saved credential labels for this workspace."
                action={googleConnected ? <StatusPill tone="success" value="Google connected" /> : <StatusPill tone="warning" value="Google not connected" />}
              />
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <FormField label="GSC property">
                  {assets.gscSites.items.length ? (
                    <Select value={setup.gscSiteUrl} onChange={(event) => setSetup((current) => ({ ...current, gscSiteUrl: event.target.value }))}>
                      <option value="">Select a property</option>
                      {assets.gscSites.items.map((item) => <option key={item.siteUrl} value={item.siteUrl}>{item.siteUrl}</option>)}
                    </Select>
                  ) : (
                    <Input value={setup.gscSiteUrl} onChange={(event) => setSetup((current) => ({ ...current, gscSiteUrl: event.target.value }))} placeholder="sc-domain:client.com" />
                  )}
                </FormField>
                <FormField label="GA4 property">
                  {assets.ga4Properties.items.length ? (
                    <Select value={setup.ga4PropertyId} onChange={(event) => setSetup((current) => ({ ...current, ga4PropertyId: event.target.value }))}>
                      <option value="">Select a property</option>
                      {assets.ga4Properties.items.map((item) => <option key={item.propertyId} value={item.propertyId}>{item.accountDisplayName} / {item.displayName}</option>)}
                    </Select>
                  ) : (
                    <Input value={setup.ga4PropertyId} onChange={(event) => setSetup((current) => ({ ...current, ga4PropertyId: event.target.value }))} placeholder="123456789" />
                  )}
                </FormField>
              </div>
              <AvailabilityNote availability={assets.gscSites.availability} />
              <AvailabilityNote availability={assets.ga4Properties.availability} />
              <div className="grid gap-4 md:grid-cols-2">
                <CredentialField
                  provider={providers.google_ads_developer_token}
                  selection={googleAdsTokenSelection}
                  value={setup.googleAdsDeveloperTokenLabel}
                  onChange={(value) => setSetup((current) => ({ ...current, googleAdsDeveloperTokenLabel: value }))}
                />
                <FormField label="Google Ads customer">
                  {adsCustomerOptions.length ? (
                    <Select value={setup.googleAdsCustomerId} onChange={(event) => setSetup((current) => ({ ...current, googleAdsCustomerId: event.target.value }))}>
                      <option value="">Select a customer</option>
                      {adsCustomerOptions.map((item) => <option key={item.customerId} value={item.customerId}>{formatAdsCustomerLabel(item)}</option>)}
                    </Select>
                  ) : (
                    <Input value={setup.googleAdsCustomerId} onChange={(event) => setSetup((current) => ({ ...current, googleAdsCustomerId: event.target.value }))} placeholder="1234567890" />
                  )}
                </FormField>
              </div>
              <AvailabilityNote availability={assets.adsCustomers.availability} />
              <div className="grid gap-4 md:grid-cols-2">
                <CredentialField
                  provider={providers.dataforseo_or_serpapi}
                  selection={rankApiSelection}
                  value={setup.rankApiCredentialLabel}
                  onChange={(value) => setSetup((current) => ({ ...current, rankApiCredentialLabel: value }))}
                />
                <CredentialField
                  provider={providers.google_pagespeed_api}
                  selection={pageSpeedSelection}
                  value={setup.pageSpeedCredentialLabel}
                  onChange={(value) => setSetup((current) => ({ ...current, pageSpeedCredentialLabel: value }))}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <SectionHeading
                title="Rank defaults"
                description="Set the domain and baseline market defaults the workspace should use."
              />
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <FormField label="Rank domain">
                  <Input value={setup.rankDomain} onChange={(event) => setSetup((current) => ({ ...current, rankDomain: event.target.value }))} placeholder="clientsite.com" />
                </FormField>
                <FormField label="Frequency">
                  <Select value={setup.rankFrequency} onChange={(event) => setSetup((current) => ({ ...current, rankFrequency: event.target.value }))}>
                    <option value="manual">Manual</option>
                    <option value="weekly">Weekly</option>
                    <option value="daily">Daily</option>
                  </Select>
                </FormField>
              </div>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <FormField label="Country">
                  <Input value={setup.rankCountry} onChange={(event) => setSetup((current) => ({ ...current, rankCountry: event.target.value.toLowerCase() }))} placeholder="us" maxLength={10} />
                </FormField>
                <FormField label="Language">
                  <Input value={setup.rankLanguage} onChange={(event) => setSetup((current) => ({ ...current, rankLanguage: event.target.value.toLowerCase() }))} placeholder="en" maxLength={10} />
                </FormField>
                <FormField label="Hour">
                  <Select value={setup.rankHour} onChange={(event) => setSetup((current) => ({ ...current, rankHour: Number(event.target.value) }))}>
                    {Array.from({ length: 24 }, (_, index) => <option key={index} value={index}>{String(index).padStart(2, '0')}:00</option>)}
                  </Select>
                </FormField>
                <FormField label="Weekday">
                  <Select value={setup.rankWeekday} onChange={(event) => setSetup((current) => ({ ...current, rankWeekday: Number(event.target.value) }))} disabled={setup.rankFrequency !== 'weekly'}>
                    <option value={1}>Monday</option>
                    <option value={2}>Tuesday</option>
                    <option value={3}>Wednesday</option>
                    <option value={4}>Thursday</option>
                    <option value={5}>Friday</option>
                    <option value={6}>Saturday</option>
                    <option value={0}>Sunday</option>
                  </Select>
                </FormField>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <SectionHeading
                title="Audit defaults"
                description="Choose the crawl starting point and crawl size for repeatable technical checks."
              />
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
              <FormField label="Audit entry URL">
                <Input value={setup.auditEntryUrl} onChange={(event) => setSetup((current) => ({ ...current, auditEntryUrl: event.target.value }))} placeholder={setup.rankDomain ? `https://${setup.rankDomain}` : 'https://clientsite.com'} />
              </FormField>
              <FormField label="Max pages">
                <Input type="number" min="5" max="50" value={setup.auditMaxPages} onChange={(event) => setSetup((current) => ({ ...current, auditMaxPages: event.target.value }))} />
              </FormField>
            </CardContent>
          </Card>
        </form>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Readiness</CardTitle>
              <CardDescription>Track setup progress without bouncing across pages.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <MetricCard label="Setup score" value={`${summary.readinessScore}%`} tone="accent" />
                <MetricCard label="Completed steps" value={`${summary.steps.filter((step) => step.done).length}/${summary.steps.length}`} />
              </div>
              <div className="space-y-3">
                {summary.steps.map((step) => <StepCard key={step.id} done={step.done} hint={step.hint} label={step.label} />)}
              </div>
            </CardContent>
          </Card>

          <FocusCard
            title={summary.focus.title}
            description={summary.focus.description}
            actionLabel={summary.focus.action}
            onAction={handleFocusAction}
          />

          <Card>
            <CardHeader>
              <CardTitle>Operations</CardTitle>
              <CardDescription>Run workspace jobs from the same place you manage their defaults.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3">
                <Button type="button" variant="accent" onClick={() => runSync('all')} disabled={runningSync}>
                  <Rocket className="mr-2 h-4 w-4" />
                  {runningSync ? 'Running full sync...' : 'Run full sync'}
                </Button>
                <Button type="button" variant="secondary" onClick={() => runSync('rank')} disabled={runningSync}>
                  <SearchCheck className="mr-2 h-4 w-4" />
                  {runningSync ? 'Running rank sync...' : 'Run rank sync'}
                </Button>
                <Button type="button" variant="secondary" onClick={runAudit} disabled={runningAudit}>
                  <Link2 className="mr-2 h-4 w-4" />
                  {runningAudit ? 'Running site audit...' : 'Run site audit'}
                </Button>
              </div>
              <Separator />
              <div className="space-y-3">
                <KeyValueRow label="Last rank status" value={<StatusPill tone={statusTone(rankStatus.lastStatus)} value={humanizeStatus(rankStatus.lastStatus)} />} />
                <KeyValueRow label="Last rank completion" value={formatDateTime(rankStatus.lastCompletedAt) || 'Not yet run'} />
                <KeyValueRow label="Current audit target" value={setup.auditEntryUrl || setup.rankDomain || 'Not configured'} />
              </div>
              {rankStatus.lastError ? (
                <div className="rounded-[20px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-700">
                  {rankStatus.lastError}
                </div>
              ) : null}
              <div className="rounded-[22px] border border-emerald-200 bg-emerald-50/70 px-4 py-4">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600" />
                  <div>
                    <p className="font-semibold text-emerald-800">Setup changes are saved together.</p>
                    <p className="mt-1 text-sm leading-6 text-emerald-700">
                      Save here, then use Overview, Rankings, and Site Audit for monitoring and editing live workspace data.
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Configured sources</CardTitle>
              <CardDescription>Quick status view for the sources driving this workspace.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <SourceRow label="Search Console" ready={Boolean(setup.gscSiteUrl)} />
              <SourceRow label="GA4" ready={Boolean(setup.ga4PropertyId)} />
              <SourceRow label="Google Ads" ready={Boolean(setup.googleAdsCustomerId)} />
              <SourceRow label="Rank tracking" ready={Boolean(setup.rankDomain)} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function AvailabilityNote({ availability }) {
  if (!availability?.message || availability.state === 'ready') return null
  return <p className="rounded-[20px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-700">{availability.message}</p>
}

function CredentialField({ onChange, provider, selection, value }) {
  if (!provider || !selection) return null

  return (
    <div className="space-y-2">
      <FormField label={provider.label}>
        <Select value={value} onChange={(event) => onChange(event.target.value)}>
          {selection.options.map((item) => <option key={`${provider.id}-${item.value}`} value={item.value}>{item.label}</option>)}
        </Select>
      </FormField>
      <CredentialLabelNote provider={provider} selection={selection} />
    </div>
  )
}

function CredentialLabelNote({ provider, selection }) {
  const message = getCredentialSelectionMessage(provider, selection)
  if (!message) return null
  return <p className="text-xs leading-5 text-slate-400">{message}</p>
}

function getCredentialSelectionMessage(provider, selection) {
  if (selection.fallbackActive) {
    return `Label "${selection.selectedLabel}" is missing for ${provider.credentialName}. This workspace will use "default" until you update it or recreate that label.`
  }

  if (selection.missingAll) {
    if (selection.selectedLabel === 'default') {
      return `No ${provider.credentialName} is saved under the "default" label yet.`
    }
    return `No ${provider.credentialName} is saved for "${selection.selectedLabel}" and no "default" fallback is available.`
  }

  return ''
}

function SourceRow({ label, ready }) {
  return (
    <div className="flex items-center justify-between rounded-[20px] border border-slate-200 bg-white px-4 py-3">
      <span className="text-sm text-slate-600">{label}</span>
      <Badge variant={ready ? 'accent' : 'warning'}>{ready ? 'Ready' : 'Pending'}</Badge>
    </div>
  )
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
  if (normalized === 'completed') return 'success'
  if (normalized === 'partial') return 'warning'
  if (normalized === 'failed') return 'danger'
  return 'default'
}

function formatDateTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}
