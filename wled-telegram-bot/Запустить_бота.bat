@echo off
chcp 65001 >nul
title WLED Telegram Bot
cd /d "%~dp0"

echo ============================================
echo         WLED Telegram Bot - start
echo ============================================
echo.

REM --- 1. Find Python ---
set "PY="
where py >nul 2>nul && set "PY=py"
if not defined PY ( where python >nul 2>nul && set "PY=python" )

if not defined PY (
    echo [!] Python not found.
    echo     Install Python: https://www.python.org/downloads/
    echo     IMPORTANT: check "Add Python to PATH" during install.
    echo.
    pause
    exit /b 1
)
echo [1/3] Python found: %PY%
echo.

REM --- 2. Install dependencies ---
echo [2/3] Installing dependencies (python-telegram-bot, httpx)...
%PY% -m pip install --upgrade pip >nul 2>nul
%PY% -m pip install -r requirements.txt
if errorlevel 1 (
    echo [!] Failed to install dependencies. Check internet connection.
    pause
    exit /b 1
)
echo       Done.
echo.

REM --- 3. First run: create .env if missing ---
if not exist ".env" call :firstrun

REM --- 4. Run the bot ---
echo [3/3] Bot starting. To stop: close this window or press Ctrl+C.
echo ============================================
echo.
%PY% wled_bot.py

echo.
echo Bot stopped.
pause
exit /b 0

:firstrun
setlocal enabledelayedexpansion
echo First run - enter 3 values (will be saved to .env):
set /p "TOKEN=1) Bot token from @BotFather: "
set /p "USERID=2) Your Telegram ID from @userinfobot: "
set /p "LAMPIP=3) WLED lamp IP [Enter = 192.168.1.106]: "
if "!LAMPIP!"=="" set "LAMPIP=192.168.1.106"
> .env echo WLED_BOT_TOKEN=!TOKEN!
>> .env echo ALLOWED_USERS=!USERID!
>> .env echo WLED_IP=!LAMPIP!
endlocal
echo Saved to .env
echo.
goto :eof
