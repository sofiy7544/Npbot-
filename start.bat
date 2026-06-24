@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === Stanley Quote Bot ===
echo Устанавливаю зависимости (только при первом запуске)...
python -m pip install --quiet --disable-pip-version-check -r requirements.txt
if errorlevel 1 (
  echo.
  echo Не удалось установить зависимости. Проверь, что Python установлен и стоит галочка "Add to PATH".
  pause
  exit /b
)
echo Запускаю бота. НЕ ЗАКРЫВАЙ это окно, пока нужен бот.
echo Остановить — закрыть окно или Ctrl+C.
echo.
python stanley_bot.py
pause
