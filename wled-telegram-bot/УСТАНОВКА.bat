@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title INTELLECT - установка (всё сразу)
cd /d "%~dp0"

echo ==================================================
echo    INTELLECT — установка умного света и ТВ
echo    Один файл: зависимости, настройка, запуск.
echo ==================================================
echo.

REM ---------- 1) Python ----------
python --version >nul 2>&1
if errorlevel 1 (
  echo [!] Python не установлен.
  echo     Открываю страницу загрузки. Поставь Python и ОБЯЗАТЕЛЬНО
  echo     отметь галочку "Add Python to PATH", затем запусти этот файл снова.
  start https://www.python.org/downloads/
  echo.
  pause
  exit /b 1
)
for /f "delims=" %%v in ('python --version') do echo [i] %%v

REM ---------- 2) Библиотеки ----------
echo [*] Устанавливаю библиотеки (разово, подожди минуту)...
python -m pip install --upgrade pip >nul 2>&1
python -m pip install -r requirements.txt
python -m pip install psutil >nul 2>&1
echo [+] Библиотеки готовы.

REM ---------- 3) Настройки .env ----------
if exist ".env" (
  echo [i] Файл .env уже есть — настройки не трогаю.
) else (
  call :makeenv
)

REM ---------- 4) Поиск лампы в сети ----------
echo.
echo [*] Ищу лампу WLED в сети (вдруг сменился Wi-Fi/IP)...
python find_lamp.py
echo.

REM ---------- 5) Диагностика ПК (по желанию) ----------
set "ANS="
set /p ANS="Снять диагностику ПК сейчас? (y/n): "
if /i "!ANS!"=="y" (
  python "setup\pc_report.py"
  start "" "%~dp0setup\pc-reports"
)

REM ---------- 6) Запуск бота ----------
echo.
set "RUN="
set /p RUN="Запустить бота сейчас? (y/n): "
if /i "!RUN!"=="y" (
  echo.
  echo [*] Запускаю бота. Напиши ему в Telegram /start
  echo     Для постоянной работы 24/7 используй "Запустить_бота.bat".
  echo.
  python wled_bot.py
) else (
  echo.
  echo ==================================================
  echo  Готово! Дальше:
  echo   • Запустить бота:        Запустить_бота.bat
  echo   • Найти лампу (новый IP): НАЙТИ_ЛАМПУ.bat
  echo   • Диагностика ПК:        ДИАГНОСТИКА.bat
  echo ==================================================
)
echo.
pause
exit /b 0

REM ================= подпрограммы =================
:makeenv
echo.
echo --- Настройка (введи 4 значения) ---
set "TOKEN="
set /p TOKEN="Токен бота от @BotFather: "
set "TGID="
set /p TGID="Твой Telegram ID (Enter = 6194446543): "
if "!TGID!"=="" set "TGID=6194446543"
set "LIP="
set /p LIP="IP лампы WLED (Enter = 192.168.1.106, бот уточнит сам): "
if "!LIP!"=="" set "LIP=192.168.1.106"
set "OAI="
set /p OAI="Ключ OpenAI для 'интеллекта' (Enter = пропустить): "
(
  echo WLED_BOT_TOKEN=!TOKEN!
  echo ALLOWED_USERS=!TGID!
  echo WLED_IP=!LIP!
  echo WEB_PORT=8080
  echo OPENAI_API_KEY=!OAI!
  echo AI_MODEL=gpt-4o-mini
) > .env
echo [+] Файл .env создан.
goto :eof
