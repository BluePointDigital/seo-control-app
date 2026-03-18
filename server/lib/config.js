import path from 'path'

import { coerceBoolean } from './utils.js'

export function resolveConfig(overrides = {}) {
  const cwd = overrides.cwd || process.cwd()
  const dataDir = path.resolve(overrides.dataDir || process.env.DATA_DIR || path.join(cwd, 'data'))
  const dbPath = path.resolve(overrides.dbPath || path.join(dataDir, 'app.db'))
  const backupsDir = path.resolve(overrides.backupsDir || path.join(dataDir, 'backups'))
  const reportDir = path.resolve(overrides.reportDir || path.join(dataDir, 'reports'))
  const distDir = path.resolve(overrides.distDir || process.env.DIST_DIR || path.join(cwd, 'dist'))
  const port = Number(overrides.port || process.env.PORT || 8787)
  const nodeEnv = String(overrides.nodeEnv || process.env.NODE_ENV || 'development').trim().toLowerCase()
  const webOrigin = String(overrides.webOrigin || process.env.WEB_ORIGIN || 'http://localhost:5173').replace(/\/$/, '')
  const appBaseUrl = String(overrides.appBaseUrl || process.env.APP_BASE_URL || `http://localhost:${port}`).replace(/\/$/, '')
  const googleRedirectUri = String(
    overrides.googleRedirectUri ||
    process.env.GOOGLE_REDIRECT_URI ||
    `${appBaseUrl}/api/org/google/callback`,
  ).replace(/\/$/, '')

  return {
    port,
    nodeEnv,
    dataDir,
    dbPath,
    backupsDir,
    reportDir,
    distDir,
    webOrigin,
    appBaseUrl,
    appMasterKey: overrides.appMasterKey || process.env.APP_MASTER_KEY || 'dev-only-key-change-me',
    sessionSecret: overrides.sessionSecret || process.env.SESSION_SECRET || 'dev-session-secret-change-me',
    sessionDays: Number(overrides.sessionDays || process.env.SESSION_DAYS || 14),
    schedulerEnabled: overrides.schedulerEnabled ?? coerceBoolean(process.env.SCHEDULER_ENABLED ?? 'true'),
    schedulerIntervalMs: Number(overrides.schedulerIntervalMs || process.env.SCHEDULER_INTERVAL_MS || (15 * 60 * 1000)),
    secureCookies: coerceBoolean(
      overrides.secureCookies ?? process.env.SECURE_COOKIES ?? String(webOrigin.startsWith('https://')),
    ),
    trustProxy: coerceBoolean(
      overrides.trustProxy ?? process.env.TRUST_PROXY ?? 'false',
    ),
    publicSignupEnabled: coerceBoolean(
      overrides.publicSignupEnabled ?? process.env.PUBLIC_SIGNUP_ENABLED ?? 'true',
    ),
    google: {
      clientId: overrides.googleClientId || process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: overrides.googleClientSecret || process.env.GOOGLE_CLIENT_SECRET || '',
      redirectUri: googleRedirectUri,
    },
    smtp: {
      host: overrides.smtpHost || process.env.SMTP_HOST || '',
      port: Number(overrides.smtpPort || process.env.SMTP_PORT || 587),
      user: overrides.smtpUser || process.env.SMTP_USER || '',
      pass: overrides.smtpPass || process.env.SMTP_PASS || '',
      from: overrides.smtpFrom || process.env.SMTP_FROM || '',
    },
  }
}
