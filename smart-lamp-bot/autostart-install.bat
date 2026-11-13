@echo off
REM Регистрирует бота в автозапуске Windows (при входе в систему).
REM Запускать обычным двойным кликом. Удалить: autostart-remove.bat
setlocal
set TASK=SmartLampBot
set DIR=%~dp0
schtasks /Create /TN "%TASK%" /TR "\"%DIR%run.bat\"" /SC ONLOGON /RL LIMITED /F
if %ERRORLEVEL%==0 (
  echo.
  echo [OK] Бот будет автозапускаться при входе в Windows.
  echo Запустить прямо сейчас, не перезагружаясь: schtasks /Run /TN "%TASK%"
) else (
  echo [!] Не удалось создать задачу. Запусти этот файл от администратора.
)
pause
