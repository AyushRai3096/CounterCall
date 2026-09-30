@echo off
REM ONE-TIME setup for the counter PC's relay-server + Tailscale Funnel.
REM Extract/clone this project into its PERMANENT folder first (e.g.
REM C:\CounterCall), THEN right-click this file here and choose "Run as
REM administrator". Safe to run again.
REM
REM This does NOT run "npm install" on this machine - relay-server's
REM node_modules folder is already included in the download, prebuilt, so
REM there is nothing to compile here (no Python, no Visual Studio, no
REM node-gyp).
REM
REM This does NOT set up the printer/ticket service - that's a separate,
REM self-contained installed app now (counter-app), not part of this repo's
REM node_modules-in-git approach (Electron is too large to commit - see
REM CLAUDE.md). Install "CounterCall Counter App Setup.exe" separately,
REM copied to this PC directly (USB, etc.), not through this script.
REM
REM Auto-start: a shortcut in the current user's Windows Startup folder runs
REM run-all-hidden.vbs the moment that user signs in - no Task Scheduler, no
REM SYSTEM account. relay-server runs with no visible window and restarts
REM itself if it crashes (relay-server\run.bat). counter-app has its own,
REM separate auto-start (Electron's own login-item registration, set up the
REM first time that installed app runs).

setlocal enabledelayedexpansion
cd /d "%~dp0"
set "ROOT=%~dp0"

net session >nul 2>&1
if errorlevel 1 (
  echo Please right-click this file and choose "Run as administrator".
  pause & exit /b 1
)

echo === 1/4 Checking the download ===
if not exist "relay-server\node_modules\socket.io" (
  echo relay-server\node_modules is missing or incomplete.
  echo Re-download the project ^(the ZIP or clone must include node_modules^) and run this again.
  pause & exit /b 1
)
echo OK - dependencies are already included, nothing to install.

echo === 2/4 Node.js ===
where node >nul 2>&1
if errorlevel 1 (
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  set "PATH=%ProgramFiles%\nodejs;%PATH%"
)
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js could not be installed automatically. Install it from nodejs.org, then run this file again.
  pause & exit /b 1
)

echo === 3/4 Start relay-server automatically when you sign in ===
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
powershell -NoProfile -Command "try { $s=(New-Object -ComObject WScript.Shell).CreateShortcut('%STARTUP%\CounterCall.lnk'); $s.TargetPath='wscript.exe'; $s.Arguments='\"%ROOT%run-all-hidden.vbs\"'; $s.WorkingDirectory='%ROOT%'; $s.Save(); Write-Host 'Startup shortcut created.' } catch { Write-Host 'Could not create the Startup-folder shortcut (some PCs block creating shortcuts) - relay-server will not start by itself. Run start-services.bat manually instead.' }"
REM Desktop icon is only a manual-start convenience, so a policy blocking it
REM isn't fatal - start-services.bat in this same folder does the same thing.
powershell -NoProfile -Command "try { $s=(New-Object -ComObject WScript.Shell).CreateShortcut('%PUBLIC%\Desktop\Start CounterCall.lnk'); $s.TargetPath='%ROOT%start-services.bat'; $s.WorkingDirectory='%ROOT%'; $s.Save(); Write-Host 'Desktop icon created.' } catch { Write-Host 'Could not create a desktop icon (blocked on this PC) - that is fine, just run start-services.bat directly from this folder whenever you need to.' }"
REM Start it now too, so today doesn't need a reboot to test.
wscript.exe "%ROOT%run-all-hidden.vbs"

echo === 4/4 Tailscale (public address for phones) ===
set "TS=%ProgramFiles%\Tailscale\tailscale.exe"
if not exist "%TS%" (
  winget install -e --id Tailscale.Tailscale --accept-source-agreements --accept-package-agreements
)
if not exist "%TS%" (
  echo Tailscale could not be installed automatically. Install it from tailscale.com, then run this file again.
  pause & exit /b 1
)
echo A sign-in link will appear below (or a browser will open). Sign in with your Tailscale account.
"%TS%" up --unattended
"%TS%" funnel --bg 4000
echo.
echo If a link was shown above, open it once to allow Funnel, then run this file again.
echo.
"%TS%" funnel status

echo.
echo DONE. Copy the https://....ts.net address above - that's what you open in
echo Chrome on each phone and tap Install.
echo.
echo Now separately install "CounterCall Counter App Setup.exe" (the printer
echo service) if you haven't already - see CLAUDE.md.
echo.
echo Sign out and back in once to confirm relay-server starts by itself:
echo http://localhost:4000/health should respond, and the CounterCall Counter
echo App tray icon should appear too.
pause
