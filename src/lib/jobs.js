import { apiRequest } from './api.js'

const TERMINAL_STATUSES = new Set(['completed', 'failed'])

export async function waitForWorkspaceJob(workspaceId, jobId, options = {}) {
  const pollMs = Number(options.pollMs || 1500)
  const timeoutMs = Number(options.timeoutMs || 20 * 60 * 1000)
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const payload = await apiRequest(`/api/workspaces/${workspaceId}/jobs/${jobId}`)
    const job = payload.item || payload.job || payload

    if (typeof options.onJobUpdate === 'function') {
      options.onJobUpdate(job)
    }

    if (TERMINAL_STATUSES.has(job.status)) {
      if (job.status === 'failed') {
        throw new Error(job.errorMessage || job.progressMessage || 'Job failed.')
      }
      return job
    }

    await wait(pollMs)
  }

  throw new Error('The job is still running. Check Recent activity for the latest status.')
}

export function formatJobAction(jobType = 'job') {
  const normalized = String(jobType || 'job').replace(/_/g, ' ')
  return normalized[0]?.toUpperCase() + normalized.slice(1)
}

function wait(duration) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, duration)
  })
}
