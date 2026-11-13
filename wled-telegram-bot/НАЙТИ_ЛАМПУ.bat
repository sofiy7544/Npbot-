@echo off
chcp 65001 >nul
title INTELLECT - find lamp
cd /d "%~dp0"

set "PY="
where py >nul 2>&1 && set "PY=py"
if not defined PY ( where python >nul 2>&1 && set "PY=python" )
if not defined PY ( echo Python not found. Run START.bat first. & pause & exit /b 1 )

echo Searching for WLED lamp on the network...
"%PY%" find_lamp.py
echo.
echo If found - put its IP into .env (WLED_IP=...). The bot also auto-finds it.
pause
