import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const outputDir = path.join(root, 'release', 'agency-seo-control-portable')
const packageJsonPath = path.join(root, 'package.json')
const packageLockPath = path.join(root, 'package-lock.json')
const basePackage = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))

const copyFiles = [
  '.env.example',
  '.dockerignore',
  '.nvmrc',
  '.node-version',
  'Dockerfile',
  'INSTALL-WINDOWS.md',
  'README.md',
  'docker-compose.yml',
  'index.html',
  'install-windows.cmd',
  'install-windows.ps1',
  'package-lock.json',
  'vite.config.js',
]

const copyDirectories = [
  'public',
  'server',
  'src',
]

const portablePackage = {
  ...basePackage,
  scripts: {
    preinstall: 'node scripts/check-runtime.js install',
    setup: 'node scripts/setup.js',
    doctor: 'node scripts/check-runtime.js doctor',
    predev: 'node scripts/check-runtime.js dev',
    prebuild: 'node scripts/check-runtime.js build',
    dev: 'concurrently --names web,api --kill-others-on-fail "npm run dev:web" "npm run dev:api"',
    'dev:web': 'vite',
    'dev:api': 'node server/index.js',
    build: 'vite build',
    'backup:data': 'node scripts/backup-data.js',
    'restore:data': 'node scripts/restore-data.js',
    preview: 'vite preview',
  },
}

const portableReadme = `# Agency SEO Control (Portable Package)

This is the slim install package for running the app on another Windows machine.

## What is included
- frontend source
- API source
- install scripts
- runtime setup scripts
- package metadata needed for npm install

## What is intentionally excluded
- .env
- local data and databases
- dist build output
- node_modules
- tests and lint-only files
- export helper scripts used only in the main workspace

## Install on another Windows machine
1. Install Node 24.x.
2. Open this folder.
3. Run install-windows.cmd.
4. After install finishes, run npm run dev.
5. Open http://localhost:5173.

## Notes
- The installer creates .env from .env.example if needed.
- Add your Google OAuth credentials and other integration settings to .env after install.
- This package is for install/run, not for development validation inside the main repo.
`

fs.rmSync(outputDir, { recursive: true, force: true })
fs.mkdirSync(outputDir, { recursive: true })
fs.mkdirSync(path.join(outputDir, 'scripts'), { recursive: true })

for (const relativePath of copyFiles) {
  fs.cpSync(path.join(root, relativePath), path.join(outputDir, relativePath), { recursive: true })
}

for (const relativePath of copyDirectories) {
  fs.cpSync(path.join(root, relativePath), path.join(outputDir, relativePath), { recursive: true })
}

fs.cpSync(path.join(root, 'scripts', 'check-runtime.js'), path.join(outputDir, 'scripts', 'check-runtime.js'))
fs.cpSync(path.join(root, 'scripts', 'setup.js'), path.join(outputDir, 'scripts', 'setup.js'))
fs.cpSync(path.join(root, 'scripts', 'backup-data.js'), path.join(outputDir, 'scripts', 'backup-data.js'))
fs.cpSync(path.join(root, 'scripts', 'restore-data.js'), path.join(outputDir, 'scripts', 'restore-data.js'))
fs.writeFileSync(path.join(outputDir, 'package.json'), JSON.stringify(portablePackage, null, 2) + '\n')
fs.writeFileSync(path.join(outputDir, 'README.md'), portableReadme)
console.log(`Created portable package at ${outputDir}`)
console.log(`Package lock source: ${packageLockPath}`)
