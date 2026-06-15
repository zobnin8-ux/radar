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
  if (Test-Path $IcoPath) {
    Remove-Item $IcoPath -Force
  }

  $size = 256
  $cx = 128
  $cy = 128
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  try {
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::FromArgb(6, 14, 10))

    $bezel = [System.Drawing.Color]::FromArgb(28, 72, 48)
    $face = [System.Drawing.Color]::FromArgb(10, 28, 18)
    $ring = [System.Drawing.Color]::FromArgb(32, 96, 58)
    $grid = [System.Drawing.Color]::FromArgb(24, 70, 42)
    $sweep = [System.Drawing.Color]::FromArgb(72, 255, 148)
    $sweepDim = [System.Drawing.Color]::FromArgb(36, 140, 78)
    $blip = [System.Drawing.Color]::FromArgb(120, 255, 170)

    $bezelPen = New-Object System.Drawing.Pen $bezel, 8
    $g.DrawEllipse($bezelPen, 8, 8, 240, 240)
    $bezelPen.Dispose()

    $faceBrush = New-Object System.Drawing.SolidBrush $face
    $g.FillEllipse($faceBrush, 18, 18, 220, 220)
    $faceBrush.Dispose()

    $ringPen = New-Object System.Drawing.Pen $ring, 2
    foreach ($d in @(88, 148, 208)) {
      $g.DrawEllipse($ringPen, $cx - $d / 2, $cy - $d / 2, $d, $d)
    }
    $ringPen.Dispose()

    $gridPen = New-Object System.Drawing.Pen $grid, 1
    $g.DrawLine($gridPen, $cx, 20, $cx, 236)
    $g.DrawLine($gridPen, 20, $cy, 236, $cy)
    $g.DrawLine($gridPen, 48, 48, 208, 208)
    $g.DrawLine($gridPen, 208, 48, 48, 208)
    $gridPen.Dispose()

    $sweepPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $sweepPath.AddPie(24, 24, 208, 208, -52, 46)
    $sweepBrush = New-Object System.Drawing.Drawing2D.PathGradientBrush $sweepPath
    $sweepBrush.CenterColor = [System.Drawing.Color]::FromArgb(90, $sweep)
    $sweepBrush.SurroundColors = @([System.Drawing.Color]::FromArgb(0, $sweepDim))
    $g.FillPath($sweepBrush, $sweepPath)
    $sweepBrush.Dispose()
    $sweepPath.Dispose()

    $beamPen = New-Object System.Drawing.Pen $sweep, 4
    $beamRad = -29 * [Math]::PI / 180
    $bx = $cx + [Math]::Cos($beamRad) * 100
    $by = $cy + [Math]::Sin($beamRad) * 100
    $g.DrawLine($beamPen, $cx, $cy, $bx, $by)
    $beamPen.Dispose()

    $blipBrush = New-Object System.Drawing.SolidBrush $blip
    $g.FillEllipse($blipBrush, 156, 72, 12, 12)
    $g.FillEllipse($blipBrush, 92, 138, 10, 10)
    $g.FillEllipse($blipBrush, 168, 156, 14, 14)
    $g.FillEllipse($blipBrush, 118, 96, 8, 8)
    $blipBrush.Dispose()

    $centerBrush = New-Object System.Drawing.SolidBrush $sweep
    $g.FillEllipse($centerBrush, $cx - 5, $cy - 5, 10, 10)
    $centerBrush.Dispose()

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
