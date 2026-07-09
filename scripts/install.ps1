# One-line installer for @vivantel/virage (Windows PowerShell)
# Usage: irm https://raw.githubusercontent.com/vivantel/virage/master/scripts/install.ps1 | iex

$ErrorActionPreference = 'Stop'
$Package = '@vivantel/virage'

function Write-Info  { param($Msg) Write-Host $Msg -ForegroundColor Cyan }
function Write-Ok    { param($Msg) Write-Host "v $Msg" -ForegroundColor Green }
function Write-Warn  { param($Msg) Write-Host "! $Msg" -ForegroundColor Yellow }

# ── Node.js detection and installation ───────────────────────────────────────

function Ensure-Node {
  if (Get-Command node -ErrorAction SilentlyContinue) {
    $v = node --version
    Write-Ok "Node.js $v found"
    return
  }

  Write-Warn 'Node.js not found. Attempting to install Node.js LTS...'

  # winget
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    Write-Info 'Installing Node.js LTS via winget...'
    winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
    # Refresh PATH so node is available in the current session
    $env:PATH = [System.Environment]::GetEnvironmentVariable('PATH', 'Machine') + ';' +
                [System.Environment]::GetEnvironmentVariable('PATH', 'User')
    if (Get-Command node -ErrorAction SilentlyContinue) {
      Write-Ok "Node.js $(node --version) installed via winget"
      return
    }
  }

  # Chocolatey
  if (Get-Command choco -ErrorAction SilentlyContinue) {
    Write-Info 'Installing Node.js LTS via Chocolatey...'
    choco install nodejs-lts -y
    $env:PATH = [System.Environment]::GetEnvironmentVariable('PATH', 'Machine') + ';' +
                [System.Environment]::GetEnvironmentVariable('PATH', 'User')
    if (Get-Command node -ErrorAction SilentlyContinue) {
      Write-Ok "Node.js $(node --version) installed via Chocolatey"
      return
    }
  }

  Write-Error 'Could not install Node.js automatically. Download it from https://nodejs.org and re-run this script.'
  exit 1
}

# ── Main ─────────────────────────────────────────────────────────────────────

Write-Info 'Installing virage CLI...'
Ensure-Node

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Error 'npm not found. Please install npm alongside Node.js and retry.'
  exit 1
}

Write-Info "Running: npm install -g $Package"
npm install -g $Package

Write-Ok 'virage CLI installed successfully!'
Write-Info 'Get started: virage --version'
