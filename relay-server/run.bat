@echo off
REM Runs the relay server and restarts it automatically if it ever exits
REM (crash, power blip, etc). Intended to be launched by a Windows Task
REM Scheduler boot task — see README.md "Run automatically
REM on Windows startup".
cd /d "%~dp0"

:loop
echo [%date% %time%] Starting relay server...
node src\index.js
echo [%date% %time%] Relay server exited with code %errorlevel%. Restarting in 5 seconds...
timeout /t 5 /nobreak >nul
goto loop
