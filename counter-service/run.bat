@echo off
REM Runs the counter service and restarts it automatically if it ever
REM exits (crash, power blip recovering mid-run, etc). Intended to be
REM launched by a Windows Task Scheduler boot task — see
REM README.md "Run automatically on Windows startup".
cd /d "%~dp0"

:loop
echo [%date% %time%] Starting counter service...
node index.js
echo [%date% %time%] Counter service exited with code %errorlevel%. Restarting in 5 seconds...
timeout /t 5 /nobreak >nul
goto loop
