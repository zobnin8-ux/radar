# Builds launcher\Radar.exe via npx pkg (Node single-file exe).
$ErrorActionPreference = "Stop"
$LauncherDir = $PSScriptRoot
$OutputExe = Join-Path $LauncherDir "Radar.exe"
$Entry = Join-Path $LauncherDir "launch.cjs"

Write-Host "Building Radar.exe with pkg..."
Push-Location (Split-Path $LauncherDir -Parent)
try {
  npx --yes pkg@5.8.1 $Entry --targets node18-win-x64 --output $OutputExe --compress GZip
} finally {
  Pop-Location
}

if (Test-Path $OutputExe) {
  Write-Host "OK: $OutputExe"
} else {
  Write-Error "Build failed"
  exit 1
}
