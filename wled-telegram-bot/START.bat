@echo off
setlocal
title INTELLECT - smart light and TV
cd /d "%~dp0"

REM NOTE FOR EDITORS: keep this file ASCII-only and never put ( or ) inside
REM echo text that sits inside an if-block. cmd.exe treats ")" as block end.

REM Every step is also written to logs\start.log - send the folder for analysis.
if not exist "logs" mkdir "logs" >nul 2>&1
call :rotate
2>nul >>"logs\start.log" echo.
call :log ===== START.bat started =====
set "VER=unknown"
if exist "VERSION" set /p VER=<"VERSION"
call :log Version: %VER%
2>nul >>"logs\start.log" echo     folder: "%~dp0"

echo ==================================================
echo    INTELLECT - everything installs itself.
echo    Please wait - first run takes a couple of minutes.
echo ==================================================
echo.

REM ---------- 1) Python: find or auto-install ----------
set "PY="
where py >nul 2>&1
if not errorlevel 1 set "PY=py"
if defined PY goto :py_ok
where python >nul 2>&1
if not errorlevel 1 set "PY=python"
if defined PY goto :py_ok

echo [*] Python not found - downloading and installing it...
set "PYVER=3.12.7"
set "PYEXE=%TEMP%\python-%PYVER%-amd64.exe"
powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; try{ Invoke-WebRequest -UseBasicParsing 'https://www.python.org/ftp/python/%PYVER%/python-%PYVER%-amd64.exe' -OutFile '%PYEXE%' } catch { exit 1 }"
if errorlevel 1 goto :py_download_failed
echo [*] Installing Python silently...
"%PYEXE%" /quiet InstallAllUsers=0 PrependPath=1 Include_test=0 Include_pip=1
set "PY=%LocalAppData%\Programs\Python\Python312\python.exe"
if not exist "%PY%" set "PY=python"
goto :py_ok

:py_download_failed
echo [!] Could not download Python. Check internet and run again.
start "" https://www.python.org/downloads/
call :log ERROR: Python not found and download failed
goto :end

:py_ok
echo [i] Python: %PY%
call :log Python: %PY%
"%PY%" --version 2>nul >>"logs\start.log"

REM ---------- 2) Libraries - only first time ----------
if exist ".deps_ok" goto :deps_skip
echo [*] Installing libraries - one time, can take 2-3 min...
REM Remove leftovers of an interrupted older install - the yellow pip warnings.
"%PY%" startup_checks.py --clean-pip >nul 2>&1
"%PY%" -m pip install --upgrade pip >nul 2>&1
call :log Installing libraries - details in logs\pip.log
"%PY%" -m pip install -r requirements.txt --log "logs\pip.log"
if errorlevel 1 goto :deps_failed
"%PY%" -m pip install psutil >nul 2>&1
echo done> ".deps_ok"
echo [i] Libraries installed.
call :log Libraries installed OK
goto :deps_done

:deps_failed
echo.
echo [!] Library install failed - see the red text above.
echo     Check internet connection and run START.bat again.
call :log ERROR: library install failed - see logs\pip.log
goto :end

:deps_skip
echo [i] Libraries already installed - skipping.
call :log Libraries: already installed

:deps_done

REM ---------- 3) Config check ----------
if exist ".env" goto :env_ok
echo [!] Missing .env config file.
call :log ERROR: .env missing
if not exist ".env.example" goto :env_no_example
copy /y ".env.example" ".env" >nul
echo [*] Created .env - opening it in Notepad.
echo     Fill in WLED_BOT_TOKEN, ALLOWED_USERS and OPENAI_API_KEY,
echo     save the file, close Notepad, then run START.bat again.
start "" /wait notepad ".env"
goto :end

:env_no_example
echo [!] .env.example is also missing. Re-extract the archive.
goto :end

:env_ok
call :log .env: present

REM ---------- 4) First-run PC optimization - ONCE ----------
if exist ".optimized" goto :opt_done
echo [*] First run: optimizing this PC. Approve the admin prompt for a full clean.
powershell -NoProfile -Command "try{ Start-Process -Verb RunAs -Wait -FilePath '%~dp0optimize_admin.bat' }catch{}"
if exist ".optimized" goto :opt_done
echo [i] Admin declined - applying the safe optimization instead...
call :optimize
echo done> ".optimized"
call :log Optimization: safe mode - admin declined
:opt_done

REM ---------- 5) Autostart on Windows logon - no admin needed ----------
REM A shortcut INTELLECT.lnk in the user Startup folder, rewritten on EVERY run
REM so it always points to THIS folder, even after unpacking somewhere new.
REM PowerShell gets the path through an environment variable, so letters like
REM Ukrainian i/g in the user name never pass through the console code page.
REM Fallback: Task Scheduler - it also stores the path as Unicode.
set "INTELLECT_BAT=%~f0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "try{ $p=Join-Path ([Environment]::GetFolderPath('Startup')) 'INTELLECT.lnk'; if(Test-Path -LiteralPath $p){Remove-Item -LiteralPath $p -Force}; $s=(New-Object -ComObject WScript.Shell).CreateShortcut($p); $s.TargetPath=$env:INTELLECT_BAT; $s.WorkingDirectory=(Split-Path -Parent $env:INTELLECT_BAT); $s.WindowStyle=7; $s.Save(); if(Test-Path -LiteralPath $p){exit 0}else{exit 1} }catch{exit 1}" >nul 2>&1
if errorlevel 1 goto :autostart_task
REM Shortcut works - remove the old scheduled task: it could point to an old
REM folder and start a second copy of the bot at logon.
schtasks /Delete /TN "INTELLECT" /F >nul 2>&1
echo [i] Autostart with Windows: on - this folder.
call :log Autostart: shortcut INTELLECT.lnk in Startup - OK
goto :autostart_done

:autostart_task
schtasks /Create /TN "INTELLECT" /TR "\"%~f0\"" /SC ONLOGON /RL LIMITED /F >nul 2>&1
if errorlevel 1 goto :autostart_failed
echo [i] Autostart with Windows: on - via Task Scheduler.
call :log Autostart: shortcut FAILED, Task Scheduler OK
goto :autostart_done

:autostart_failed
echo [!] Could not set up autostart. After a reboot start START.bat by hand.
call :log ERROR: autostart FAILED - shortcut and Task Scheduler both failed

:autostart_done

REM ---------- 6) Find the lamp ----------
echo.
echo [*] Searching for WLED lamp on the network...
"%PY%" find_lamp.py
call :log find_lamp exit code: %ERRORLEVEL%
echo.

REM ---------- 7) Run the bot - auto-restart ----------
echo ==================================================
echo   READY. Bot is running. In Telegram send:  /start
echo   You may minimize this window. Closing it stops the bot.
echo ==================================================
echo.
:loop
call :rotate
call :log Bot starting
"%PY%" wled_bot.py
set "RC=%ERRORLEVEL%"
call :log Bot stopped, exit code %RC%
REM Exit codes from startup_checks.py: 2 = bad .env, 3 = already running.
if "%RC%"=="2" goto :bad_config
if "%RC%"=="3" goto :already_running
echo [i] Bot stopped. Restarting in 5 sec... close the window to quit.
ping -n 6 127.0.0.1 >nul 2>&1
goto :loop

:bad_config
echo.
echo [!] Settings problem in .env - read the red line above.
echo     Opening .env: fix it, save, close Notepad, then run START.bat again.
call :log Stop: settings problem in .env - see logs\bot.log
start "" /wait notepad ".env"
goto :end

:already_running
echo.
echo [!] Another copy of the INTELLECT bot is ALREADY RUNNING -
echo     an OLD INTELLECT window, an old folder, or another PC.
echo     Close the old copy, then run START.bat again.
call :log Stop: another copy of the bot is already running
goto :end

REM ================= subroutines =================
:log
2>nul >>"logs\start.log" echo [%date% %time%] %*
goto :eof

:rotate
if exist "logs\start.log" for %%F in ("logs\start.log") do if %%~zF GTR 300000 move /y "logs\start.log" "logs\start.log.old" >nul 2>&1
goto :eof

:optimize
REM Safe, per-user, reversible tweaks - no admin needed.
powercfg /setactive SCHEME_BALANCED >nul 2>&1
powercfg /change standby-timeout-ac 0 >nul 2>&1
powercfg /change hibernate-timeout-ac 0 >nul 2>&1
powercfg /change disk-timeout-ac 0 >nul 2>&1
powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0 >nul 2>&1
powercfg /setactive SCHEME_CURRENT >nul 2>&1
for %%A in ("OneDrive" "CCleaner Smart Cleaning" "uTorrentWeb" "uTorrent Web" "uTorrent") do reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v %%~A /f >nul 2>&1
del /q /f /s "%TEMP%\*" >nul 2>&1
for /d %%D in ("%TEMP%\*") do rmdir /s /q "%%D" >nul 2>&1
echo [i] Done: power plan Balanced, no sleep, startup trimmed, TEMP cleared.
goto :eof

:end
call :log END - window waits for a key press
echo.
echo ==================================================
echo [i] Press any key to close this window.
echo ==================================================
pause >nul
exit /b
