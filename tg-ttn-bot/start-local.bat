@echo off
setlocal
cd /d "%~dp0"

echo ============================================================
echo   tg-ttn-bot - local MOCK mode (no database needed)
echo ============================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found.
  echo Install Node.js 20+ from https://nodejs.org
  echo Keep "Add to PATH" checked during install, then run this file again.
  echo.
  pause
  exit /b 1
)

if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo Created .env from template.
  echo Notepad will open - paste your TG_BOT_TOKEN, then SAVE and CLOSE it.
  echo.
  pause
  notepad ".env"
)

if not exist "node_modules" (
  echo Installing dependencies ^(1-2 min, first run only, needs internet^)...
  call npm install --no-fund --no-audit --ignore-scripts
  if errorlevel 1 (
    echo.
    echo [ERROR] npm install failed - check your internet connection.
    pause
    exit /b 1
  )
)

echo.
echo Bot starting in MOCK mode ^(fake TTNs 9999...^).
echo Keep this window open. Press Ctrl+C to stop.
echo.
call npm run dev:legacy

echo.
echo Bot stopped.
pause
