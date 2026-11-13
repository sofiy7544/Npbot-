@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title INTELLECT - smart light and TV
cd /d "%~dp0"

echo ==================================================
echo    INTELLECT - everything installs itself.
echo    Please wait (first run takes a couple of minutes).
echo ==================================================
echo.

REM ---------- 1) Python: find or auto-install ----------
set "PY="
where py  >nul 2>&1 && set "PY=py"
if not defined PY ( where python >nul 2>&1 && set "PY=python" )

if not defined PY (
  echo [*] Python not found - downloading and installing it...
  set "PYVER=3.12.7"
  set "PYEXE=%TEMP%\python-!PYVER!-amd64.exe"
  powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; try{ Invoke-WebRequest -UseBasicParsing 'https://www.python.org/ftp/python/!PYVER!/python-!PYVER!-amd64.exe' -OutFile '!PYEXE!' } catch { exit 1 }"
  if errorlevel 1 (
    echo [!] Could not download Python. Check internet and run again.
    start https://www.python.org/downloads/
    pause & exit /b 1
  )
  echo [*] Installing Python silently...
  "!PYEXE!" /quiet InstallAllUsers=0 PrependPath=1 Include_test=0 Include_pip=1
  set "PY=%LocalAppData%\Programs\Python\Python312\python.exe"
  if not exist "!PY!" set "PY=python"
)
echo [i] Python: !PY!

REM ---------- 2) Libraries ----------
echo [*] Installing libraries (one time)...
"!PY!" -m pip install --upgrade pip >nul 2>&1
"!PY!" -m pip install -r requirements.txt
"!PY!" -m pip install psutil >nul 2>&1

REM ---------- 3) Config check ----------
if not exist ".env" (
  echo [!] Missing .env config file. Run SETUP.bat to create it.
  pause & exit /b 1
)

REM ---------- 4) Autostart on Windows logon (once, no admin) ----------
schtasks /Query /TN "INTELLECT" >nul 2>&1
if errorlevel 1 (
  schtasks /Create /TN "INTELLECT" /TR "\"%~f0\"" /SC ONLOGON /RL LIMITED /F >nul 2>&1
  if not errorlevel 1 echo [i] Added to Windows autostart.
)

REM ---------- 5) Find the lamp ----------
echo.
echo [*] Searching for WLED lamp on the network...
"!PY!" find_lamp.py
echo.

REM ---------- 6) Run the bot (auto-restart) ----------
echo ==================================================
echo   READY. Bot is running. In Telegram send:  /start
echo   You may minimize this window. Closing it stops the bot.
echo ==================================================
echo.
:loop
"!PY!" wled_bot.py
echo [i] Bot stopped. Restarting in 5 sec... (close window to quit)
timeout /t 5 >nul
goto loop
