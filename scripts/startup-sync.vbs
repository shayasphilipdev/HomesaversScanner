
' Homesavers daily sync — runs at login, hidden, in your session.
' Place a shortcut to this file in your Startup folder.
' (Win+R -> shell:startup -> paste shortcut here)
'
' NOTE: this file is not actually wired up on the sync PC — there is no
' shortcut to it in the Startup folder, and the real jobs all run from Task
' Scheduler ("Homesavers B&M Daily Sync", "Homesavers CN Code Sync",
' "Homesavers Manifest", "Alt-barcodes-ScannerApp", ...). Kept for reference.
'
' The local upload server is deliberately NOT started here. It has its own
' scheduled task (install-upload-server-task.cmd -> "Homesavers Upload
' Server"). Starting it from two places would race for port 8765 and the
' second instance would die on bind.

Dim WshShell
Set WshShell = CreateObject("WScript.Shell")

' Wait 3 minutes after login for network share to be ready
WScript.Sleep 180000

' Run alt-barcode sync (hidden window)
WshShell.Run "powershell.exe -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File ""C:\Scraping\homesavers-scanner\scripts\sync-alt-barcodes.ps1""", 0, True

' Run prices sync after alt-barcodes finishes (hidden window)
WshShell.Run "powershell.exe -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File ""C:\Scraping\homesavers-scanner\scripts\sync-prices.ps1""", 0, True
