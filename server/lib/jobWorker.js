import { getWorkspaceById } from './data.js'
import { runWorkspaceAudit, runWorkspaceSync } from './integrations.js'
import {
  claimNextJob,
  completeJob,
  failJob,
  getJobQueueStats,
  heartbeatJob,
  recoverStaleJobs,
  updateJobProgress,
} from './jobs.js'
import { createWorkspaceReport } from './operations.js'

export function startJobWorker(context) {
  const state = {
    enabled: Boolean(context.config.jobWorkerEnabled),
    running: false,
    activeJobId: null,
    lastHeartbeatAt: null,
    lastRunAt: null,
    lastError: '',
    stopped: false,
  }

  if (!state.enabled) {
    return {
      state,
      wake() {},
      stop() {
        state.stopped = true
      },
    }
  }

  let timer = null
  const pollMs = Math.max(250, Number(context.config.jobWorkerPollMs || 2000))

  function schedule(delay = pollMs) {
    if (state.stopped || timer) return
    timer = setTimeout(() => {
      timer = null
      runLoop().catch((error) => {
        state.lastError = error.message
        console.warn(`Job worker error: ${error.message}`)
        schedule()
      })
    }, delay)
    if (typeof timer.unref === 'function') timer.unref()
  }

  async function runLoop() {
    if (state.stopped || state.running) {
      schedule()
      return
    }

    state.running = true
    state.lastRunAt = new Date().toISOString()

    try {
      recoverStaleJobs(context.db)
      const concurrency = Math.max(1, Number(context.config.jobWorkerConcurrency || 1))
      for (let index = 0; index < concurrency && !state.stopped; index += 1) {
        const job = claimNextJob(context.db, { leaseSeconds: context.config.jobLeaseSeconds })
        if (!job) break
        await runClaimedJob(context, state, job)
      }
      state.lastError = ''
    } finally {
      state.running = false
      state.activeJobId = null
      schedule()
    }
  }

  schedule(0)

  return {
    state,
    wake() {
      if (!state.running) schedule(0)
    },
    stop() {
      state.stopped = true
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    },
  }
}

export function getJobWorkerHealth(context) {
  const worker = context.jobWorker
  const state = worker?.state || { enabled: false }
  return {
    enabled: Boolean(state.enabled),
    running: Boolean(state.running),
    activeJobId: state.activeJobId || null,
    lastHeartbeatAt: state.lastHeartbeatAt || null,
    lastRunAt: state.lastRunAt || null,
    lastError: state.lastError || '',
    queue: getJobQueueStats(context.db),
  }
}

export async function runClaimedJob(context, state, job) {
  state.activeJobId = job.id
  state.lastHeartbeatAt = new Date().toISOString()

  const heartbeatTimer = setInterval(() => {
    try {
      heartbeatJob(context.db, job.id, {
        leaseSeconds: context.config.jobLeaseSeconds,
        progressMessage: state.activeJobId === job.id ? 'Running.' : null,
      })
      state.lastHeartbeatAt = new Date().toISOString()
    } catch (error) {
      state.lastError = error.message
    }
  }, Math.max(1000, Number(context.config.jobHeartbeatSeconds || 30) * 1000))
  if (typeof heartbeatTimer.unref === 'function') heartbeatTimer.unref()

  try {
    const result = await executeJob(context, job)
    completeJob(context.db, job.id, result, 'Completed.')
  } catch (error) {
    failJob(context.db, job, error)
  } finally {
    clearInterval(heartbeatTimer)
    state.lastHeartbeatAt = new Date().toISOString()
    state.activeJobId = null
  }
}

async function executeJob(context, job) {
  const workspace = requireJobWorkspace(context, job)
  const details = job.details || {}

  if (job.jobType === 'workspace_sync') {
    const source = details.source || 'all'
    const profileId = details.profileId == null ? null : Number(details.profileId)
    updateJobProgress(context.db, job.id, `Running ${source} sync.`)
    const result = await runWorkspaceSync(context, workspace, {
      source,
      profileId,
      scheduled: Boolean(details.scheduled),
    })
    return { source, profileId, result }
  }

  if (job.jobType === 'site_audit') {
    updateJobProgress(context.db, job.id, 'Running site audit.')
    const item = await runWorkspaceAudit(context, workspace, {
      entryUrl: details.entryUrl,
      maxPages: details.maxPages,
    })
    return { item }
  }

  if (job.jobType === 'report_generate') {
    updateJobProgress(context.db, job.id, 'Generating report.')
    return createWorkspaceReport(context.db, workspace, details.reportType || 'weekly', {
      startDate: details.startDate,
      endDate: details.endDate,
      sections: details.sections,
    })
  }

  throw new Error(`Unsupported job type: ${job.jobType}`)
}

function requireJobWorkspace(context, job) {
  if (!job.workspaceId) throw new Error('Job is missing a workspace.')
  const workspace = getWorkspaceById(context.db, job.organizationId, job.workspaceId)
  if (!workspace) throw new Error('Job workspace no longer exists.')
  return workspace
}
