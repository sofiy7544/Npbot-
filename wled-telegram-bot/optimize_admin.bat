@echo off
chcp 65001 >nul
title INTELLECT - optimize (admin)
cd /d "%~dp0"

echo [*] Optimizing PC with admin rights (one time)...

REM ---- Power: balanced, never sleep on AC, lid closed keeps running ----
powercfg /setactive SCHEME_BALANCED >nul 2>&1
powercfg /change standby-timeout-ac 0 >nul 2>&1
powercfg /change hibernate-timeout-ac 0 >nul 2>&1
powercfg /change disk-timeout-ac 0 >nul 2>&1
powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0 >nul 2>&1
powercfg /setactive SCHEME_CURRENT >nul 2>&1
REM Disable hibernation (never used on an always-on host; frees hiberfil.sys on C:)
powercfg /h off >nul 2>&1

REM ---- Trim startup bloat (user hive; nothing is uninstalled) ----
REM Step 1: delete the Run entry (same as before).
for %%A in ("OneDrive" "CCleaner Smart Cleaning" "uTorrentWeb" "uTorrent Web" "uTorrent") do (
  reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v %%~A /f >nul 2>&1
)
REM Step 2: write a "disabled" flag to StartupApproved — survives if the app
REM re-adds its Run entry (CCleaner Smart Cleaning does that at every launch).
REM REG_BINARY value starting with 03 00 00 00 = disabled in Task Manager Startup.
for %%A in ("OneDrive" "CCleaner Smart Cleaning" "uTorrentWeb" "uTorrent Web" "uTorrent") do (
  reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" /v %%~A /t REG_BINARY /d 03000000000000000000000000000000 /f >nul 2>&1
)
REM Step 3: also apply it under StartupApproved\Run32 (32-bit CCleaner path on x64).
for %%A in ("CCleaner Smart Cleaning") do (
  reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run32" /v %%~A /t REG_BINARY /d 03000000000000000000000000000000 /f >nul 2>&1
)
REM Step 4: register a daily task that re-disables them, so CCleaner's
REM self-reinstallation of its Run key doesn't bring the autostart back.
set "GUARD=%~dp0startup_guard.bat"
> "%GUARD%" echo @echo off
>>"%GUARD%" echo for %%%%A in ("OneDrive" "CCleaner Smart Cleaning" "uTorrentWeb" "uTorrent Web" "uTorrent"^) do (
>>"%GUARD%" echo   reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v %%%%~A /f ^>nul 2^>^&1
>>"%GUARD%" echo   reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" /v %%%%~A /t REG_BINARY /d 03000000000000000000000000000000 /f ^>nul 2^>^&1
>>"%GUARD%" echo ^)
schtasks /Create /TN "INTELLECT_StartupGuard" /TR "\"%GUARD%\"" /SC DAILY /ST 09:15 /RL LIMITED /F >nul 2>&1

REM ---- Clear Windows Update cache (admin; ~hundreds of MB) ----
net stop wuauserv >nul 2>&1
net stop bits >nul 2>&1
del /q /f /s "%WINDIR%\SoftwareDistribution\Download\*" >nul 2>&1
for /d %%D in ("%WINDIR%\SoftwareDistribution\Download\*") do rmdir /s /q "%%D" >nul 2>&1
net start bits >nul 2>&1
net start wuauserv >nul 2>&1

REM ---- Clear TEMP (user + Windows) ----
del /q /f /s "%TEMP%\*" >nul 2>&1
for /d %%D in ("%TEMP%\*") do rmdir /s /q "%%D" >nul 2>&1
del /q /f /s "%WINDIR%\Temp\*" >nul 2>&1
for /d %%D in ("%WINDIR%\Temp\*") do rmdir /s /q "%%D" >nul 2>&1

REM Mark done so START.bat does not repeat this.
echo done > "%~dp0.optimized"
echo [i] Optimization finished: power plan, hibernation off, Update cache + TEMP cleared, startup trimmed.
