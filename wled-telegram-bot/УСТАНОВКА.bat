@echo off
chcp 65001 >nul
title INTELLECT - установка
cd /d "%~dp0"

echo ============================================
echo   Установка бота INTELLECT (свет + телевизор)
echo ============================================
echo.

REM --- 1) Проверка Python ---
python --version >nul 2>&1
if errorlevel 1 (
  echo [!] Python не найден.
  echo     Установи его: https://www.python.org/downloads/
  echo     ВАЖНО: поставь галочку "Add Python to PATH".
  start https://www.python.org/downloads/
  echo.
  pause
  exit /b 1
)
for /f "delims=" %%v in ('python --version') do echo [i] Найден %%v

REM --- 2) Библиотеки ---
echo [*] Устанавливаю библиотеки (это разово, подожди)...
python -m pip install --upgrade pip >nul 2>&1
python -m pip install -r requirements.txt
python -m pip install psutil >nul 2>&1

REM --- 3) Настройки .env ---
if exist ".env" (
  echo [i] Файл .env уже есть - настройки не меняю.
  goto done
)
call :makeenv
goto done

:makeenv
echo.
echo --- Настройка (введи 4 значения) ---
set /p TOKEN="Токен бота от @BotFather: "
set /p TGID="Твой Telegram ID (Enter = 6194446543): "
if "%TGID%"=="" set TGID=6194446543
set /p LIP="IP лампы WLED (Enter = 192.168.1.106): "
if "%LIP%"=="" set LIP=192.168.1.106
set /p OAI="Ключ OpenAI для 'интеллекта' (Enter = пропустить): "
(
  echo WLED_BOT_TOKEN=%TOKEN%
  echo ALLOWED_USERS=%TGID%
  echo WLED_IP=%LIP%
  echo WEB_PORT=8080
  echo OPENAI_API_KEY=%OAI%
  echo AI_MODEL=gpt-4o-mini
) > .env
echo [+] Файл .env создан.
goto :eof

:done
echo.
echo ============================================
echo   Готово! Что дальше:
echo   - Запустить бота:     Запустить_бота.bat
echo   - Диагностика ПК:     ДИАГНОСТИКА.bat
echo ============================================
echo.
pause
