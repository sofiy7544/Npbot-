@echo off
chcp 65001 >nul
title INTELLECT - setup
cd /d "%~dp0"

echo ==================================================
echo    INTELLECT setup - creating .env config
echo ==================================================
echo.

if exist ".env" (
  echo [i] .env already exists. Opening it in Notepad.
  start notepad ".env"
  pause & exit /b 0
)

if not exist ".env.example" (
  echo [!] .env.example is missing. Reinstall INTELLECT from the archive.
  pause & exit /b 1
)

copy /y ".env.example" ".env" >nul
echo [i] Created .env from .env.example.
echo [i] Now opening it in Notepad - paste your tokens there, save, close.
echo.
echo     Required to fill in:
echo       WLED_BOT_TOKEN      - from @BotFather in Telegram
echo       ALLOWED_USERS       - your Telegram user id (one number)
echo       OPENAI_API_KEY      - from platform.openai.com (optional but recommended)
echo.
pause
start notepad ".env"
echo.
echo [i] After saving .env - run START.bat.
pause
