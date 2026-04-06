import fs from 'fs'
import path from 'path'

import { DatabaseSync } from 'node:sqlite'

import { runTransaction } from './utils.js'

const SCHEMA_VERSION = 'agency-saas-v3-api-tokens'

export function initializeDatabase(config) {
  fs.mkdirSync(config.dataDir, { recursive: true })
  fs.mkdirSync(config.backupsDir, { recursive: true })
  fs.mkdirSync(config.reportDir, { recursive: true })

  const backupInfo = backupLegacyDatabase(config.dbPath, config.backupsDir)
  const db = new DatabaseSync(config.dbPath)
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;')
  db.transaction = (action) => (...args) => runTransaction(db, () => action(...args))

  createSchema(db)
  migrateSchema(db)
  ensureIndexes(db)
  seedPrecisionPilot(db)

  db.prepare(`
    INSERT INTO app_meta (key, value, updated_at)
    VALUES ('schema_version', ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).run(SCHEMA_VERSION)

  if (backupInfo.performed) {
    db.prepare(`
      INSERT INTO app_meta (key, value, updated_at)
      VALUES ('legacy_backup_path', ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
    `).run(backupInfo.path)
  }

  return { db, backupInfo }
}

function backupLegacyDatabase(dbPath, backupsDir) {
  if (!fs.existsSync(dbPath)) {
    return { performed: false, path: null }
  }

  const probe = new DatabaseSync(dbPath, { readOnly: true })
  const tables = probe.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name)
  probe.close()

  const hasSaasTables = tables.includes('organizations') || tables.includes('users')
  const hasLegacyTables = ['projects', 'project_settings', 'app_config'].some((table) => tables.includes(table))
  if (hasSaasTables || !hasLegacyTables) {
    return { performed: false, path: null }
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = path.join(backupsDir, `app-pre-saas-${timestamp}.db`)
  fs.copyFileSync(dbPath, backupPath)
  fs.unlinkSync(dbPath)
  return { performed: true, path: backupPath }
}

function createSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      password_version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active',
      last_login_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS organizations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS organization_members (
      organization_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL UNIQUE,
      role TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      joined_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (organization_id, user_id),
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_hash TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      organization_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS invitations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL,
      email TEXT NOT NULL,
      role TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      invited_by_user_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      accepted_at TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
      FOREIGN KEY (invited_by_user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS oauth_states (
      state TEXT PRIMARY KEY,
      organization_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      provider TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS organization_credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL,
      provider TEXT NOT NULL,
      label TEXT NOT NULL,
      encrypted_value TEXT NOT NULL,
      metadata_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (organization_id, provider, label),
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS api_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL,
      label TEXT NOT NULL,
      token_prefix TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      scopes_json TEXT NOT NULL,
      expires_at TEXT,
      last_used_at TEXT,
      revoked_at TEXT,
      created_by_user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS workspaces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (organization_id, slug),
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS api_token_workspaces (
      token_id INTEGER NOT NULL,
      workspace_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (token_id, workspace_id),
      FOREIGN KEY (token_id) REFERENCES api_tokens(id) ON DELETE CASCADE,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS workspace_settings (
      workspace_id INTEGER NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (workspace_id, key),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL,
      workspace_id INTEGER,
      triggered_by_user_id INTEGER,
      triggered_by_api_token_id INTEGER,
      job_type TEXT NOT NULL,
      status TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '{}',
      available_at TEXT NOT NULL DEFAULT (datetime('now')),
      started_at TEXT,
      heartbeat_at TEXT,
      lease_expires_at TEXT,
      finished_at TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 2,
      progress_message TEXT NOT NULL DEFAULT '',
      result_json TEXT,
      error_message TEXT,
      dedupe_key TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL,
      FOREIGN KEY (triggered_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (triggered_by_api_token_id) REFERENCES api_tokens(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS rank_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      location_label TEXT NOT NULL DEFAULT '',
      search_location_id TEXT NOT NULL DEFAULT '',
      search_location_name TEXT NOT NULL DEFAULT '',
      business_name TEXT NOT NULL DEFAULT '',
      gl TEXT NOT NULL DEFAULT 'us',
      hl TEXT NOT NULL DEFAULT 'en',
      device TEXT NOT NULL DEFAULT 'desktop',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (workspace_id, slug),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS rank_keywords (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL,
      profile_id INTEGER NOT NULL,
      keyword TEXT NOT NULL,
      landing_page TEXT NOT NULL DEFAULT '',
      intent TEXT NOT NULL DEFAULT '',
      priority TEXT NOT NULL DEFAULT 'medium',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (profile_id, keyword),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
      FOREIGN KEY (profile_id) REFERENCES rank_profiles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS rank_daily (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL,
      profile_id INTEGER NOT NULL,
      keyword TEXT NOT NULL,
      date TEXT NOT NULL,
      position INTEGER,
      found_url TEXT,
      map_pack_position INTEGER,
      map_pack_found_url TEXT,
      map_pack_found_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (profile_id, keyword, date),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
      FOREIGN KEY (profile_id) REFERENCES rank_profiles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS competitor_rank_daily (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL,
      profile_id INTEGER NOT NULL,
      competitor_domain TEXT NOT NULL,
      keyword TEXT NOT NULL,
      date TEXT NOT NULL,
      position INTEGER,
      found_url TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (profile_id, competitor_domain, keyword, date),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
      FOREIGN KEY (profile_id) REFERENCES rank_profiles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS workspace_competitors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL,
      domain TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (workspace_id, domain),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS workspace_gsc_daily (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL,
      site_url TEXT NOT NULL,
      date TEXT NOT NULL,
      clicks REAL NOT NULL,
      impressions REAL NOT NULL,
      ctr REAL NOT NULL,
      position REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (workspace_id, site_url, date),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS workspace_ga4_daily (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL,
      property_id TEXT NOT NULL,
      date TEXT NOT NULL,
      sessions REAL NOT NULL,
      users REAL NOT NULL,
      new_users REAL NOT NULL,
      conversions REAL NOT NULL,
      engagement_rate REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (workspace_id, property_id, date),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS workspace_google_ads_daily (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL,
      customer_id TEXT NOT NULL,
      date TEXT NOT NULL,
      clicks REAL NOT NULL,
      impressions REAL NOT NULL,
      ctr REAL NOT NULL,
      conversions REAL NOT NULL,
      cost_micros REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (workspace_id, customer_id, date),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS site_audit_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL,
      audited_url TEXT NOT NULL,
      health_score REAL NOT NULL,
      issues_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS workspace_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL,
      profile_id INTEGER,
      keyword TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL,
      alert_type TEXT NOT NULL,
      severity TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      payload_json TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      detected_at TEXT NOT NULL,
      resolved_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
      FOREIGN KEY (profile_id) REFERENCES rank_profiles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS report_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL,
      report_type TEXT NOT NULL,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'completed',
      content_markdown TEXT NOT NULL,
      summary_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_org_user ON sessions(organization_id, user_id);
    CREATE INDEX IF NOT EXISTS idx_api_tokens_org ON api_tokens(organization_id, revoked_at, expires_at);
    CREATE INDEX IF NOT EXISTS idx_api_token_workspaces_workspace ON api_token_workspaces(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_org_workspace ON jobs(organization_id, workspace_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_reports_workspace ON report_runs(workspace_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_workspace ON site_audit_runs(workspace_id, created_at DESC);
  `)
}

function ensureIndexes(db) {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_rank_profiles_workspace ON rank_profiles(workspace_id, active, name);
    CREATE INDEX IF NOT EXISTS idx_rank_keywords_workspace ON rank_keywords(workspace_id, profile_id, active);
    CREATE INDEX IF NOT EXISTS idx_rank_daily_workspace ON rank_daily(workspace_id, profile_id, date DESC);
    CREATE INDEX IF NOT EXISTS idx_competitor_rank_workspace ON competitor_rank_daily(workspace_id, profile_id, date DESC);
    CREATE INDEX IF NOT EXISTS idx_workspace_alerts_workspace ON workspace_alerts(workspace_id, status, detected_at DESC);
  `)
}

function migrateSchema(db) {
  db.transaction(() => {
    rebuildRankKeywordsTableIfNeeded(db)
    rebuildRankDailyTableIfNeeded(db)
    rebuildCompetitorRankDailyTableIfNeeded(db)
    ensureJobsApiTokenColumn(db)
    ensureJobQueueColumns(db)
    ensureRankProfileLocationColumns(db)
    ensureRankDailyMapPackColumns(db)
    ensureWorkspaceDefaults(db)
  })()
}

function ensureJobsApiTokenColumn(db) {
  if (!tableExists(db, 'jobs') || hasColumn(db, 'jobs', 'triggered_by_api_token_id')) return

  db.exec(`
    ALTER TABLE jobs
    ADD COLUMN triggered_by_api_token_id INTEGER REFERENCES api_tokens(id) ON DELETE SET NULL;
  `)
}

function ensureJobQueueColumns(db) {
  if (!tableExists(db, 'jobs')) return

  const columns = [
    ['details', "TEXT NOT NULL DEFAULT '{}'"],
    ['available_at', 'TEXT'],
    ['started_at', 'TEXT'],
    ['heartbeat_at', 'TEXT'],
    ['lease_expires_at', 'TEXT'],
    ['finished_at', 'TEXT'],
    ['attempts', 'INTEGER NOT NULL DEFAULT 0'],
    ['max_attempts', 'INTEGER NOT NULL DEFAULT 2'],
    ['progress_message', "TEXT NOT NULL DEFAULT ''"],
    ['result_json', 'TEXT'],
    ['error_message', 'TEXT'],
    ['dedupe_key', 'TEXT'],
  ]

  for (const [columnName, definition] of columns) {
    if (hasColumn(db, 'jobs', columnName)) continue
    db.exec(`ALTER TABLE jobs ADD COLUMN ${columnName} ${definition};`)
  }

  db.exec(`
    UPDATE jobs
    SET details = COALESCE(details, '{}'),
        available_at = COALESCE(available_at, created_at),
        attempts = COALESCE(attempts, CASE WHEN status IN ('completed', 'failed') THEN 1 ELSE 0 END),
        max_attempts = COALESCE(max_attempts, 2),
        progress_message = COALESCE(progress_message, ''),
        updated_at = COALESCE(updated_at, created_at);

    CREATE INDEX IF NOT EXISTS idx_jobs_queue ON jobs(status, available_at, id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_active_dedupe ON jobs(dedupe_key)
      WHERE dedupe_key IS NOT NULL AND status IN ('queued', 'running');
  `)
}

function rebuildRankKeywordsTableIfNeeded(db) {
  if (!tableExists(db, 'rank_keywords') || hasColumn(db, 'rank_keywords', 'profile_id')) return

  db.exec(`
    CREATE TABLE rank_keywords_next (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL,
      profile_id INTEGER NOT NULL,
      keyword TEXT NOT NULL,
      landing_page TEXT NOT NULL DEFAULT '',
      intent TEXT NOT NULL DEFAULT '',
      priority TEXT NOT NULL DEFAULT 'medium',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (profile_id, keyword),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
      FOREIGN KEY (profile_id) REFERENCES rank_profiles(id) ON DELETE CASCADE
    );
  `)

  for (const row of db.prepare('SELECT DISTINCT workspace_id FROM rank_keywords').all()) {
    ensurePrimaryProfile(db, Number(row.workspace_id))
  }

  db.exec(`
    INSERT INTO rank_keywords_next (id, workspace_id, profile_id, keyword, landing_page, intent, priority, active, created_at)
    SELECT rk.id, rk.workspace_id, rp.id, rk.keyword, '', '', 'medium', rk.active, rk.created_at
    FROM rank_keywords rk
    JOIN rank_profiles rp ON rp.workspace_id = rk.workspace_id AND rp.slug = 'primary-market';
    DROP TABLE rank_keywords;
    ALTER TABLE rank_keywords_next RENAME TO rank_keywords;
    CREATE INDEX IF NOT EXISTS idx_rank_keywords_workspace ON rank_keywords(workspace_id, profile_id, active);
  `)
}

function rebuildRankDailyTableIfNeeded(db) {
  if (!tableExists(db, 'rank_daily') || hasColumn(db, 'rank_daily', 'profile_id')) return

  db.exec(`
    CREATE TABLE rank_daily_next (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL,
      profile_id INTEGER NOT NULL,
      keyword TEXT NOT NULL,
      date TEXT NOT NULL,
      position INTEGER,
      found_url TEXT,
      map_pack_position INTEGER,
      map_pack_found_url TEXT,
      map_pack_found_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (profile_id, keyword, date),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
      FOREIGN KEY (profile_id) REFERENCES rank_profiles(id) ON DELETE CASCADE
    );
  `)

  for (const row of db.prepare('SELECT DISTINCT workspace_id FROM rank_daily').all()) {
    ensurePrimaryProfile(db, Number(row.workspace_id))
  }

  db.exec(`
    INSERT INTO rank_daily_next (id, workspace_id, profile_id, keyword, date, position, found_url, created_at)
    SELECT rd.id, rd.workspace_id, rp.id, rd.keyword, rd.date, rd.position, rd.found_url, rd.created_at
    FROM rank_daily rd
    JOIN rank_profiles rp ON rp.workspace_id = rd.workspace_id AND rp.slug = 'primary-market';
    DROP TABLE rank_daily;
    ALTER TABLE rank_daily_next RENAME TO rank_daily;
    CREATE INDEX IF NOT EXISTS idx_rank_daily_workspace ON rank_daily(workspace_id, profile_id, date DESC);
  `)
}

function rebuildCompetitorRankDailyTableIfNeeded(db) {
  if (!tableExists(db, 'competitor_rank_daily') || hasColumn(db, 'competitor_rank_daily', 'profile_id')) return

  db.exec(`
    CREATE TABLE competitor_rank_daily_next (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL,
      profile_id INTEGER NOT NULL,
      competitor_domain TEXT NOT NULL,
      keyword TEXT NOT NULL,
      date TEXT NOT NULL,
      position INTEGER,
      found_url TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (profile_id, competitor_domain, keyword, date),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
      FOREIGN KEY (profile_id) REFERENCES rank_profiles(id) ON DELETE CASCADE
    );
  `)

  for (const row of db.prepare('SELECT DISTINCT workspace_id FROM competitor_rank_daily').all()) {
    ensurePrimaryProfile(db, Number(row.workspace_id))
  }

  db.exec(`
    INSERT INTO competitor_rank_daily_next (id, workspace_id, profile_id, competitor_domain, keyword, date, position, found_url, created_at)
    SELECT crd.id, crd.workspace_id, rp.id, crd.competitor_domain, crd.keyword, crd.date, crd.position, crd.found_url, crd.created_at
    FROM competitor_rank_daily crd
    JOIN rank_profiles rp ON rp.workspace_id = crd.workspace_id AND rp.slug = 'primary-market';
    DROP TABLE competitor_rank_daily;
    ALTER TABLE competitor_rank_daily_next RENAME TO competitor_rank_daily;
    CREATE INDEX IF NOT EXISTS idx_competitor_rank_workspace ON competitor_rank_daily(workspace_id, profile_id, date DESC);
  `)
}

function ensureWorkspaceDefaults(db) {
  const workspaces = db.prepare('SELECT id FROM workspaces').all().map((row) => Number(row.id))
  for (const workspaceId of workspaces) {
    upsertWorkspaceSetting(db, workspaceId, 'rank_gl', getWorkspaceSetting(db, workspaceId, 'rank_gl', 'us'))
    upsertWorkspaceSetting(db, workspaceId, 'rank_hl', getWorkspaceSetting(db, workspaceId, 'rank_hl', 'en'))
    upsertWorkspaceSetting(db, workspaceId, 'rank_sync_frequency', getWorkspaceSetting(db, workspaceId, 'rank_sync_frequency', 'weekly'))
    upsertWorkspaceSetting(db, workspaceId, 'rank_sync_weekday', getWorkspaceSetting(db, workspaceId, 'rank_sync_weekday', '1'))
    upsertWorkspaceSetting(db, workspaceId, 'rank_sync_hour', getWorkspaceSetting(db, workspaceId, 'rank_sync_hour', '6'))
    upsertWorkspaceSetting(db, workspaceId, 'audit_max_pages', getWorkspaceSetting(db, workspaceId, 'audit_max_pages', '25'))
  }
}

function ensureRankProfileLocationColumns(db) {
  if (!tableExists(db, 'rank_profiles')) return

  if (!hasColumn(db, 'rank_profiles', 'search_location_id')) {
    db.exec(`
      ALTER TABLE rank_profiles
      ADD COLUMN search_location_id TEXT NOT NULL DEFAULT '';
    `)
  }

  if (!hasColumn(db, 'rank_profiles', 'search_location_name')) {
    db.exec(`
      ALTER TABLE rank_profiles
      ADD COLUMN search_location_name TEXT NOT NULL DEFAULT '';
    `)
  }

  if (!hasColumn(db, 'rank_profiles', 'business_name')) {
    db.exec(`
      ALTER TABLE rank_profiles
      ADD COLUMN business_name TEXT NOT NULL DEFAULT '';
    `)
  }

  db.exec(`
    UPDATE rank_profiles
    SET search_location_name = CASE
      WHEN search_location_name != '' THEN search_location_name
      WHEN location_label != '' THEN location_label
      ELSE ''
    END;

    UPDATE rank_profiles
    SET business_name = CASE
      WHEN business_name != '' THEN business_name
      ELSE name
    END;
  `)
}

function ensureRankDailyMapPackColumns(db) {
  if (!tableExists(db, 'rank_daily')) return

  if (!hasColumn(db, 'rank_daily', 'map_pack_position')) {
    db.exec(`
      ALTER TABLE rank_daily
      ADD COLUMN map_pack_position INTEGER;
    `)
  }

  if (!hasColumn(db, 'rank_daily', 'map_pack_found_url')) {
    db.exec(`
      ALTER TABLE rank_daily
      ADD COLUMN map_pack_found_url TEXT;
    `)
  }

  if (!hasColumn(db, 'rank_daily', 'map_pack_found_name')) {
    db.exec(`
      ALTER TABLE rank_daily
      ADD COLUMN map_pack_found_name TEXT;
    `)
  }
}

function seedPrecisionPilot(db) {
  const workspace = db.prepare(`
    SELECT id
    FROM workspaces
    WHERE slug = 'precision-garage-door'
    LIMIT 1
  `).get()

  if (!workspace) return

  const workspaceId = Number(workspace.id)
  const seededKey = `precision-rank-pilot-seeded-${workspaceId}`
  if (db.prepare('SELECT value FROM app_meta WHERE key = ?').get(seededKey)) return

  const profileCount = Number(db.prepare('SELECT COUNT(*) AS count FROM rank_profiles WHERE workspace_id = ?').get(workspaceId).count || 0)
  const keywordCount = Number(db.prepare('SELECT COUNT(*) AS count FROM rank_keywords WHERE workspace_id = ?').get(workspaceId).count || 0)
  if (profileCount > 0 || keywordCount > 0) {
    db.prepare(`
      INSERT INTO app_meta (key, value, updated_at)
      VALUES (?, 'skipped', datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = 'skipped', updated_at = datetime('now')
    `).run(seededKey)
    return
  }

  const gl = getWorkspaceSetting(db, workspaceId, 'rank_gl', 'us')
  const hl = getWorkspaceSetting(db, workspaceId, 'rank_hl', 'en')
  const profiles = [
    {
      name: 'Spartanburg Repair',
      slug: 'spartanburg-repair',
      locationLabel: 'Spartanburg, SC',
      keyword: 'garage door repair spartanburg sc',
      landingPage: 'https://www.precision-door.com/service-locations/spartanburg-sc/',
      intent: 'repair',
      priority: 'high',
    },
    {
      name: 'Spartanburg Springs',
      slug: 'spartanburg-springs',
      locationLabel: 'Spartanburg, SC',
      keyword: 'broken garage door spring spartanburg',
      landingPage: 'https://www.precision-door.com/service-locations/spartanburg-sc/',
      intent: 'repair',
      priority: 'high',
    },
    {
      name: 'Southwest Virginia Repairs',
      slug: 'southwest-virginia-repairs',
      locationLabel: 'Southwest Virginia',
      keyword: 'garage door repairs in sw virginia',
      landingPage: 'https://www.precision-door.com/service-locations/sw-virginia/',
      intent: 'repair',
      priority: 'high',
    },
    {
      name: 'Western NC Install',
      slug: 'western-nc-install',
      locationLabel: 'Western North Carolina',
      keyword: 'garage door installation western north carolina',
      landingPage: 'https://www.precision-door.com/service-locations/western-nc/',
      intent: 'installation',
      priority: 'high',
    },
    {
      name: 'Upstate Commercial',
      slug: 'upstate-commercial',
      locationLabel: 'Upstate SC',
      keyword: 'commercial garage doors upstate sc',
      landingPage: 'https://www.precision-door.com/commercial-garage-doors/',
      intent: 'commercial',
      priority: 'high',
    },
  ]

  for (const profile of profiles) {
    const result = db.prepare(`
      INSERT INTO rank_profiles (workspace_id, name, slug, location_label, search_location_id, search_location_name, business_name, gl, hl, device, active)
      VALUES (?, ?, ?, ?, '', ?, ?, ?, ?, 'desktop', 1)
    `).run(workspaceId, profile.name, profile.slug, profile.locationLabel, profile.locationLabel, profile.name, gl, hl)

    db.prepare(`
      INSERT INTO rank_keywords (workspace_id, profile_id, keyword, landing_page, intent, priority, active)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `).run(workspaceId, Number(result.lastInsertRowid), profile.keyword, profile.landingPage, profile.intent, profile.priority)
  }

  db.prepare(`
    INSERT INTO app_meta (key, value, updated_at)
    VALUES (?, 'seeded', datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = 'seeded', updated_at = datetime('now')
  `).run(seededKey)
}

function ensurePrimaryProfile(db, workspaceId) {
  const existing = db.prepare(`
    SELECT id
    FROM rank_profiles
    WHERE workspace_id = ? AND slug = 'primary-market'
    LIMIT 1
  `).get(Number(workspaceId))

  if (existing) return Number(existing.id)

  const name = 'Primary Market'
  const gl = getWorkspaceSetting(db, workspaceId, 'rank_gl', 'us')
  const hl = getWorkspaceSetting(db, workspaceId, 'rank_hl', 'en')
  const result = db.prepare(`
    INSERT INTO rank_profiles (workspace_id, name, slug, location_label, search_location_id, search_location_name, business_name, gl, hl, device, active)
    VALUES (?, ?, 'primary-market', '', '', '', ?, ?, ?, 'desktop', 1)
  `).run(Number(workspaceId), name, name, gl, hl)
  return Number(result.lastInsertRowid)
}

function tableExists(db, tableName) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName))
}

function hasColumn(db, tableName, columnName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all().some((row) => row.name === columnName)
}

function getWorkspaceSetting(db, workspaceId, keyName, fallback = '') {
  const row = db.prepare('SELECT value FROM workspace_settings WHERE workspace_id = ? AND key = ?').get(Number(workspaceId), keyName)
  return row?.value ?? fallback
}

function upsertWorkspaceSetting(db, workspaceId, keyName, value) {
  db.prepare(`
    INSERT INTO workspace_settings (workspace_id, key, value, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(workspace_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).run(Number(workspaceId), keyName, String(value ?? ''))
}
