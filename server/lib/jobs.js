import { runTransaction, safeJsonParse } from './utils.js'

export const ACTIVE_JOB_STATUSES = ['queued', 'running']
export const TERMINAL_JOB_STATUSES = ['completed', 'failed']

export function buildJobDedupeKey(jobType, workspaceId, details = {}) {
  const normalizedType = String(jobType || '').trim()
  const scopedWorkspaceId = Number(workspaceId || 0)

  if (normalizedType === 'workspace_sync') {
    return [
      normalizedType,
      scopedWorkspaceId,
      String(details.source || 'all'),
      details.profileId == null ? 'all' : Number(details.profileId),
    ].join(':')
  }

  if (normalizedType === 'site_audit') {
    return [
      normalizedType,
      scopedWorkspaceId,
      String(details.entryUrl || ''),
      Number(details.maxPages || 0),
    ].join(':')
  }

  if (normalizedType === 'report_generate') {
    return [
      normalizedType,
      scopedWorkspaceId,
      String(details.reportType || 'weekly'),
      String(details.startDate || ''),
      String(details.endDate || ''),
      stableStringify(details.sections || []),
    ].join(':')
  }

  return [normalizedType, scopedWorkspaceId, stableStringify(details)].join(':')
}

export function enqueueJob(db, {
  organizationId,
  workspaceId = null,
  triggeredByUserId = null,
  triggeredByApiTokenId = null,
  jobType,
  details = {},
  dedupeKey = '',
  maxAttempts = 2,
  progressMessage = 'Queued.',
  availableAt = null,
} = {}) {
  const normalizedDetails = details || {}
  const effectiveDedupeKey = dedupeKey || buildJobDedupeKey(jobType, workspaceId, normalizedDetails)
  const available = availableAt || new Date().toISOString()

  return runTransaction(db, () => {
    if (effectiveDedupeKey) {
      const existing = db.prepare(`
        SELECT *
        FROM jobs
        WHERE dedupe_key = ? AND status IN ('queued', 'running')
        ORDER BY id ASC
        LIMIT 1
      `).get(effectiveDedupeKey)

      if (existing) {
        return { job: mapJobRow(existing), deduped: true }
      }
    }

    const result = db.prepare(`
      INSERT INTO jobs (
        organization_id,
        workspace_id,
        triggered_by_user_id,
        triggered_by_api_token_id,
        job_type,
        status,
        details,
        available_at,
        max_attempts,
        progress_message,
        dedupe_key,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(
      Number(organizationId),
      workspaceId ? Number(workspaceId) : null,
      triggeredByUserId ? Number(triggeredByUserId) : null,
      triggeredByApiTokenId ? Number(triggeredByApiTokenId) : null,
      String(jobType || ''),
      JSON.stringify(normalizedDetails),
      available,
      Math.max(1, Number(maxAttempts || 2)),
      String(progressMessage || 'Queued.'),
      effectiveDedupeKey || null,
    )

    return { job: getJobById(db, Number(result.lastInsertRowid)), deduped: false }
  })
}

export function claimNextJob(db, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date()
  const nowIso = now.toISOString()
  const leaseSeconds = Math.max(30, Number(options.leaseSeconds || 600))
  const leaseExpiresAt = new Date(now.getTime() + leaseSeconds * 1000).toISOString()

  db.exec('BEGIN IMMEDIATE')
  try {
    recoverStaleJobsInternal(db, nowIso)
    const row = db.prepare(`
      SELECT *
      FROM jobs
      WHERE status = 'queued' AND datetime(available_at) <= datetime(?)
      ORDER BY available_at ASC, id ASC
      LIMIT 1
    `).get(nowIso)

    if (!row) {
      db.exec('COMMIT')
      return null
    }

    db.prepare(`
      UPDATE jobs
      SET status = 'running',
          attempts = attempts + 1,
          started_at = COALESCE(started_at, ?),
          heartbeat_at = ?,
          lease_expires_at = ?,
          finished_at = NULL,
          progress_message = ?,
          error_message = NULL,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(nowIso, nowIso, leaseExpiresAt, 'Running.', Number(row.id))

    const claimed = getJobById(db, Number(row.id))
    db.exec('COMMIT')
    return claimed
  } catch (error) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // ignore rollback failures
    }
    throw error
  }
}

export function heartbeatJob(db, jobId, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date()
  const nowIso = now.toISOString()
  const leaseSeconds = Math.max(30, Number(options.leaseSeconds || 600))
  const leaseExpiresAt = new Date(now.getTime() + leaseSeconds * 1000).toISOString()
  db.prepare(`
    UPDATE jobs
    SET heartbeat_at = ?,
        lease_expires_at = ?,
        progress_message = COALESCE(?, progress_message),
        updated_at = datetime('now')
    WHERE id = ? AND status = 'running'
  `).run(nowIso, leaseExpiresAt, options.progressMessage ?? null, Number(jobId))
}

export function completeJob(db, jobId, result = {}, progressMessage = 'Completed.') {
  db.prepare(`
    UPDATE jobs
    SET status = 'completed',
        finished_at = ?,
        heartbeat_at = ?,
        lease_expires_at = NULL,
        progress_message = ?,
        result_json = ?,
        error_message = NULL,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(new Date().toISOString(), new Date().toISOString(), progressMessage, JSON.stringify(result || {}), Number(jobId))
  return getJobById(db, Number(jobId))
}

export function failJob(db, job, error, options = {}) {
  const message = error?.message || String(error || 'Job failed.')
  const retryDelayMs = Number(options.retryDelayMs || 30000)
  const now = new Date()
  const canRetry = Number(job?.attempts || 0) < Number(job?.maxAttempts || 1)

  if (canRetry) {
    db.prepare(`
      UPDATE jobs
      SET status = 'queued',
          available_at = ?,
          heartbeat_at = NULL,
          lease_expires_at = NULL,
          progress_message = ?,
          error_message = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(
      new Date(now.getTime() + retryDelayMs).toISOString(),
      `Retrying after failure: ${message}`,
      message,
      Number(job.id),
    )
    return getJobById(db, Number(job.id))
  }

  db.prepare(`
    UPDATE jobs
    SET status = 'failed',
        finished_at = ?,
        heartbeat_at = ?,
        lease_expires_at = NULL,
        progress_message = ?,
        error_message = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(now.toISOString(), now.toISOString(), 'Failed.', message, Number(job.id))
  return getJobById(db, Number(job.id))
}

export function updateJobProgress(db, jobId, progressMessage) {
  db.prepare(`
    UPDATE jobs
    SET progress_message = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(String(progressMessage || ''), Number(jobId))
}

export function recoverStaleJobs(db, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date()
  return recoverStaleJobsInternal(db, now.toISOString())
}

export function getJobById(db, jobId) {
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(Number(jobId))
  return row ? mapJobRow(row) : null
}

export function getWorkspaceJobById(db, organizationId, workspaceId, jobId, options = {}) {
  const workspaceIds = normalizeIdList(options.workspaceIds)
  if (workspaceIds && !workspaceIds.includes(Number(workspaceId))) return null

  const params = [Number(organizationId), Number(workspaceId), Number(jobId)]
  let sql = `
    SELECT *
    FROM jobs
    WHERE organization_id = ? AND workspace_id = ? AND id = ?
  `

  if (workspaceIds) {
    sql += ` AND workspace_id IN (${workspaceIds.map(() => '?').join(', ')})`
    params.push(...workspaceIds)
  }

  const row = db.prepare(sql).get(...params)
  return row ? mapJobRow(row) : null
}

export function listWorkspaceJobs(db, organizationId, workspaceId, limit = 25, options = {}) {
  const workspaceIds = normalizeIdList(options.workspaceIds)
  if (workspaceIds && !workspaceIds.includes(Number(workspaceId))) return []

  const params = [Number(organizationId), Number(workspaceId)]
  let sql = `
    SELECT *
    FROM jobs
    WHERE organization_id = ? AND workspace_id = ?
  `

  if (workspaceIds) {
    sql += ` AND workspace_id IN (${workspaceIds.map(() => '?').join(', ')})`
    params.push(...workspaceIds)
  }

  sql += ' ORDER BY id DESC LIMIT ?'
  params.push(Number(limit || 25))

  return db.prepare(sql).all(...params).map(mapJobRow)
}

export function getJobQueueStats(db, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date()
  const nowIso = now.toISOString()
  const rows = db.prepare(`
    SELECT status, COUNT(*) AS count
    FROM jobs
    GROUP BY status
  `).all()
  const byStatus = rows.reduce((acc, row) => {
    acc[row.status] = Number(row.count || 0)
    return acc
  }, {})
  const stale = db.prepare(`
    SELECT COUNT(*) AS count
    FROM jobs
    WHERE status = 'running'
      AND lease_expires_at IS NOT NULL
      AND datetime(lease_expires_at) <= datetime(?)
  `).get(nowIso)

  return {
    queued: byStatus.queued || 0,
    running: byStatus.running || 0,
    completed: byStatus.completed || 0,
    failed: byStatus.failed || 0,
    stale: Number(stale?.count || 0),
  }
}

export function mapJobRow(row = {}) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    workspaceId: row.workspace_id == null ? null : Number(row.workspace_id),
    triggeredByUserId: row.triggered_by_user_id == null ? null : Number(row.triggered_by_user_id),
    triggeredByApiTokenId: row.triggered_by_api_token_id == null ? null : Number(row.triggered_by_api_token_id),
    jobType: row.job_type,
    status: row.status,
    details: safeJsonParse(row.details, {}),
    result: safeJsonParse(row.result_json, null),
    errorMessage: row.error_message || '',
    progressMessage: row.progress_message || '',
    dedupeKey: row.dedupe_key || '',
    attempts: Number(row.attempts || 0),
    maxAttempts: Number(row.max_attempts || 0),
    availableAt: row.available_at || null,
    startedAt: row.started_at || null,
    heartbeatAt: row.heartbeat_at || null,
    leaseExpiresAt: row.lease_expires_at || null,
    finishedAt: row.finished_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function recoverStaleJobsInternal(db, nowIso) {
  const retryable = db.prepare(`
    UPDATE jobs
    SET status = 'queued',
        available_at = ?,
        heartbeat_at = NULL,
        lease_expires_at = NULL,
        progress_message = 'Recovered stale job for retry.',
        error_message = 'Job worker stopped before completing this job.',
        updated_at = datetime('now')
    WHERE status = 'running'
      AND lease_expires_at IS NOT NULL
      AND datetime(lease_expires_at) <= datetime(?)
      AND attempts < max_attempts
  `).run(nowIso, nowIso)

  const failed = db.prepare(`
    UPDATE jobs
    SET status = 'failed',
        finished_at = ?,
        heartbeat_at = ?,
        lease_expires_at = NULL,
        progress_message = 'Failed after worker stopped.',
        error_message = 'Job worker stopped before completing this job.',
        updated_at = datetime('now')
    WHERE status = 'running'
      AND lease_expires_at IS NOT NULL
      AND datetime(lease_expires_at) <= datetime(?)
      AND attempts >= max_attempts
  `).run(nowIso, nowIso, nowIso)

  return Number(retryable.changes || 0) + Number(failed.changes || 0)
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function normalizeIdList(values) {
  if (values == null) return null
  return [...new Set((Array.isArray(values) ? values : [values])
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0))]
}
