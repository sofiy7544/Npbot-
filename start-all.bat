@echo off
chcp 65001 >nul
cd /d "%~dp0"
REM Запускає САЙТ і БОТА у двох окремих вікнах.
echo Відкриваю 2 вікна: сайт (http://localhost:8000) і бот (MOCK).
start "Stanley site" cmd /k "cd /d %~dp0stanley-brand-site && start-site.bat"
start "tg-ttn-bot"   cmd /k "cd /d %~dp0tg-ttn-bot && start-local.bat"
echo Готово. Це вікно можна закрити.
timeout /t 3 >nul
