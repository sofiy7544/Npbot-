@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================================
echo   Stanley Brand site — локальний сервер
echo   Відкрий у браузері:  http://localhost:8000
echo   Адмінка:             http://localhost:8000/admin.html
echo   Ctrl+C — зупинити.
echo ============================================================
echo.
python -m http.server 8000
pause
