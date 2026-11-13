@echo off
chcp 65001 >nul
title INTELLECT - диагностика ПК
cd /d "%~dp0"

echo ============================================
echo   Диагностика ПК для оптимизации
echo   Собирается ТОЛЬКО техническая информация.
echo   Фото, файлы, пароли, браузер - НЕ трогаются.
echo   Ничего никуда не отправляется - только файл.
echo ============================================
echo.

python --version >nul 2>&1
if errorlevel 1 (
  echo [!] Python не найден. Сначала запусти УСТАНОВКА.bat
  pause
  exit /b 1
)

python -m pip install psutil >nul 2>&1
python "setup\pc_report.py"

echo.
echo Открываю папку с отчётом. Пришли мне файл .json
start "" "%~dp0setup\pc-reports"
echo.
pause
