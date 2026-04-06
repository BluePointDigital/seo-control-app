import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const fromIndex = process.argv.indexOf('--from')
const sourceDir = fromIndex >= 0 ? process.argv[fromIndex + 1] : ''

if (!sourceDir) {
  console.error('Usage: node scripts/restore-data.js --from <backup-directory>')
  process.exit(1)
}

const backupDir = path.resolve(sourceDir)
const backupDbPath = path.join(backupDir, 'app.db')
if (!fs.existsSync(backupDbPath)) {
  console.error(`Backup database not found at ${backupDbPath}`)
  process.exit(1)
}

const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, 'data'))
const dbPath = path.join(dataDir, 'app.db')
const reportsDir = path.join(dataDir, 'reports')
const backupsDir = path.join(dataDir, 'backups')
const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
const preRestoreDir = path.join(backupsDir, `pre-restore-${timestamp}`)

fs.mkdirSync(dataDir, { recursive: true })
fs.mkdirSync(preRestoreDir, { recursive: true })

if (fs.existsSync(dbPath)) {
  fs.copyFileSync(dbPath, path.join(preRestoreDir, 'app.db'))
}
if (fs.existsSync(reportsDir)) {
  fs.cpSync(reportsDir, path.join(preRestoreDir, 'reports'), { recursive: true })
}

for (const suffix of ['', '-wal', '-shm']) {
  const target = `${dbPath}${suffix}`
  if (fs.existsSync(target)) fs.rmSync(target, { force: true })
}

fs.copyFileSync(backupDbPath, dbPath)

const backupReportsDir = path.join(backupDir, 'reports')
if (fs.existsSync(backupReportsDir)) {
  fs.rmSync(reportsDir, { recursive: true, force: true })
  fs.cpSync(backupReportsDir, reportsDir, { recursive: true })
}

console.log(`Restored data from ${backupDir}`)
console.log(`Previous data snapshot saved at ${preRestoreDir}`)
console.log('Reminder: the restored app must use the same APP_MASTER_KEY that encrypted the saved credentials.')
