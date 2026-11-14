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
REM Step 2: mark them DISABLED in StartupApproved, so the autostart stays off
REM even if the app re-adds its Run entry - CCleaner does that on every launch.
REM REG_BINARY starting with 03 = disabled, same as Task Manager - Startup tab.
call "%~dp0startup_guard.bat"
REM Step 3: daily task re-applies the same, in case something re-enables it.
schtasks /Create /TN "INTELLECT_StartupGuard" /TR "\"%~dp0startup_guard.bat\"" /SC DAILY /ST 09:15 /RL LIMITED /F >nul 2>&1

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
