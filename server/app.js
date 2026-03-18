import fs from 'fs'
import path from 'path'

import express from 'express'
import cors from 'cors'

import { resolveConfig } from './lib/config.js'
import { initializeDatabase } from './lib/database.js'
import { attachAuth } from './lib/http.js'
import { startBackgroundScheduler } from './lib/scheduler.js'
import { createSecurity } from './lib/security.js'
import { createAuthRouter } from './routes/auth.js'
import { createOperationsRouter } from './routes/operations.js'
import { createOrgRouter } from './routes/org.js'
import { createWorkspaceRouter } from './routes/workspaces.js'

export function createApp(overrides = {}) {
  const config = resolveConfig(overrides)
  const { db, backupInfo } = initializeDatabase(config)
  const security = createSecurity(config)
  const context = { config, db, security, backupInfo }

  const app = express()
  if (config.trustProxy) app.set('trust proxy', 1)
  app.disable('x-powered-by')
  app.use(cors({ origin: config.webOrigin, credentials: true }))
  app.use(express.json({ limit: '1mb' }))
  app.use(attachAuth(context))

  app.get('/api/health', (_req, res) => {
    const warnings = []
    if (['dev-only-key-change-me', 'change-this-long-random-string'].includes(config.appMasterKey)) {
      warnings.push('APP_MASTER_KEY is using a development default.')
    }
    if (['dev-session-secret-change-me'].includes(config.sessionSecret)) {
      warnings.push('SESSION_SECRET is using a development default.')
    }
    if (!config.google.clientId || !config.google.clientSecret) {
      warnings.push('Google OAuth is not fully configured in the environment.')
    }

    res.json({
      ok: true,
      mode: 'agency-saas-beta',
      publicSignupEnabled: config.publicSignupEnabled,
      backupInfo,
      warnings,
      scheduler: {
        enabled: config.schedulerEnabled,
        intervalMs: config.schedulerIntervalMs,
      },
    })
  })

  app.use('/api/auth', createAuthRouter(context))
  app.use('/api/org', createOrgRouter(context))
  app.use('/api/workspaces', createWorkspaceRouter(context))
  app.use('/api/workspaces', createOperationsRouter(context))

  const indexPath = path.join(config.distDir, 'index.html')
  if (config.nodeEnv === 'production' && fs.existsSync(indexPath)) {
    app.use(express.static(config.distDir))
    app.get(/^(?!\/api(?:\/|$)).*/, (_req, res) => {
      res.sendFile(indexPath)
    })
  }

  app.use((error, _req, res, _next) => {
    const status = Number(error?.status || 500)
    res.status(status).json({ error: error?.message || 'Internal server error.' })
  })

  const stopScheduler = startBackgroundScheduler(context)

  return {
    app,
    context,
    close() {
      stopScheduler()
      db.close()
    },
  }
}
