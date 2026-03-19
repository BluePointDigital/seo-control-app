import {
  createJob,
  getWorkspaceSetting,
  listRankKeywords,
  listRankProfiles,
  updateJob,
} from './data.js'
import { resolveWorkspaceCredential, runWorkspaceSync } from './integrations.js'
import { normalizeDomain } from './utils.js'

export function startBackgroundScheduler(context) {
  if (!context.config.schedulerEnabled) {
    return () => {}
  }

  const runningWorkspaceIds = new Set()
  const timer = setInterval(() => {
    runDueRankSyncs(context, { runningWorkspaceIds }).catch((error) => {
      console.warn(`Rank scheduler error: ${error.message}`)
    })
  }, Math.max(60000, Number(context.config.schedulerIntervalMs || 900000)))

  if (typeof timer.unref === 'function') {
    timer.unref()
  }

  return () => clearInterval(timer)
}

export async function runDueRankSyncs(context, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date()
  const runningWorkspaceIds = options.runningWorkspaceIds || new Set()
  const workspaces = context.db.prepare(`
    SELECT id, organization_id, name, slug, status, created_at
    FROM workspaces
    WHERE status = 'active'
    ORDER BY id ASC
  `).all().map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    createdAt: row.created_at,
  }))

  for (const workspace of workspaces) {
    if (runningWorkspaceIds.has(workspace.id)) continue
    if (!isRankSyncDue(context, workspace, now)) continue
    if (!isReadyForScheduledRankSync(context, workspace)) continue

    runningWorkspaceIds.add(workspace.id)
    const jobId = createJob(context.db, {
      organizationId: workspace.organizationId,
      workspaceId: workspace.id,
      triggeredByUserId: null,
      jobType: 'workspace_sync',
      details: { source: 'rank', scheduled: true },
    })

    try {
      const result = await runWorkspaceSync(context, workspace, { source: 'rank', scheduled: true })
      updateJob(context.db, jobId, 'completed', { source: 'rank', scheduled: true, result })
    } catch (error) {
      updateJob(context.db, jobId, 'failed', { source: 'rank', scheduled: true, error: error.message })
    } finally {
      runningWorkspaceIds.delete(workspace.id)
    }
  }
}

export function isRankSyncDue(context, workspace, now = new Date()) {
  const frequency = String(getWorkspaceSetting(context.db, workspace.id, 'rank_sync_frequency', 'weekly') || 'weekly')
  if (frequency === 'manual') return false

  const hour = Number(getWorkspaceSetting(context.db, workspace.id, 'rank_sync_hour', '6') || 6)
  const weekday = Number(getWorkspaceSetting(context.db, workspace.id, 'rank_sync_weekday', '1') || 1)
  const lastAttemptedAt = getWorkspaceSetting(context.db, workspace.id, 'rank_sync_last_attempted_at')
  const scheduledMoment = getMostRecentScheduledMoment(now, frequency, weekday, hour)

  if (!scheduledMoment) return false
  if (now.getTime() < scheduledMoment.getTime()) return false
  if (!lastAttemptedAt) return true

  const lastAttempt = new Date(lastAttemptedAt)
  if (Number.isNaN(lastAttempt.getTime())) return true
  return lastAttempt.getTime() < scheduledMoment.getTime()
}

function isReadyForScheduledRankSync(context, workspace) {
  const domain = normalizeDomain(getWorkspaceSetting(context.db, workspace.id, 'rank_domain'))
  if (!domain) return false

  const credential = resolveWorkspaceCredential(context, workspace, 'dataforseo_or_serpapi', 'Saved rank API key could not be decrypted. Re-save it in the organization credential vault.')
  if (credential.error || !credential.value) return false

  const activeProfiles = listRankProfiles(context.db, workspace.id).filter((profile) => profile.active)
  if (!activeProfiles.length) return false

  const activeKeywords = listRankKeywords(context.db, workspace.id).filter((keyword) => keyword.active)
  return activeKeywords.some((keyword) => activeProfiles.some((profile) => Number(profile.id) === Number(keyword.profileId)))
}

function getMostRecentScheduledMoment(now, frequency, weekday, hour) {
  const scheduled = new Date(now)
  scheduled.setMinutes(0, 0, 0)
  scheduled.setHours(Number.isInteger(hour) ? hour : 6)

  if (frequency === 'daily') {
    if (scheduled.getTime() > now.getTime()) {
      scheduled.setDate(scheduled.getDate() - 1)
    }
    return scheduled
  }

  const targetWeekday = Number.isInteger(weekday) ? weekday : 1
  const dayOffset = (scheduled.getDay() - targetWeekday + 7) % 7
  scheduled.setDate(scheduled.getDate() - dayOffset)
  if (scheduled.getTime() > now.getTime()) {
    scheduled.setDate(scheduled.getDate() - 7)
  }
  return scheduled
}
