@echo off
REM BACKUP: starts relay-server by hand, in case it didn't start
REM automatically when you signed in. Checks first and only starts it if
REM it isn't already running.
REM
REM counter-app (the printer service) is NOT started here - it's a
REM separately installed app with its own auto-start (a registry Run key
REM set by the app itself on first launch). If its tray icon is missing,
REM launch "CounterCall Counter App" from the Start Menu instead.
setlocal
cd /d "%~dp0"

net session >nul 2>&1
if errorlevel 1 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

echo Checking what's already running...
for /f %%R in ('powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing http://localhost:4000/health -TimeoutSec 3 | Out-Null; 'yes' } catch { 'no' }"') do set "RELAY_UP=%%R"

if "%RELAY_UP%"=="yes" (
  echo Relay server:     already running.
) else (
  echo Relay server:     starting...
  wscript.exe "%~dp0relay-server\run-hidden.vbs"
  timeout /t 4 /nobreak >nul
)

echo.
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing http://localhost:4000/health -TimeoutSec 5 | Out-Null; 'Relay server:     RUNNING' } catch { 'Relay server:     NOT RESPONDING' }"
powershell -NoProfile -Command "if (Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'CounterCall Counter App.exe' }) { 'Counter app:      RUNNING' } else { 'Counter app:      NOT RUNNING - launch it from the Start Menu' }"
echo.
echo If Relay server says NOT RESPONDING, run install.bat as Administrator again.
pause
