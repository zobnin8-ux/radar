# Creates "Radar Future.lnk" in project root -- hidden VBS launch + icon.
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

$LauncherDir = $PSScriptRoot
$ProjectRoot = Split-Path $LauncherDir -Parent
$VbsPath = Join-Path $LauncherDir "Radar.vbs"
$ShortcutPath = Join-Path $ProjectRoot "Radar Future.lnk"
$LegacyNames = @("Radar Future.bat")
$IcoPath = Join-Path $LauncherDir "Radar.ico"

if (-not (Test-Path $VbsPath)) {
  Write-Error "Radar.vbs not found in launcher folder."
  exit 1
}

function Ensure-LauncherIcon {
  if ((Test-Path $IcoPath)) {
    return $IcoPath
  }

  $bmp = New-Object System.Drawing.Bitmap 256, 256
  try {
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::FromArgb(30, 39, 46))

    $blue = [System.Drawing.Color]::FromArgb(52, 152, 219)
    $brush = New-Object System.Drawing.SolidBrush $blue
    $g.FillEllipse($brush, 28, 28, 200, 200)
    $brush.Dispose()

    $whitePen = New-Object System.Drawing.Pen ([System.Drawing.Color]::White, 10)
    $g.DrawLine($whitePen, 128, 128, 210, 70)
    $g.DrawLine($whitePen, 128, 128, 60, 190)
    $g.DrawEllipse($whitePen, 98, 98, 60, 60)
    $whitePen.Dispose()

    $hIcon = $bmp.GetHicon()
    $icon = [System.Drawing.Icon]::FromHandle($hIcon)
    try {
      $stream = [System.IO.File]::Create($IcoPath)
      try {
        $icon.Save($stream)
      }
      finally {
        $stream.Close()
      }
    }
    finally {
      $icon.Dispose()
    }
  }
  finally {
    $bmp.Dispose()
  }

  return $IcoPath
}

$iconPath = Ensure-LauncherIcon

$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut($ShortcutPath)
$link.TargetPath = $env:ComSpec
$link.Arguments = "/c wscript.exe //B //Nologo `"$VbsPath`""
$link.WorkingDirectory = $LauncherDir
$link.WindowStyle = 7
$link.Description = "Radar Future - Telegram bot (no terminal)"
if ($iconPath) {
  $link.IconLocation = "$iconPath,0"
}
$link.Save()

foreach ($legacy in $LegacyNames) {
  $legacyPath = Join-Path $ProjectRoot $legacy
  if (Test-Path $legacyPath) {
    Remove-Item $legacyPath -Force
  }
}

Write-Host "OK: $ShortcutPath"
Write-Host "Double-click to start the bot (hidden, logs: data\launch.log)"
