; Runs on uninstall. The watchdog's Startup-folder shortcut lives outside
; the app's own install directory (in the user's Startup folder), so the
; default electron-builder uninstaller doesn't know to remove it - without
; this, an uninstalled app would still get relaunched forever by a shortcut
; pointing at a batch file whose target no longer exists. See
; src/watchdog.js and CLAUDE.md's "Windows auto-start" section.
!macro customUnInstall
  Delete "$SMSTARTUP\CounterCall Counter App Watchdog.lnk"
!macroend
