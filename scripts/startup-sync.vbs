
' Homesavers daily sync — runs at login, hidden, in your session.
' Place a shortcut to this file in your Startup folder.
' (Win+R -> shell:startup -> paste shortcut here)

Dim WshShell
Set WshShell = CreateObject("WScript.Shell")

' Wait 3 minutes after login for network share to be ready
WScript.Sleep 180000

' Run alt-barcode sync (hidden window)
WshShell.Run "powershell.exe -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File ""C:\Scraping\homesavers-scanner\scripts\sync-alt-barcodes.ps1""", 0, True

' Run prices sync after alt-barcodes finishes (hidden window)
WshShell.Run "powershell.exe -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File ""C:\Scraping\homesavers-scanner\scripts\sync-prices.ps1""", 0, True
