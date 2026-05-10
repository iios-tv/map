$ErrorActionPreference = "Stop"
$RepoRoot = $PSScriptRoot

<#
  One-shot setup + run (Windows): venv, editable backend, npm build, start server.
  From repo root:  .\Run-iiosMap.ps1
  Or double-click: Run-iiosMap.bat
#>

function Find-PythonLauncher {
  $py = Get-Command py -ErrorAction SilentlyContinue
  if ($py) { return $py }
  $py = Get-Command python -ErrorAction SilentlyContinue
  if ($py) { return $py }
  Write-Error 'Python 3.11+ not found. Install from https://www.python.org/downloads/ and use "Add to PATH", or install the py launcher.'
  exit 1
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Error "Node.js / npm not found. Install Node 18+ from https://nodejs.org/ (needed to build the web UI)."
  exit 1
}

$pyCmd = Find-PythonLauncher
$venv = Join-Path $RepoRoot ".venv"
$venvPy = Join-Path $venv "Scripts\python.exe"

if (-not (Test-Path $venvPy)) {
  Write-Host "Creating .venv ..."
  & $pyCmd.Source -m venv $venv
}

Write-Host "Installing / updating Python dependencies (editable backend) ..."
& $venvPy -m pip install --upgrade pip
& $venvPy -m pip install -e (Join-Path $RepoRoot "backend")

$frontend = Join-Path $RepoRoot "frontend"
Push-Location $frontend
Write-Host "Installing npm dependencies ..."
npm install
Write-Host "Building frontend (npm run build) ..."
npm run build
Pop-Location

Write-Host ""
Write-Host "Starting iiosMap at http://127.0.0.1:8765/ (Ctrl+C to stop) ..."
$null = Start-Job { Start-Sleep -Seconds 2; Start-Process "http://127.0.0.1:8765/" }
& $venvPy -m iiosmap
