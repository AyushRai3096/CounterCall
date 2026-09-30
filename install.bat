@echo off
REM ONE-TIME setup for the counter PC. Extract/clone this project into its
REM PERMANENT folder first (e.g. C:\CounterCall), THEN right-click this file
REM here and choose "Run as administrator". Safe to run again.
REM
REM Unlike the old setup-counter-pc.bat, this does NOT run "npm install" on
REM this machine - the relay-server and counter-service node_modules folders
REM are already included in the download, prebuilt, so there is nothing to
REM compile here (no Python, no Visual Studio, no node-gyp).
REM
REM Auto-start: a shortcut in the current user's Windows Startup folder runs
REM run-all-hidden.vbs the moment that user signs in - no Task Scheduler, no
REM SYSTEM account. Both services run with no visible window and restart
REM themselves if they crash (relay-server\run.bat, counter-service\run.bat).

setlocal enabledelayedexpansion
cd /d "%~dp0"
set "ROOT=%~dp0"

net session >nul 2>&1
if errorlevel 1 (
  echo Please right-click this file and choose "Run as administrator".
  pause & exit /b 1
)

echo === 1/5 Checking the download ===
if not exist "counter-service\node_modules\better-sqlite3" (
  echo counter-service\node_modules is missing or incomplete.
  echo Re-download the project ^(the ZIP or clone must include node_modules^) and run this again.
  pause & exit /b 1
)
if not exist "relay-server\node_modules\socket.io" (
  echo relay-server\node_modules is missing or incomplete.
  echo Re-download the project ^(the ZIP or clone must include node_modules^) and run this again.
  pause & exit /b 1
)
echo OK - dependencies are already included, nothing to install.

echo === 2/5 Node.js ===
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

echo === 3/5 Printer ===
if not exist "%ProgramFiles%\SumatraPDF\SumatraPDF.exe" if not exist "%ProgramFiles(x86)%\SumatraPDF\SumatraPDF.exe" (
  winget install -e --id SumatraPDF.SumatraPDF --scope machine --accept-source-agreements --accept-package-agreements
)
if not exist counter-service\.env (
  echo Installed printers on this PC:
  powershell -NoProfile -Command "Get-Printer | Select-Object -ExpandProperty Name"
  set /p PNAME=Type the kitchen printer name exactly as listed above:
  > counter-service\.env (
    echo RELAY_URL=http://localhost:4000
    echo PRINTER_NAME=!PNAME!
  )
) else (
  echo counter-service\.env already exists, keeping it.
)

echo === 4/5 Start automatically when you sign in ===
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
powershell -NoProfile -Command "try { $s=(New-Object -ComObject WScript.Shell).CreateShortcut('%STARTUP%\CounterCall.lnk'); $s.TargetPath='wscript.exe'; $s.Arguments='\"%ROOT%run-all-hidden.vbs\"'; $s.WorkingDirectory='%ROOT%'; $s.Save(); Write-Host 'Startup shortcut created.' } catch { Write-Host 'Could not create the Startup-folder shortcut (some PCs block creating shortcuts) - the services will not start by themselves. Run start-services.bat manually instead.' }"
REM Desktop icon is only a manual-start convenience, so a policy blocking it
REM isn't fatal - start-services.bat in this same folder does the same thing.
powershell -NoProfile -Command "try { $s=(New-Object -ComObject WScript.Shell).CreateShortcut('%PUBLIC%\Desktop\Start CounterCall.lnk'); $s.TargetPath='%ROOT%start-services.bat'; $s.WorkingDirectory='%ROOT%'; $s.Save(); Write-Host 'Desktop icon created.' } catch { Write-Host 'Could not create a desktop icon (blocked on this PC) - that is fine, just run start-services.bat directly from this folder whenever you need to.' }"
REM Start both now too, so today doesn't need a reboot to test.
wscript.exe "%ROOT%run-all-hidden.vbs"

echo === 5/5 Tailscale (public address for phones) ===
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
echo Sign out and back in once to confirm it starts by itself: check
echo counter-service\logs\counter-service.log for a fresh line.
pause
