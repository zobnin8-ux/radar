# Radar Future HUD launcher (hidden bot, no console).
$ErrorActionPreference = "Stop"

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
& (Join-Path $ProjectRoot "launch-radar.ps1") -Silent
