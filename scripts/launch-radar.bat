@echo off
chcp 65001 >nul
title Радар будущего
color 0A

cd /d "%~dp0.."
set "PATH=C:\Program Files\nodejs;%APPDATA%\npm;%LOCALAPPDATA%\Programs\nodejs;%PATH%"

echo.
echo   ================================
echo     РАДАР БУДУЩЕГО
echo   ================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [ОШИБКА] Node.js не найден. Установите с https://nodejs.org
  pause
  exit /b 1
)

if not exist dist\index.js (
  echo Сборка проекта...
  call npm run build
  if errorlevel 1 (
    echo [ОШИБКА] Сборка не удалась
    pause
    exit /b 1
  )
)

echo Бот запущен. Не закрывайте это окно.
echo Панель: /panel в Telegram ^(http://IP-ПК:3847^)
echo Если с телефона не открывается: npm run dashboard:firewall:admin
echo.
call npm start

echo.
echo Бот остановлен.
pause
