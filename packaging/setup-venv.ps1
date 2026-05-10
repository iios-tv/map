$ErrorActionPreference = "Stop"
$Here = $PSScriptRoot

$pyCmd = Get-Command py -ErrorAction SilentlyContinue
if (-not $pyCmd) { $pyCmd = Get-Command python -ErrorAction SilentlyContinue }
if (-not $pyCmd) {
  Write-Error "Python 3.11+ not found on PATH. Install from https://www.python.org/downloads/"
  exit 1
}

$venv = Join-Path $Here ".venv"
& $pyCmd.Source -m venv $venv
$pip = Join-Path $venv "Scripts\pip.exe"
& $pip install --upgrade pip

$wheels = Join-Path $Here "wheels"
if (-not (Test-Path $wheels)) {
  Write-Error "Missing wheels/ folder (expected iiosmap-*.whl)."
  exit 1
}
Get-ChildItem (Join-Path $wheels "*.whl") | ForEach-Object {
  Write-Host "Installing $($_.Name)..."
  & $pip install $_.FullName
}
Write-Host "Done. Run Start-iiosMap.ps1 and open http://127.0.0.1:8765/"
