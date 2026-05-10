$ErrorActionPreference = "Stop"
$Here = $PSScriptRoot
$env:IIOSMAP_APP_ROOT = Join-Path $Here "app"
$py = Join-Path $Here ".venv\Scripts\python.exe"
if (-not (Test-Path $py)) {
  Write-Host "Missing .venv. Run setup-venv.ps1 once (requires Python 3.11+ on PATH)." -ForegroundColor Yellow
  exit 1
}
Write-Host "Starting iiosMap — open http://127.0.0.1:8765/ in your browser (Ctrl+C to stop)."
& $py -m iiosmap
