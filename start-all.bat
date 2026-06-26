@echo off
cd /d "%~dp0"

echo Opening two windows: site and bot...
echo.
start "Stanley site" cmd /k "%~dp0stanley-brand-site\start-site.bat"
start "tg-ttn-bot"   cmd /k "%~dp0tg-ttn-bot\start-local.bat"

echo Done.
echo - Site window: http://localhost:8000
echo - Bot window:  follow its instructions (set TG_BOT_TOKEN on first run)
echo.
echo You can close THIS window now.
pause
