# Read-only diagnostics: why the phone may not reach the dashboard.
$ErrorActionPreference = "Continue"

$ProjectRoot = Split-Path $PSScriptRoot -Parent
$EnvPath = Join-Path $ProjectRoot ".env"
$Port = 3847

if (Test-Path $EnvPath) {
    Get-Content $EnvPath | ForEach-Object {
        if ($_ -match '^\s*DASHBOARD_PORT\s*=\s*(\d+)') { $Port = [int]$Matches[1] }
    }
}

Write-Host "=== Radar dashboard phone check (port $Port) ===" -ForegroundColor Cyan
Write-Host ""

$listen = netstat -an | Select-String "0\.0\.0\.0:$Port\s+.*LISTENING"
if ($listen) {
    Write-Host "[OK] Server listens on 0.0.0.0:$Port" -ForegroundColor Green
} else {
    Write-Host "[!!] Port $Port is NOT listening. Start the bot first." -ForegroundColor Red
}

$wifiIp = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.PrefixOrigin -ne 'WellKnown' } |
    Sort-Object { if ($_.InterfaceAlias -match 'Wi-?Fi') { 0 } else { 1 } } |
    Select-Object -First 1).IPAddress

if ($wifiIp) {
    Write-Host "[OK] PC LAN IP: $wifiIp" -ForegroundColor Green
    Write-Host "     Phone URL: http://${wifiIp}:$Port"
    Write-Host "     Health:    http://${wifiIp}:$Port/api/health"
} else {
    Write-Host "[!!] No LAN IPv4 found." -ForegroundColor Red
}

$ruleName = "Radar Future Dashboard ($Port)"
$rule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if ($rule -and ($rule | Where-Object { $_.Enabled -eq 'True' })) {
    $portFilter = Get-NetFirewallPortFilter -AssociatedNetFirewallRule $rule -ErrorAction SilentlyContinue | Select-Object -First 1
    Write-Host "[OK] Firewall rule: $ruleName (profiles: $($rule.Profile -join ','))" -ForegroundColor Green
} else {
    Write-Host "[!!] Firewall rule missing or disabled. Run OPEN-FIREWALL-ADMIN.cmd as admin." -ForegroundColor Red
}

$wifi = Get-NetConnectionProfile -ErrorAction SilentlyContinue | Where-Object { $_.InterfaceAlias -match 'Wi-?Fi' } | Select-Object -First 1
if ($wifi) {
    $cat = $wifi.NetworkCategory
    if ($cat -eq 'Public') {
        Write-Host "[!!] Wi-Fi network category: Public (switch to Private in Windows Settings)" -ForegroundColor Yellow
    } else {
        Write-Host "[OK] Wi-Fi network category: $cat" -ForegroundColor Green
    }
}

if ($wifiIp) {
    try {
        $resp = Invoke-WebRequest -Uri "http://${wifiIp}:$Port/api/health" -UseBasicParsing -TimeoutSec 5
        Write-Host "[OK] HTTP from this PC: $($resp.StatusCode) $($resp.Content)" -ForegroundColor Green
    } catch {
        Write-Host "[!!] HTTP from this PC failed: $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "Devices seen on subnet (ARP):" -ForegroundColor Cyan
arp -a | Select-String "10\.|192\.168\." | ForEach-Object { Write-Host "  $_" }

Write-Host ""
Write-Host "If PC test OK but phone fails:" -ForegroundColor Yellow
Write-Host "  - Phone on same Wi-Fi (not guest), mobile data OFF, no VPN"
Write-Host "  - Router: disable AP / client isolation"
Write-Host "  - Try health URL in phone browser; watch bot console for 'Dashboard ... from <phone-ip>'"
Write-Host ""
