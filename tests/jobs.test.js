import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { createApp } from '../server/app.js'
import { runClaimedJob } from '../server/lib/jobWorker.js'
import {
  claimNextJob,
  completeJob,
  enqueueJob,
  failJob,
  getJobById,
  getJobQueueStats,
  heartbeatJob,
  recoverStaleJobs,
} from '../server/lib/jobs.js'

function createTempPaths() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seo-jobs-'))
  return {
    dataDir,
    dbPath: path.join(dataDir, 'app.db'),
    backupsDir: path.join(dataDir, 'backups'),
    reportDir: path.join(dataDir, 'reports'),
  }
}

function startQueueTestApp(t) {
  const paths = createTempPaths()
  const instance = createApp({
    ...paths,
    publicSignupEnabled: true,
    appMasterKey: 'test-master-key',
    sessionSecret: 'test-session-secret',
    schedulerEnabled: false,
    jobWorkerEnabled: false,
  })

  t.after(() => {
    instance.close()
    fs.rmSync(paths.dataDir, { recursive: true, force: true })
  })

  return { ...paths, context: instance.context }
}

function createQueueWorkspace(db) {
  const organizationId = Number(db.prepare(`
    INSERT INTO organizations (name, slug)
    VALUES ('Queue Agency', 'queue-agency')
  `).run().lastInsertRowid)
  const workspaceId = Number(db.prepare(`
    INSERT INTO workspaces (organization_id, name, slug)
    VALUES (?, 'Queue Client', 'queue-client')
  `).run(organizationId).lastInsertRowid)
  return { organizationId, workspaceId }
}

test('job queue dedupes active jobs and tracks claim, heartbeat, and completion state', (t) => {
  const { context } = startQueueTestApp(t)
  const { organizationId, workspaceId } = createQueueWorkspace(context.db)
  const details = { source: 'rank', profileId: 7 }

  const first = enqueueJob(context.db, {
    organizationId,
    workspaceId,
    jobType: 'workspace_sync',
    details,
    maxAttempts: 2,
    availableAt: '2026-04-06T11:59:00.000Z',
  })
  assert.equal(first.deduped, false)
  assert.equal(first.job.status, 'queued')

  const duplicate = enqueueJob(context.db, {
    organizationId,
    workspaceId,
    jobType: 'workspace_sync',
    details,
  })
  assert.equal(duplicate.deduped, true)
  assert.equal(duplicate.job.id, first.job.id)

  const claimed = claimNextJob(context.db, {
    now: new Date('2026-04-06T12:00:00.000Z'),
    leaseSeconds: 60,
  })
  assert.equal(claimed.id, first.job.id)
  assert.equal(claimed.status, 'running')
  assert.equal(claimed.attempts, 1)
  assert.equal(claimed.progressMessage, 'Running.')

  heartbeatJob(context.db, claimed.id, {
    now: new Date('2026-04-06T12:00:10.000Z'),
    leaseSeconds: 60,
    progressMessage: 'Still syncing.',
  })
  const heartbeated = getJobById(context.db, claimed.id)
  assert.equal(heartbeated.progressMessage, 'Still syncing.')
  assert.equal(heartbeated.heartbeatAt, '2026-04-06T12:00:10.000Z')

  const completed = completeJob(context.db, claimed.id, { rank: { keywordsChecked: 3 } }, 'Done.')
  assert.equal(completed.status, 'completed')
  assert.deepEqual(completed.result, { rank: { keywordsChecked: 3 } })
  assert.equal(completed.progressMessage, 'Done.')

  const afterCompletion = enqueueJob(context.db, {
    organizationId,
    workspaceId,
    jobType: 'workspace_sync',
    details,
  })
  assert.equal(afterCompletion.deduped, false)
  assert.notEqual(afterCompletion.job.id, first.job.id)

  const stats = getJobQueueStats(context.db)
  assert.equal(stats.completed, 1)
  assert.equal(stats.queued, 1)
})

test('job queue retries failures and recovers stale leases', (t) => {
  const { context } = startQueueTestApp(t)
  const { organizationId, workspaceId } = createQueueWorkspace(context.db)

  const retryable = enqueueJob(context.db, {
    organizationId,
    workspaceId,
    jobType: 'workspace_sync',
    details: { source: 'rank', profileId: 10 },
    maxAttempts: 2,
    availableAt: '2026-04-06T11:59:00.000Z',
  }).job
  const firstAttempt = claimNextJob(context.db, { now: new Date('2026-04-06T12:00:00.000Z') })
  assert.equal(firstAttempt.id, retryable.id)
  const retried = failJob(context.db, firstAttempt, new Error('Temporary outage.'), { retryDelayMs: 0 })
  assert.equal(retried.status, 'queued')
  assert.equal(retried.errorMessage, 'Temporary outage.')

  context.db.prepare(`
    UPDATE jobs
    SET available_at = '2026-04-06T12:00:00.000Z'
    WHERE id = ?
  `).run(retryable.id)
  const secondAttempt = claimNextJob(context.db, { now: new Date('2026-04-06T12:00:01.000Z') })
  assert.equal(secondAttempt.id, retryable.id)
  const failed = failJob(context.db, secondAttempt, new Error('Still down.'), { retryDelayMs: 0 })
  assert.equal(failed.status, 'failed')
  assert.equal(failed.errorMessage, 'Still down.')

  const stale = enqueueJob(context.db, {
    organizationId,
    workspaceId,
    jobType: 'workspace_sync',
    details: { source: 'rank', profileId: 11 },
    maxAttempts: 2,
    availableAt: '2026-04-06T11:59:00.000Z',
  }).job
  const staleClaim = claimNextJob(context.db, {
    now: new Date('2026-04-06T12:00:00.000Z'),
    leaseSeconds: 30,
  })
  assert.equal(staleClaim.id, stale.id)

  context.db.prepare(`
    UPDATE jobs
    SET lease_expires_at = '2026-04-06T12:00:00.000Z'
    WHERE id = ?
  `).run(stale.id)
  assert.equal(recoverStaleJobs(context.db, { now: new Date('2026-04-06T12:01:00.000Z') }), 1)
  const recovered = getJobById(context.db, stale.id)
  assert.equal(recovered.status, 'queued')
  assert.match(recovered.errorMessage, /worker stopped/i)
  completeJob(context.db, stale.id, {}, 'Recovered test job complete.')

  const exhausted = enqueueJob(context.db, {
    organizationId,
    workspaceId,
    jobType: 'workspace_sync',
    details: { source: 'rank', profileId: 12 },
    maxAttempts: 1,
    availableAt: '2026-04-06T12:01:00.000Z',
  }).job
  const exhaustedClaim = claimNextJob(context.db, {
    now: new Date('2026-04-06T12:02:00.000Z'),
    leaseSeconds: 30,
  })
  assert.equal(exhaustedClaim.id, exhausted.id)

  context.db.prepare(`
    UPDATE jobs
    SET lease_expires_at = '2026-04-06T12:02:00.000Z'
    WHERE id = ?
  `).run(exhausted.id)
  assert.equal(recoverStaleJobs(context.db, { now: new Date('2026-04-06T12:03:00.000Z') }), 1)
  const failedStale = getJobById(context.db, exhausted.id)
  assert.equal(failedStale.status, 'failed')
  assert.match(failedStale.errorMessage, /worker stopped/i)
})

test('in-process job worker records failed job status for unsupported work', async (t) => {
  const { context } = startQueueTestApp(t)
  const { organizationId, workspaceId } = createQueueWorkspace(context.db)

  const queued = enqueueJob(context.db, {
    organizationId,
    workspaceId,
    jobType: 'unsupported_job',
    details: {},
    maxAttempts: 1,
    availableAt: '2026-04-06T11:59:00.000Z',
  }).job
  const claimed = claimNextJob(context.db, { now: new Date('2026-04-06T12:00:00.000Z') })
  assert.equal(claimed.id, queued.id)

  await runClaimedJob(context, {
    activeJobId: null,
    lastHeartbeatAt: null,
    lastError: '',
  }, claimed)

  const failed = getJobById(context.db, queued.id)
  assert.equal(failed.status, 'failed')
  assert.match(failed.errorMessage, /Unsupported job type/)
})
