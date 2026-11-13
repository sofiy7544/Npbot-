@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title INTELLECT - умный свет и ТВ
cd /d "%~dp0"

echo ==================================================
echo    INTELLECT — всё поставится само. Просто жди.
echo    (при первом запуске это займёт пару минут)
echo ==================================================
echo.

REM ---------- 1) Python: найти или установить автоматически ----------
set "PY="
where py  >nul 2>&1 && set "PY=py"
if not defined PY ( where python >nul 2>&1 && set "PY=python" )

if not defined PY (
  echo [*] Python не найден — скачиваю и устанавливаю сам...
  set "PYVER=3.12.7"
  set "PYEXE=%TEMP%\python-!PYVER!-amd64.exe"
  powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; try{ Invoke-WebRequest -UseBasicParsing 'https://www.python.org/ftp/python/!PYVER!/python-!PYVER!-amd64.exe' -OutFile '!PYEXE!' } catch { exit 1 }"
  if errorlevel 1 (
    echo [!] Не удалось скачать Python. Проверь интернет и запусти файл снова.
    start https://www.python.org/downloads/
    pause & exit /b 1
  )
  echo [*] Устанавливаю Python (без твоего участия)...
  "!PYEXE!" /quiet InstallAllUsers=0 PrependPath=1 Include_test=0 Include_pip=1
  set "PY=%LocalAppData%\Programs\Python\Python312\python.exe"
  if not exist "!PY!" set "PY=python"
)
echo [i] Python: !PY!

REM ---------- 2) Библиотеки ----------
echo [*] Ставлю библиотеки (разово)...
"!PY!" -m pip install --upgrade pip >nul 2>&1
"!PY!" -m pip install -r requirements.txt
"!PY!" -m pip install psutil >nul 2>&1

REM ---------- 3) Проверка настроек ----------
if not exist ".env" (
  echo [!] Нет файла .env с настройками ^(токен и т.п.^).
  echo     Запусти УСТАНОВКА.bat — он спросит токен и создаст .env.
  pause & exit /b 1
)

REM ---------- 4) Автозапуск при включении ПК (один раз, без админа) ----------
schtasks /Query /TN "INTELLECT" >nul 2>&1
if errorlevel 1 (
  schtasks /Create /TN "INTELLECT" /TR "\"%~f0\"" /SC ONLOGON /RL LIMITED /F >nul 2>&1
  if not errorlevel 1 echo [i] Добавил в автозапуск Windows (будет стартовать сам).
)

REM ---------- 5) Поиск лампы в сети ----------
echo.
echo [*] Ищу лампу WLED в сети...
"!PY!" find_lamp.py
echo.

REM ---------- 6) Запуск бота (с автоперезапуском) ----------
echo ==================================================
echo   Готово! Бот работает. Напиши ему в Telegram:  /start
echo   Окно можно свернуть. Закроешь — бот остановится.
echo ==================================================
echo.
:loop
"!PY!" wled_bot.py
echo [i] Бот остановился. Перезапуск через 5 сек... (закрой окно, чтобы выйти)
timeout /t 5 >nul
goto loop
