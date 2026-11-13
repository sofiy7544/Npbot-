@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title INTELLECT - setup .env
cd /d "%~dp0"

echo This creates the .env config file.
echo (Normally START.bat already has everything ready.)
echo.

if exist ".env" ( echo .env already exists - nothing to do. & pause & exit /b 0 )

set "TOKEN="
set /p TOKEN="Bot token from @BotFather: "
set "TGID="
set /p TGID="Your Telegram ID (Enter = 6194446543): "
if "!TGID!"=="" set "TGID=6194446543"
set "LIP="
set /p LIP="WLED lamp IP (Enter = 192.168.1.106): "
if "!LIP!"=="" set "LIP=192.168.1.106"
set "OAI="
set /p OAI="OpenAI key for smart speech (Enter = skip): "
(
  echo WLED_BOT_TOKEN=!TOKEN!
  echo ALLOWED_USERS=!TGID!
  echo WLED_IP=!LIP!
  echo WEB_PORT=8080
  echo OPENAI_API_KEY=!OAI!
  echo AI_MODEL=gpt-4o-mini
) > .env
echo.
echo .env created. Now run START.bat
pause
