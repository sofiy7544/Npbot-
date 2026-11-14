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
    goto :end
  )
  echo [*] Installing Python silently...
  "!PYEXE!" /quiet InstallAllUsers=0 PrependPath=1 Include_test=0 Include_pip=1
  set "PY=%LocalAppData%\Programs\Python\Python312\python.exe"
  if not exist "!PY!" set "PY=python"
)
echo [i] Python: !PY!

REM ---------- 2) Libraries (only first time / after an update) ----------
if exist ".deps_ok" (
  echo [i] Libraries already installed - skipping.
) else (
  echo [*] Installing libraries (one time, can take 2-3 min)...
  "!PY!" -m pip install --upgrade pip >nul 2>&1
  "!PY!" -m pip install -r requirements.txt
  "!PY!" -m pip install psutil >nul 2>&1
  if not errorlevel 1 echo done > ".deps_ok"
)

REM ---------- 3) Config check ----------
if not exist ".env" (
  echo [!] Missing .env config file.
  if exist ".env.example" (
    echo [*] Creating .env from .env.example, opening it in Notepad...
    copy /y ".env.example" ".env" >nul
    echo [i] Fill in WLED_BOT_TOKEN and ALLOWED_USERS ^(and OPENAI_API_KEY^),
    echo     save the file, close Notepad, then run START.bat again.
    start /wait notepad ".env"
    goto :end
  ) else (
    echo [!] .env.example is also missing. Reinstall from the archive.
    goto :end
  )
)

REM ---------- 4) First-run PC optimization (ONCE) ----------
if not exist ".optimized" (
  echo [*] First run: optimizing this PC. Approve the admin prompt for a full clean.
  powershell -NoProfile -Command "try{ Start-Process -Verb RunAs -Wait -FilePath '%~dp0optimize_admin.bat' }catch{}"
  if not exist ".optimized" (
    echo [i] Admin declined - applying the safe optimization instead...
    call :optimize
    echo done > ".optimized"
  )
)

REM ---------- 5) Autostart on Windows logon (once, no admin) ----------
schtasks /Query /TN "INTELLECT" >nul 2>&1
if errorlevel 1 (
  schtasks /Create /TN "INTELLECT" /TR "\"%~f0\"" /SC ONLOGON /RL LIMITED /F >nul 2>&1
  if not errorlevel 1 echo [i] Added to Windows autostart.
)

REM ---------- 6) Find the lamp ----------
echo.
echo [*] Searching for WLED lamp on the network...
"!PY!" find_lamp.py
echo.

REM ---------- 7) Run the bot (auto-restart) ----------
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

REM ================= subroutines =================
:optimize
REM Safe, per-user, reversible tweaks (no admin needed).
powercfg /setactive SCHEME_BALANCED >nul 2>&1
powercfg /change standby-timeout-ac 0 >nul 2>&1
powercfg /change hibernate-timeout-ac 0 >nul 2>&1
powercfg /change disk-timeout-ac 0 >nul 2>&1
powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0 >nul 2>&1
powercfg /setactive SCHEME_CURRENT >nul 2>&1
for %%A in ("OneDrive" "CCleaner Smart Cleaning" "uTorrentWeb" "uTorrent Web" "uTorrent") do (
  reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v %%~A /f >nul 2>&1
)
del /q /f /s "%TEMP%\*" >nul 2>&1
for /d %%D in ("%TEMP%\*") do rmdir /s /q "%%D" >nul 2>&1
echo [i] Done: power plan = Balanced, no sleep, startup trimmed, TEMP cleared.
goto :eof

:end
echo.
echo ==================================================
echo [i] Press any key to close this window.
echo ==================================================
pause >nul
exit /b
