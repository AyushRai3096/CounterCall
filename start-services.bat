@echo off
REM BACKUP: starts the relay server and counter service by hand, in case they did not
REM start at boot. Safe to click any time - Task Scheduler will not start a second
REM copy of one that is already running.
setlocal

net session >nul 2>&1
if errorlevel 1 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

schtasks /run /tn "CounterCallRelayServer"
schtasks /run /tn "CounterCallCounterService"

echo.
echo Waiting a few seconds for them to start...
timeout /t 6 /nobreak >nul

echo.
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing http://localhost:4000/health -TimeoutSec 5 | Out-Null; 'Relay server:    RUNNING' } catch { 'Relay server:    NOT RESPONDING' }"
for /f "tokens=2 delims=:" %%S in ('schtasks /query /tn "CounterCallCounterService" /fo list ^| findstr /b "Status"') do echo Counter service:  %%S
echo.
echo If either one says NOT RESPONDING or the task does not exist, run setup-counter-pc.bat as Administrator.
pause
