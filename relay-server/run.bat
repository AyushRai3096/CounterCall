@echo off
REM Runs the relay server and restarts it automatically if it ever exits
REM (crash, power blip, etc). Launched hidden via run-hidden.vbs, itself
REM started by the Windows Startup-folder shortcut created by install.bat.
cd /d "%~dp0"

:loop
echo [%date% %time%] Starting relay server...
node src\index.js
echo [%date% %time%] Relay server exited with code %errorlevel%. Restarting in 5 seconds...
timeout /t 5 /nobreak >nul
goto loop
