' Launches run.bat with no visible console window.
Set objShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
objShell.Run "cmd /c """ & scriptDir & "\run.bat""", 0, False
