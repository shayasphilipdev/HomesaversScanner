' Launches manifest-generator.py with no console window.
'
' Resolves its own folder rather than hard-coding a path, so the same file works
' whether it runs from the git working tree or from the deployed copy in
' C:\Homesavers\scripts (see deploy-scripts.ps1). Scheduled tasks point at the
' deployed copy, so a branch switch in the repo can never change what runs.
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

pyExe = "C:\Users\shayas\AppData\Local\Programs\Python\Python313\python.exe"
If Not fso.FileExists(pyExe) Then pyExe = "python"

Set sh = CreateObject("WScript.Shell")
sh.Run """" & pyExe & """ """ & scriptDir & "\manifest-generator.py""", 0, True
Set sh = Nothing
Set fso = Nothing
