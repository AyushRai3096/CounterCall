@echo off
REM ONE-TIME setup for the counter PC. Right-click > Run as administrator.
REM Installs what's missing (Node.js, SumatraPDF, Tailscale), installs the packages, writes the
REM printer config, makes the relay + counter service start at every Windows boot
REM (before anyone signs in, restart on crash), and publishes the relay at a
REM permanent https address that the phones use. Safe to run again.
setlocal enabledelayedexpansion
cd /d "%~dp0"
set "ROOT=%~dp0"

net session >nul 2>&1
if errorlevel 1 (
  echo Please right-click this file and choose "Run as administrator".
  pause & exit /b 1
)

echo === 1/6 Node.js ===
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

echo === 2/6 Installing packages ===
pushd relay-server && call npm install && popd
pushd counter-service && call npm install && popd

echo === 3/6 Printer ===
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

echo === 4/6 Start at every boot ===
schtasks /create /tn "CounterCallRelayServer" /tr "cmd /c \"%ROOT%relay-server\run.bat\"" /sc onstart /ru SYSTEM /rl highest /f
schtasks /create /tn "CounterCallCounterService" /tr "cmd /c \"%ROOT%counter-service\run.bat\"" /sc onstart /ru SYSTEM /rl highest /f
schtasks /run /tn "CounterCallRelayServer"
schtasks /run /tn "CounterCallCounterService"
REM Desktop icon for everyone that starts the services by hand, as a backup.
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%PUBLIC%\Desktop\Start CounterCall.lnk'); $s.TargetPath='%ROOT%start-services.bat'; $s.WorkingDirectory='%ROOT%'; $s.Save()"
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0

echo === 5/6 Tailscale ===
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

echo === 6/6 Public https address ===
"%TS%" funnel --bg 4000
echo.
echo If a link was shown above, open it once to allow Funnel, then run this file again.
echo.
"%TS%" funnel status
echo.
echo DONE. The https://....ts.net address above is what you open in Chrome on each phone and tap Install.
pause
