@echo off
REM Keeps startup bloat disabled. Run by optimize_admin.bat and daily by task.
REM ASCII-only file. Nothing is uninstalled - only autostart is switched off.
set "RUNKEY=HKCU\Software\Microsoft\Windows\CurrentVersion\Run"
set "APPROVED=HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved"
for %%A in ("OneDrive" "CCleaner Smart Cleaning" "uTorrentWeb" "uTorrent Web" "uTorrent") do reg delete "%RUNKEY%" /v %%A /f >nul 2>&1
for %%A in ("OneDrive" "CCleaner Smart Cleaning" "uTorrentWeb" "uTorrent Web" "uTorrent") do reg add "%APPROVED%\Run" /v %%A /t REG_BINARY /d 030000000000000000000000 /f >nul 2>&1
reg add "%APPROVED%\Run32" /v "CCleaner Smart Cleaning" /t REG_BINARY /d 030000000000000000000000 /f >nul 2>&1
exit /b 0
