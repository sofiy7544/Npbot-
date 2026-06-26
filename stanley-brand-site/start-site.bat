@echo off
setlocal
cd /d "%~dp0"

echo ============================================================
echo   Stanley site - local server
echo   Shop:  http://localhost:8000
echo   Admin: http://localhost:8000/admin.html
echo   Press Ctrl+C to stop.
echo ============================================================
echo.

where python >nul 2>nul
if not errorlevel 1 (
  python -m http.server 8000
  goto end
)

where py >nul 2>nul
if not errorlevel 1 (
  py -m http.server 8000
  goto end
)

echo [ERROR] Python not found.
echo Install Python 3 from https://python.org
echo Keep "Add Python to PATH" checked during install, then run this file again.

:end
echo.
pause
