@echo off
REM BACKUP: starts the relay server and counter service by hand, in case they
REM didn't start automatically when you signed in. Checks each one first and
REM only starts what isn't already running - never run two copies of
REM counter-service at once, it causes orders to silently go missing.
setlocal
cd /d "%~dp0"

net session >nul 2>&1
if errorlevel 1 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

echo Checking what's already running...
for /f %%R in ('powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing http://localhost:4000/health -TimeoutSec 3 | Out-Null; 'yes' } catch { 'no' }"') do set "RELAY_UP=%%R"
for /f %%C in ('powershell -NoProfile -Command "if (Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*counter-service*run.bat*' }) { 'yes' } else { 'no' }"') do set "COUNTER_UP=%%C"

if "%RELAY_UP%"=="yes" (
  echo Relay server:     already running.
) else (
  echo Relay server:     starting...
  wscript.exe "%~dp0relay-server\run-hidden.vbs"
)

if "%COUNTER_UP%"=="yes" (
  echo Counter service:  already running.
) else (
  echo Counter service:  starting...
  wscript.exe "%~dp0counter-service\run-hidden.vbs"
)

if "%RELAY_UP%%COUNTER_UP%"=="yesyes" goto :status
echo.
echo Waiting a few seconds...
timeout /t 6 /nobreak >nul

:status
echo.
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing http://localhost:4000/health -TimeoutSec 5 | Out-Null; 'Relay server:     RUNNING' } catch { 'Relay server:     NOT RESPONDING' }"
powershell -NoProfile -Command "if (Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*counter-service*run.bat*' }) { 'Counter service:  RUNNING' } else { 'Counter service:  NOT RUNNING' }"
echo.
echo If either says NOT RUNNING / NOT RESPONDING, check counter-service\logs\counter-service.log
echo or run install.bat as Administrator again.
pause
