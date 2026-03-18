import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const outputDir = path.join(root, 'release', 'agency-seo-control-install-ready')
const itemsToCopy = [
  '.env.example',
  '.dockerignore',
  '.gitignore',
  '.nvmrc',
  '.node-version',
  'Dockerfile',
  'README.md',
  'INSTALL-WINDOWS.md',
  'package.json',
  'package-lock.json',
  'docker-compose.yml',
  'vite.config.js',
  'eslint.config.js',
  'index.html',
  'install-windows.ps1',
  'install-windows.cmd',
  'public',
  'scripts',
  'server',
  'src',
  'tests',
]

fs.rmSync(outputDir, { recursive: true, force: true })
fs.mkdirSync(outputDir, { recursive: true })

for (const relativePath of itemsToCopy) {
  const sourcePath = path.join(root, relativePath)
  const destinationPath = path.join(outputDir, relativePath)
  fs.cpSync(sourcePath, destinationPath, { recursive: true })
}

console.log(`Created install-ready package at ${outputDir}`)
