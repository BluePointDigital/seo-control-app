import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { DatabaseSync } from 'node:sqlite'

const root = process.cwd()
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, 'data'))
const dbPath = path.join(dataDir, 'app.db')
const reportsDir = path.join(dataDir, 'reports')
const backupsDir = path.join(dataDir, 'backups')
const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
const outputDir = path.join(backupsDir, `manual-${timestamp}`)

fs.mkdirSync(outputDir, { recursive: true })

if (fs.existsSync(dbPath)) {
  const db = new DatabaseSync(dbPath)
  try {
    db.exec(`VACUUM INTO '${escapeSqlString(path.join(outputDir, 'app.db'))}'`)
  } finally {
    db.close()
  }
} else {
  console.warn(`No SQLite database found at ${dbPath}.`)
}

if (fs.existsSync(reportsDir)) {
  fs.cpSync(reportsDir, path.join(outputDir, 'reports'), { recursive: true })
}

fs.writeFileSync(path.join(outputDir, 'README.txt'), [
  'Agency SEO Control data backup',
  `Created: ${new Date().toISOString()}`,
  '',
  'Important: store the matching APP_MASTER_KEY separately and securely.',
  'Encrypted organization credentials cannot be decrypted without the same APP_MASTER_KEY.',
  '',
].join('\n'))

console.log(`Created data backup at ${outputDir}`)

function escapeSqlString(value) {
  return String(value).replace(/'/g, "''")
}
