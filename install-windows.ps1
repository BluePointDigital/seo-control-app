param(
  [switch]$StartAfterInstall
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

function Write-Step($message) {
  Write-Host "`n==> $message" -ForegroundColor Cyan
}

function Fail($message) {
  Write-Host "`nInstall failed." -ForegroundColor Red
  Write-Host $message -ForegroundColor Red
  exit 1
}

Set-Location $projectRoot

Write-Step 'Checking Node.js'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Fail 'Node.js is not installed. Install Node 24 or newer, then run this installer again.'
}

$nodeVersion = (& node -p "process.versions.node").Trim()
$nodeMajor = [int]((& node -p "process.versions.node.split('.')[0]").Trim())
if ($nodeMajor -lt 24) {
  Fail "Node 24 or newer is required. This machine is running Node $nodeVersion."
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Fail 'npm is not available on this machine. Install the official Node.js 24 package, then run this installer again.'
}

Write-Step 'Installing dependencies with npm'
& npm.cmd install
if ($LASTEXITCODE -ne 0) {
  Fail 'npm install did not complete successfully.'
}

Write-Step 'Creating local environment file if needed'
& npm.cmd run setup
if ($LASTEXITCODE -ne 0) {
  Fail 'npm run setup did not complete successfully.'
}

Write-Step 'Running environment checks'
& npm.cmd run doctor
if ($LASTEXITCODE -ne 0) {
  Fail 'npm run doctor reported an invalid runtime or missing setup.'
}

Write-Host "`nInstall complete." -ForegroundColor Green
Write-Host 'Next steps:' -ForegroundColor Green
Write-Host '  1. Review .env if you need to add Google credentials or other integration settings.' -ForegroundColor Green
Write-Host '  2. Run npm run dev to start the web app and API.' -ForegroundColor Green
Write-Host '  3. Open http://localhost:5173 once the app is running.' -ForegroundColor Green

if ($StartAfterInstall) {
  Write-Step 'Starting the app'
  & npm.cmd run dev
  exit $LASTEXITCODE
}
