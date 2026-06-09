@echo off
setlocal EnableExtensions

rem Перейти в корень проекта (папка radar)
cd /d "%~dp0.."

rem Node.js в PATH (типичные пути установки)
set "PATH=C:\Program Files\nodejs;%APPDATA%\npm;%LOCALAPPDATA%\Programs\nodejs;%PATH%"

if not exist logs mkdir logs

echo. >> logs\bot.log
echo [%date% %time%] ===== Starting Radar Future Bot ===== >> logs\bot.log

where node >> logs\bot.log 2>&1
if errorlevel 1 (
  echo [%date% %time%] ERROR: node.exe not found in PATH >> logs\bot.log
  exit /b 1
)

call npm start >> logs\bot.log 2>&1
echo [%date% %time%] Bot stopped with exit code %errorlevel% >> logs\bot.log
exit /b %errorlevel%
