@echo off
chcp 65001 >nul
cd /d "%~dp0"
REM ════════════════════════════════════════════════════════════════════
REM   tg-ttn-bot — ПРОСТИЙ локальний запуск (MOCK, БЕЗ бази даних)
REM   Подвійний клік. Потрібен лише Node.js + токен бота.
REM   (start.bat — це "важкий" режим main.ts, якому треба Postgres+Redis)
REM ════════════════════════════════════════════════════════════════════

if not exist .env (
    echo.
    echo Створюю .env зі шаблону. Зараз відкриється Блокнот —
    echo впиши TG_BOT_TOKEN, збережи і закрий. Решту можна лишити порожнім.
    echo.
    copy .env.example .env >nul
    pause
    notepad .env
)

if not exist node_modules (
    echo Встановлюю залежності... (1-2 хв перший раз)
    call npm install --no-fund --no-audit --ignore-scripts
)

echo.
echo ============================================================
echo   Бот запущений у MOCK режимі (фейкові ТТН 9999...).
echo   НЕ закривай це вікно. Ctrl+C — зупинити.
echo ============================================================
echo.
call npm run dev:legacy
pause
