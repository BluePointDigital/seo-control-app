import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { assertSupportedRuntime, getRuntimeDiagnostics } from '../server/lib/runtime.js'

const phase = process.argv[2] || 'runtime'
const cwd = process.cwd()
const envPath = path.join(cwd, '.env')

function printWarnings() {
  if (fs.existsSync(envPath)) return
  if (!['doctor', 'dev', 'runtime'].includes(phase)) return

  console.warn([
    'No .env file was found in the project root.',
    'Run npm run setup to generate one from .env.example with fresh local secrets.',
  ].join('\n'))
}

async function main() {
  const diagnostics = getRuntimeDiagnostics()

  try {
    await assertSupportedRuntime()
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }

  printWarnings()

  if (phase === 'doctor') {
    console.log(`Runtime check passed on Node ${diagnostics.nodeVersion}.`)
    if (fs.existsSync(envPath)) {
      console.log('.env detected.')
    }
  }
}

main()
