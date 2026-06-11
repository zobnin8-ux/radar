# Paste in PowerShell AS ADMINISTRATOR (one-time setup).
# Or: npm run dashboard:firewall  (from admin PowerShell)

$Port = 3847
$EnvPath = Join-Path (Split-Path $PSScriptRoot -Parent) ".env"
if (Test-Path $EnvPath) {
    Get-Content $EnvPath | ForEach-Object {
        if ($_ -match '^\s*DASHBOARD_PORT\s*=\s*(\d+)') { $Port = [int]$Matches[1] }
    }
}

$RuleName = "Radar Future Dashboard ($Port)"
if (Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue) {
    Write-Host "OK: rule already exists - $RuleName"
    exit 0
}

New-NetFirewallRule `
    -DisplayName $RuleName `
    -Direction Inbound `
    -Protocol TCP `
    -LocalPort $Port `
    -Action Allow `
    -Profile Private

Write-Host "OK: port $Port open on Private network (home Wi-Fi)."
