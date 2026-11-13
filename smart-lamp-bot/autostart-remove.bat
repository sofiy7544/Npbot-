@echo off
REM Убирает бота из автозапуска Windows.
schtasks /Delete /TN "SmartLampBot" /F
echo [OK] Автозапуск удалён.
pause
