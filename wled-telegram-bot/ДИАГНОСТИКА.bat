@echo off
chcp 65001 >nul
title INTELLECT - PC diagnostics
cd /d "%~dp0"

echo ============================================
echo   PC diagnostics for optimization.
echo   Only technical info is collected.
echo   No personal files/photos/passwords.
echo   Nothing is uploaded - just a local file.
echo ============================================
echo.

set "PY="
where py >nul 2>&1 && set "PY=py"
if not defined PY ( where python >nul 2>&1 && set "PY=python" )
if not defined PY ( echo Python not found. Run START.bat first. & pause & exit /b 1 )

"%PY%" -m pip install psutil >nul 2>&1
"%PY%" "setup\pc_report.py"

echo.
echo Report folder opens. Send me the .json file.
start "" "%~dp0setup\pc-reports"
echo.
pause
