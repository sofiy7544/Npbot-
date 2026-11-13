@echo off
chcp 65001 >nul
title INTELLECT - поиск лампы
cd /d "%~dp0"

echo ============================================
echo   Поиск лампы WLED в сети
echo   (нужно, если сменился Wi-Fi и IP лампы)
echo ============================================
echo.

python --version >nul 2>&1
if errorlevel 1 (
  echo [!] Python не найден. Сначала запусти УСТАНОВКА.bat
  pause
  exit /b 1
)

python "find_lamp.py"
echo.
echo Если лампа найдена - впиши её IP в файл .env (строка WLED_IP=...)
echo и перезапусти бота. Бот и сам пытается найти лампу при старте.
echo.
pause
