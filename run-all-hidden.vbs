' Starts relay-server with no visible window, in its own crash-restart loop.
' This is what the Startup-folder shortcut points at, so it starts
' automatically the moment someone signs in - no Task Scheduler, no SYSTEM
' account, no admin rights needed for this step.
'
' counter-app (the Electron print service) is NOT started here - it's a
' packaged installed app with its own auto-start (Electron's
' setLoginItemSettings, a registry Run key set on first launch) and its own
' install step. See CLAUDE.md's "printed ticket" / auto-start sections.
Set objShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

objShell.Run "wscript.exe """ & scriptDir & "\relay-server\run-hidden.vbs""", 0, False
