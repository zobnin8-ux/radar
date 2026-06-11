@echo off
cd /d "%~dp0"

net session >nul 2>&1
if %errorlevel% equ 0 goto admin

echo.
echo UAC window will appear - click YES.
echo Then look at the BLUE PowerShell window for SUCCESS or error.
echo.
cscript //nologo "%~dp0elevate-firewall.vbs"
echo.
echo If you clicked YES, check the elevated PowerShell window (may be behind this one).
pause
exit /b 0

:admin
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0open-dashboard-firewall.ps1"
