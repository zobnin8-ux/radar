$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path $PSScriptRoot -Parent
$Launcher = Join-Path $PSScriptRoot "launch-radar.bat"

function Get-DesktopPath {
    try {
        $shellFolders = Get-ItemProperty `
            -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders"
        $raw = $shellFolders.Desktop
        if ($raw) {
            $expanded = [Environment]::ExpandEnvironmentVariables($raw)
            if (Test-Path $expanded) { return $expanded }
        }
    } catch { }

    $fallback = Join-Path $env:USERPROFILE "Desktop"
    if (Test-Path $fallback) { return $fallback }
    return $env:USERPROFILE
}

$Desktop = Get-DesktopPath
$ShortcutPath = Join-Path $Desktop "Radar Future.lnk"
$RootLauncher = Join-Path $ProjectRoot "Radar Future.bat"

$batContent = "@echo off`r`ncd /d `"$ProjectRoot`"`r`ncall scripts\launch-radar.bat`r`n"
Set-Content -Path $RootLauncher -Value $batContent -Encoding ASCII -Force

$created = $false

try {
    $WshShell = New-Object -ComObject WScript.Shell
    $Shortcut = $WshShell.CreateShortcut($ShortcutPath)
    $Shortcut.TargetPath = $RootLauncher
    $Shortcut.WorkingDirectory = $ProjectRoot
    $Shortcut.WindowStyle = 1
    $Shortcut.Description = "Radar Future Bot"
    $Shortcut.IconLocation = "$env:SystemRoot\System32\imageres.dll,109"
    $Shortcut.Save()
    $created = $true
} catch {
    $BatOnDesktop = Join-Path $Desktop "Radar Future.bat"
    Copy-Item -Path $RootLauncher -Destination $BatOnDesktop -Force
    $ShortcutPath = $BatOnDesktop
}

Write-Host ""
if ($created) {
    Write-Host "Desktop shortcut created:" -ForegroundColor Green
} else {
    Write-Host "Desktop launcher created:" -ForegroundColor Green
}
Write-Host "  $ShortcutPath"
Write-Host ""
Write-Host "Also in project folder:"
Write-Host "  $RootLauncher"
Write-Host ""
Write-Host "Double-click to start the bot."
Write-Host ""
