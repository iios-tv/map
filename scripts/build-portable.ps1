$ErrorActionPreference = "Stop"
<#
  Assembles a portable folder under dist/iiosMap-portable with:
    app/frontend/dist/  — built SPA
    wheels/*.whl        — iiosmap wheel
    Start-iiosMap.ps1, setup-venv.ps1, README_PORTABLE.md

  Run from repository root:  .\scripts\build-portable.ps1
#>
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$OutRoot = Join-Path $RepoRoot "dist\iiosMap-portable"
$WheelStaging = Join-Path $RepoRoot ".build\wheels"

Push-Location (Join-Path $RepoRoot "frontend")
npm run build
Pop-Location

if (Test-Path $WheelStaging) {
  Remove-Item -Recurse -Force $WheelStaging
}
New-Item -ItemType Directory -Path $WheelStaging -Force | Out-Null
Push-Location (Join-Path $RepoRoot "backend")
python -m pip wheel . -w $WheelStaging --no-deps
Pop-Location

if (Test-Path $OutRoot) {
  Remove-Item -Recurse -Force $OutRoot
}
New-Item -ItemType Directory -Path (Join-Path $OutRoot "app\frontend\dist") -Force | Out-Null
Copy-Item -Path (Join-Path $RepoRoot "frontend\dist\*") -Destination (Join-Path $OutRoot "app\frontend\dist") -Recurse -Force

New-Item -ItemType Directory -Path (Join-Path $OutRoot "wheels") -Force | Out-Null
Copy-Item -Path (Join-Path $WheelStaging "iiosmap-*.whl") -Destination (Join-Path $OutRoot "wheels") -Force

Copy-Item (Join-Path $RepoRoot "packaging\Start-iiosMap.ps1") $OutRoot -Force
Copy-Item (Join-Path $RepoRoot "packaging\setup-venv.ps1") $OutRoot -Force
Copy-Item (Join-Path $RepoRoot "packaging\README_PORTABLE.md") (Join-Path $OutRoot "README.txt") -Force

Write-Host "Built: $OutRoot"
Write-Host "Zip this folder for end users; they run setup-venv.ps1 then Start-iiosMap.ps1"
