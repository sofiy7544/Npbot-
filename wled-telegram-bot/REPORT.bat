@echo off
chcp 65001 >nul
title INTELLECT - collect report for support
cd /d "%~dp0"

echo ============================================
echo   Collecting a report to send for analysis:
echo   bot log + PC diagnostics in one zip.
echo   (No personal files/photos/passwords.)
echo ============================================
echo.

set "PY="
where py >nul 2>&1 && set "PY=py"
if not defined PY ( where python >nul 2>&1 && set "PY=python" )
if not defined PY ( echo Python not found. Run START.bat first. & pause & exit /b 1 )

echo [*] Running PC diagnostics...
"%PY%" -m pip install psutil >nul 2>&1
"%PY%" "setup\pc_report.py" >nul 2>&1

echo [*] Packing report...
if exist "intellect-report.zip" del "intellect-report.zip"
powershell -NoProfile -Command "$f=@(); if(Test-Path 'wled-bot.log'){$f+=(Get-Item 'wled-bot.log')}; if(Test-Path 'wled-bot.log.1'){$f+=(Get-Item 'wled-bot.log.1')}; if(Test-Path 'setup\pc-reports'){$f+=(Get-ChildItem 'setup\pc-reports\*')}; if($f.Count -gt 0){ Compress-Archive -Path $f -DestinationPath 'intellect-report.zip' -Force }"

if exist "intellect-report.zip" (
  echo.
  echo [OK] Ready:  intellect-report.zip
  echo Send this ONE file for analysis.
  start "" "%~dp0"
) else (
  echo [!] Nothing to pack yet - run START.bat at least once.
)
echo.
pause
