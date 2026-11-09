' Launches manifest-generator.py with no console window.
'
' Resolves its own folder rather than hard-coding a path, so the same file works
' whether it runs from the git working tree or from the deployed copy in
' C:\Homesavers\scripts (see deploy-scripts.ps1). Scheduled tasks point at the
' deployed copy, so a branch switch in the repo can never change what runs.
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

Set sh = CreateObject("WScript.Shell")

' Same lookup order as run_sync.bat: the path setup-new-pc.ps1 recorded first.
pyExe = ""
If fso.FileExists("C:\Homesavers\python-path.txt") Then
  Set ts = fso.OpenTextFile("C:\Homesavers\python-path.txt", 1)
  If Not ts.AtEndOfStream Then pyExe = Trim(ts.ReadLine)
  ts.Close
End If
If pyExe = "" Or Not fso.FileExists(pyExe) Then pyExe = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%\Programs\Python\Python313\python.exe")
If Not fso.FileExists(pyExe) Then pyExe = "C:\Users\shayas\AppData\Local\Programs\Python\Python313\python.exe"
If Not fso.FileExists(pyExe) Then pyExe = "python"

sh.Run """" & pyExe & """ """ & scriptDir & "\manifest-generator.py""", 0, True
Set sh = Nothing
Set fso = Nothing
