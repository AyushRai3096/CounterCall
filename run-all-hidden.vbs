' Starts both services with no visible window, each in its own crash-restart
' loop. This is what the Startup-folder shortcut points at, so both start
' automatically the moment someone signs in - no Task Scheduler, no SYSTEM
' account, no admin rights needed for this step.
Set objShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

objShell.Run "wscript.exe """ & scriptDir & "\relay-server\run-hidden.vbs""", 0, False
objShell.Run "wscript.exe """ & scriptDir & "\counter-service\run-hidden.vbs""", 0, False
