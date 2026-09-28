@echo off
REM Runs the counter service and restarts it automatically if it ever
REM exits (crash, power blip recovering mid-run, etc). Launched hidden via
REM run-hidden.vbs, itself started by the Windows Startup-folder shortcut
REM created by install.bat.
cd /d "%~dp0"

:loop
echo [%date% %time%] Starting counter service...
node index.js
echo [%date% %time%] Counter service exited with code %errorlevel%. Restarting in 5 seconds...
timeout /t 5 /nobreak >nul
goto loop
