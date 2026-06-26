@echo off
REM ════════════════════════════════════════════════════════════════════
REM   tg-ttn-bot — Windows quick-start (MOCK режим)
REM
REM   Дважды кликни этот файл — бот запустится в режиме тестирования.
REM   Для production deploy см. DEPLOY-LOCAL.md
REM ════════════════════════════════════════════════════════════════════

cd /d "%~dp0"

REM 1. Проверяем .env
if not exist .env (
    echo.
    echo ============================================================
    echo   .env НЕ ЗНАЙДЕНО
    echo ============================================================
    echo.
    echo Створюю його зі шаблону. Зараз відкриється Блокнот —
    echo впиши TG_BOT_TOKEN у відповідне поле, збережи, закрий.
    echo Все інше можна залишити порожнім ^(MOCK режим^).
    echo.
    pause
    copy .env.example .env >nul
    notepad .env
)

REM 2. Перевіряємо Node modules
if not exist node_modules (
    echo.
    echo Встановлюю залежності... ^(1-2 хв перший раз^)
    call npm install --no-fund --no-audit
)

REM 3. Перевіряємо Prisma client
if not exist node_modules\.prisma\client (
    echo Генерую Prisma client...
    call npx prisma generate
)

REM 4. Запускаємо в dev режимі ^(tsx watch — авто-перезавантаження^)
echo.
echo ============================================================
echo   Запускаю tg-ttn-bot
echo ============================================================
echo.
echo   Якщо хочеш зупинити — натисни Ctrl+C
echo   Логи пишуться в logs/bot.log
echo.
call npm run dev
