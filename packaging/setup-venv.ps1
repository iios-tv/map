$ErrorActionPreference = "Stop"
$Here = $PSScriptRoot

$pyCmd = Get-Command py -ErrorAction SilentlyContinue
if (-not $pyCmd) { $pyCmd = Get-Command python -ErrorAction SilentlyContinue }
if (-not $pyCmd) {
  Write-Error "Python 3.11+ not found on PATH. Install from https://www.python.org/downloads/"
  exit 1
}

$venv = Join-Path $Here ".venv"
$venvPy = Join-Path $venv "Scripts\python.exe"

if (-not (Test-Path $venvPy)) {
  Write-Host "Creating virtual environment in .venv ..."
  & $pyCmd.Source -m venv $venv
} else {
  Write-Host "Using existing .venv"
}

# Always use python -m pip (avoids Windows warning about modifying pip)
& $venvPy -m pip install --upgrade pip

$backendToml = Join-Path $Here "..\backend\pyproject.toml"
$wheelsDir = Join-Path $Here "wheels"
$wheel = Get-ChildItem -Path $wheelsDir -Filter "iiosmap-*.whl" -ErrorAction SilentlyContinue | Select-Object -First 1

if (Test-Path $backendToml) {
  $backend = Split-Path $backendToml -Parent
  Write-Host "Installing backend in editable mode from: $backend"
  & $venvPy -m pip install -e $backend
} elseif ($wheel) {
  Write-Host "Installing $($wheel.Name) ..."
  & $venvPy -m pip install $wheel.FullName
} else {
  Write-Error @"
No iiosmap install source found.

  - Git clone: run this script from the repo's packaging\ folder (sibling of backend\).
  - Portable ZIP: use the folder produced by scripts\build-portable.ps1 (includes wheels\).

"@
  exit 1
}

Write-Host "Done. Run Start-iiosMap.ps1 and open http://127.0.0.1:8765/"
Write-Host "Tip: from a dev clone, build the UI once: cd ..\frontend ; npm install ; npm run build"
