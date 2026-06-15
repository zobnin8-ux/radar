# Radar Future launcher (ASCII-only for Windows PowerShell)
# Usage: launch-radar.ps1 [-Silent]  -- Silent = hidden process, logs in data\

param(
    [switch]$Silent
)

$ErrorActionPreference = "Stop"

$projectDir = if ($PSScriptRoot) { $PSScriptRoot } else { "D:\radar" }
$port = 3847
$envPath = Join-Path $projectDir ".env"
if (Test-Path $envPath) {
    $envRaw = Get-Content $envPath -Raw -ErrorAction SilentlyContinue
    if ($envRaw -match '(?m)^DASHBOARD_PORT=(\d+)') {
        $port = [int]$Matches[1]
    }
}
$url = "http://localhost:$port/api/health"
$dataDir = Join-Path $projectDir "data"
$logFile = Join-Path $dataDir "launch.log"
$serverLog = Join-Path $dataDir "server.log"
$lockFile = Join-Path $dataDir "launch.lock"
$pidFile = Join-Path $dataDir "server.pid"

if (-not (Test-Path $dataDir)) {
    New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
}

function Write-Log([string]$text) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $text"
    Add-Content -Path $logFile -Value $line -Encoding UTF8
    if (-not $Silent) {
        Write-Host $line
    }
}

function Show-Error([string]$title, [string]$message) {
    Write-Log "ERROR: $title - $message"
    if (-not $Silent) {
        Write-Host ""
        Write-Host "ERROR: $title" -ForegroundColor Red
        Write-Host $message -ForegroundColor Red
        Write-Host "Log: $logFile" -ForegroundColor Yellow
    }
    try {
        Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue
        [System.Windows.Forms.MessageBox]::Show(
            "$message`n`nLog: $logFile",
            $title,
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Error
        ) | Out-Null
    }
    catch {
        # no GUI
    }
}

function Get-NodeExe {
    $candidates = @(
        (Join-Path ${env:ProgramFiles} "nodejs\node.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "nodejs\node.exe")
    )
    foreach ($path in $candidates) {
        if ($path -and (Test-Path $path)) { return $path }
    }
    $fromPath = Get-Command node.exe -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty Source -First 1
    if ($fromPath -and (Test-Path $fromPath)) { return $fromPath }
    throw "Node.js not found. Install from https://nodejs.org/"
}

function Resolve-NpmCmd([string]$nodeExe) {
    $nodeDir = Split-Path $nodeExe -Parent
    $candidates = @(
        (Join-Path $nodeDir "npm.cmd"),
        (Join-Path ${env:ProgramFiles} "nodejs\npm.cmd"),
        (Join-Path ${env:ProgramFiles(x86)} "nodejs\npm.cmd")
    )
    foreach ($path in $candidates) {
        if ($path -and (Test-Path $path)) { return $path }
    }
    $fromPath = Get-Command npm.cmd -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty Source -First 1
    if ($fromPath -and (Test-Path $fromPath)) { return $fromPath }
    throw "npm.cmd not found. Reinstall Node.js from https://nodejs.org/"
}

function Invoke-NpmLog([string]$npmCmd, [string[]]$npmArgs) {
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $output = & $npmCmd @npmArgs 2>&1
        $output | ForEach-Object { Write-Log $_ }
        if ($LASTEXITCODE -ne 0) {
            throw "npm $($npmArgs -join ' ') failed (exit $LASTEXITCODE)"
        }
    }
    finally {
        $ErrorActionPreference = $prevEap
    }
}

function Test-NeedsBuild {
    $entry = Join-Path $projectDir "dist\index.js"
    if (-not (Test-Path $entry)) { return $true }
    $builtAt = (Get-Item $entry).LastWriteTime
    $srcRoot = Join-Path $projectDir "src"
    if (-not (Test-Path $srcRoot)) { return $false }
    $newer = Get-ChildItem -Path $srcRoot -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Extension -eq ".ts" -and $_.LastWriteTime -gt $builtAt } |
        Select-Object -First 1
    return $null -ne $newer
}

function Stop-ServerOnPort([int]$listenPort) {
    if (Test-Path $pidFile) {
        $savedPid = Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($savedPid -match '^\d+$') {
            Stop-Process -Id ([int]$savedPid) -Force -ErrorAction SilentlyContinue
            Write-Log "Stopped saved PID $savedPid"
        }
        Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    }

    $procIds = @()
    try {
        $procIds = Get-NetTCPConnection -LocalPort $listenPort -State Listen -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique
    }
    catch {
        # Get-NetTCPConnection may be unavailable
    }

    if ($procIds) {
        foreach ($procId in $procIds) {
            if ($procId -gt 0) {
                Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
            }
        }
        Write-Log "Stopped port $listenPort PIDs: $($procIds -join ',')"
        Start-Sleep -Seconds 2
    }
}

function Wait-ForServer([string]$checkUrl, [int]$maxSeconds) {
    for ($i = 0; $i -lt $maxSeconds; $i++) {
        Start-Sleep -Seconds 1
        try {
            $resp = Invoke-WebRequest -Uri $checkUrl -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
            if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500) {
                return $true
            }
        }
        catch {
            # still starting
        }
    }
    return $false
}

function Test-ServerAlreadyUp([string]$checkUrl) {
    try {
        $resp = Invoke-WebRequest -Uri $checkUrl -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
        return ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500)
    }
    catch {
        return $false
    }
}

# --- main ---

Write-Log "===== START ====="
Set-Location $projectDir

if (Test-Path $lockFile) {
    $lockAge = (Get-Date) - (Get-Item $lockFile).LastWriteTime
    if ($lockAge.TotalMinutes -lt 8) {
        Write-Log "Launch already in progress (${lockAge}s)"
        if (Test-ServerAlreadyUp $url) {
            Write-Log "Bot already running"
            exit 0
        }
        Show-Error "Radar Future" "Bot is still starting. Wait 30 seconds and click the shortcut again."
        exit 1
    }
    Remove-Item $lockFile -Force -ErrorAction SilentlyContinue
}

"" | Set-Content -Path $lockFile -Encoding ASCII

try {
    $nodeExe = Get-NodeExe
    $nodeVer = & $nodeExe -v 2>&1
    $npmCmd = Resolve-NpmCmd $nodeExe
    $nodeDir = Split-Path $nodeExe -Parent
    $npmDir = Split-Path $npmCmd -Parent
    $env:PATH = "$nodeDir;$npmDir;" + (
        $env:PATH -split ';' | Where-Object { $_ -and ($_ -ne $nodeDir) -and ($_ -ne $npmDir) }
    ) -join ';'
    Write-Log "Node: $nodeExe ($nodeVer)"
    Write-Log "npm: $npmCmd"

    if (-not (Test-Path (Join-Path $projectDir "node_modules"))) {
        Write-Log "Installing dependencies (npm install)..."
        Push-Location $projectDir
        try {
            Invoke-NpmLog $npmCmd @("install")
        }
        finally {
            Pop-Location
        }
    }

    if (Test-ServerAlreadyUp $url) {
        Write-Log "Bot already running on port $port"
        exit 0
    }

    Stop-ServerOnPort $port

    if (Test-NeedsBuild) {
        Write-Log "Building (npm run build)..."
        Push-Location $projectDir
        try {
            Invoke-NpmLog $npmCmd @("run", "build")
        }
        finally {
            Pop-Location
        }
        Write-Log "BUILD OK"
    }
    else {
        Write-Log "SKIP BUILD - dist is up to date"
    }

    "" | Set-Content -Path $serverLog -Encoding UTF8
    Write-Log "Starting bot on port $port (no initial channel publish)..."

    $startBat = Join-Path $dataDir "_run-server.cmd"
    $npmCmdEsc = $npmCmd -replace '"', '""'
    @"
@echo off
cd /d "$projectDir"
set "PATH=$nodeDir;$npmDir;%PATH%"
set "RADAR_SKIP_INITIAL_PIPELINE=1"
"$npmCmdEsc" start >> "$serverLog" 2>&1
"@ | Set-Content -Path $startBat -Encoding ASCII

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $env:ComSpec
    $psi.Arguments = "/c `"`"$startBat`"`""
    $psi.WorkingDirectory = $projectDir
    if ($Silent) {
        $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
        $psi.CreateNoWindow = $true
    }
    else {
        $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Minimized
    }
    $psi.UseShellExecute = $false

    $serverProc = [System.Diagnostics.Process]::Start($psi)
    if ($serverProc) {
        $serverProc.Id | Set-Content -Path $pidFile -Encoding ASCII
        Write-Log "Bot PID $($serverProc.Id)"
    }

    Write-Log "Waiting for $url (up to 90 sec)..."
    if (-not (Wait-ForServer $url 90)) {
        $tail = @()
        if (Test-Path $serverLog) {
            $tail = Get-Content $serverLog -Tail 25 -ErrorAction SilentlyContinue
            $tail | ForEach-Object { Write-Log "server: $_" }
        }
        throw "Bot did not respond. Check data\server.log"
    }

    Write-Log "BOT OK - cron active, Telegram commands ready"
    exit 0
}
catch {
    Show-Error "Radar Future - start failed" $_.Exception.Message
    exit 1
}
finally {
    Remove-Item $lockFile -Force -ErrorAction SilentlyContinue
}
