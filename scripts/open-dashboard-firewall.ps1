# Opens inbound TCP for the dashboard on Private (home) network profile.
# Run PowerShell as Administrator: npm run dashboard:firewall

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path $PSScriptRoot -Parent
$EnvPath = Join-Path $ProjectRoot ".env"
$Port = 3847

if (Test-Path $EnvPath) {
    Get-Content $EnvPath | ForEach-Object {
        if ($_ -match '^\s*DASHBOARD_PORT\s*=\s*(\d+)') { $Port = [int]$Matches[1] }
    }
}

$RuleName = "Radar Future Dashboard ($Port)"

$existing = Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue
if ($existing) {
    Set-NetFirewallRule -DisplayName $RuleName -Profile Any -Enabled True -ErrorAction SilentlyContinue
    Write-Host "OK: firewall rule updated (all profiles) - $RuleName"
    $wifi = Get-NetConnectionProfile -ErrorAction SilentlyContinue | Where-Object { $_.InterfaceAlias -match 'Wi-?Fi' } | Select-Object -First 1
    if ($wifi -and $wifi.NetworkCategory -eq 'Public') {
        Write-Host "NOTE: Wi-Fi profile is Public. Switching to Private..."
        try {
            Set-NetConnectionProfile -InterfaceIndex $wifi.InterfaceIndex -NetworkCategory Private
            Write-Host "OK: Wi-Fi set to Private profile."
        } catch {
            Write-Host "Could not switch Wi-Fi to Private: $($_.Exception.Message)"
            Write-Host "Manual: Settings - Network - Wi-Fi - your network - Private."
        }
    }
    Read-Host "Press Enter to close this window"
    exit 0
}

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
)
if (-not $isAdmin) {
    Write-Host "Administrator rights required."
    Write-Host "Right-click PowerShell -> Run as administrator, then:"
    Write-Host "  cd $ProjectRoot"
    Write-Host "  npm run dashboard:firewall"
    exit 1
}

New-NetFirewallRule `
    -DisplayName $RuleName `
    -Direction Inbound `
    -Protocol TCP `
    -LocalPort $Port `
    -Action Allow `
    -Profile Any `
    -Description "Radar Future web dashboard (home Wi-Fi)"

Write-Host ""
Write-Host "SUCCESS: port $Port is open on home Wi-Fi (Private network)."
Write-Host "On phone: http://YOUR-PC-IP:$Port  (get IP from /panel in Telegram)"
Write-Host ""
Read-Host "Press Enter to close this window"
