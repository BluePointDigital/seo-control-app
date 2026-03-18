import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const cwd = process.cwd()
const examplePath = path.join(cwd, '.env.example')
const envPath = path.join(cwd, '.env')

function createSecret(length = 48) {
  return crypto.randomBytes(length).toString('base64url')
}

function upsertEnvValue(content, key, nextValue) {
  const pattern = new RegExp(`^${key}=.*$`, 'm')
  const line = `${key}=${nextValue}`
  if (pattern.test(content)) {
    return content.replace(pattern, line)
  }
  return `${content.trimEnd()}\n${line}\n`
}

if (!fs.existsSync(examplePath)) {
  throw new Error('Unable to find .env.example in the project root.')
}

const exampleContent = fs.readFileSync(examplePath, 'utf8')

if (!fs.existsSync(envPath)) {
  let nextContent = exampleContent
  nextContent = upsertEnvValue(nextContent, 'APP_MASTER_KEY', createSecret())
  nextContent = upsertEnvValue(nextContent, 'SESSION_SECRET', createSecret(32))
  fs.writeFileSync(envPath, nextContent)
  console.log('Created .env from .env.example with fresh local secrets.')
  process.exit(0)
}

console.log('.env already exists and was left unchanged.')
