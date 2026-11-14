@echo off
setlocal
title INTELLECT - collect report for support
cd /d "%~dp0"

REM ASCII-only file. Packs logs\* + PC diagnostics into intellect-report.zip.
REM Python does the packing: it can read logs the running bot keeps open,
REM and it hides the bot token and API keys inside every packed file.
REM .env and the chat database are NOT included.

echo ============================================
echo   Collecting a report to send for analysis:
echo   all logs + PC diagnostics in one zip.
echo   No personal files, photos or passwords.
echo   Bot token and keys are hidden as ***.
echo ============================================
echo.

set "PY="
where py >nul 2>&1
if not errorlevel 1 set "PY=py"
if defined PY goto :py_ok
where python >nul 2>&1
if not errorlevel 1 set "PY=python"
if defined PY goto :py_ok
echo [!] Python not found. Run START.bat first.
goto :end

:py_ok
echo [*] Running PC diagnostics...
"%PY%" -m pip install psutil >nul 2>&1
"%PY%" "setup\pc_report.py" >nul 2>&1

echo [*] Packing report...
if exist "intellect-report.zip" del /f /q "intellect-report.zip" >nul 2>&1
"%PY%" diaglog.py --report
if errorlevel 1 goto :end
echo.
echo Send this ONE file for analysis: intellect-report.zip
start "" "%~dp0"

:end
echo.
pause
