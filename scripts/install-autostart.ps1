# Install autostart for Radar Future Bot via Windows Task Scheduler
# Run: powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1

$ErrorActionPreference = "Stop"

$TaskName = "RadarFutureBot"
$ProjectRoot = Split-Path $PSScriptRoot -Parent
$StartScript = Join-Path $PSScriptRoot "start-radar.bat"

if (-not (Test-Path $StartScript)) {
    Write-Error "Not found: $StartScript"
}

Write-Host "Building project..."
Push-Location $ProjectRoot
try {
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }
} finally {
    Pop-Location
}

$Action = New-ScheduledTaskAction `
    -Execute $StartScript `
    -WorkingDirectory $ProjectRoot

$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

$Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 2) `
    -ExecutionTimeLimit (New-TimeSpan -Days 365)

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Removed old task."
}

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger $Trigger `
    -Settings $Settings `
    -Description "Radar Future Bot - autostart on Windows login" `
    -RunLevel Limited | Out-Null

Write-Host ""
Write-Host "Done! Autostart installed." -ForegroundColor Green
Write-Host ""
Write-Host "  Task:    $TaskName"
Write-Host "  Folder:  $ProjectRoot"
Write-Host "  Trigger: at Windows login"
Write-Host "  Logs:    $ProjectRoot\logs\bot.log"
Write-Host ""
Write-Host "Start now:  Start-ScheduledTask -TaskName $TaskName"
Write-Host "Remove:     npm run autostart:remove"
Write-Host ""
