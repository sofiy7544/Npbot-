@echo off
REM ════════════════════════════════════════════════════════════════════
REM   tg-ttn-bot — Production deploy via PM2 (24/7, auto-restart)
REM
REM   Use this when ready to "deploy and forget" — bot runs in background
REM   even after closing terminal/restarting Windows.
REM
REM   First time: run as Administrator
REM ════════════════════════════════════════════════════════════════════

cd /d "%~dp0"

REM 1. Check PM2 installed
where pm2 >nul 2>&1
if %errorlevel% neq 0 (
    echo Installing PM2 globally...
    call npm install -g pm2 pm2-windows-startup
)

REM 2. Check .env
if not exist .env (
    echo .env not found. Run start.bat first to create it.
    pause
    exit /b 1
)

REM 3. Install deps if needed
if not exist node_modules (
    call npm install --no-fund --no-audit
    call npx prisma generate
)

REM 4. Compile TypeScript → dist/
echo Compiling TypeScript...
call npx tsc -p tsconfig.json

REM 5. Stop old instance if running
pm2 delete tg-ttn-bot 2>nul

REM 6. Start via PM2 ecosystem config
pm2 start ecosystem.config.cjs

REM 7. Save config so it survives reboot
pm2 save

REM 8. Enable Windows boot startup (first time only)
echo.
echo To enable auto-start on Windows boot, run as Administrator:
echo    pm2-startup install
echo.

echo.
echo ============================================================
echo   tg-ttn-bot deployed via PM2
echo ============================================================
echo.
echo   Commands:
echo     pm2 status              -- service health
echo     pm2 logs tg-ttn-bot     -- live logs
echo     pm2 restart tg-ttn-bot  -- restart
echo     pm2 stop tg-ttn-bot     -- pause
echo     pm2 delete tg-ttn-bot   -- remove from PM2
echo.
pause
