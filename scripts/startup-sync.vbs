
' Homesavers daily sync — runs at login, hidden, in your session.
' Place a shortcut to this file in your Startup folder.
' (Win+R -> shell:startup -> paste shortcut here)

Dim WshShell
Set WshShell = CreateObject("WScript.Shell")

' Local upload server for the admin page's Manual Upload buttons
' (http://localhost:8765). Started FIRST and non-blocking (the False argument),
' because it never exits — it serves until logoff. It had no autostart at all
' before, so it was only ever running if someone had run
' "run_sync.bat server" by hand since the last reboot, which is half the reason
' Manual Upload appeared to be broken.
WshShell.Run "cmd /c ""C:\Scraping\homesavers-scanner\scripts\run_sync.bat"" server", 0, False

' Wait 3 minutes after login for network share to be ready
WScript.Sleep 180000

' Run alt-barcode sync (hidden window)
WshShell.Run "powershell.exe -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File ""C:\Scraping\homesavers-scanner\scripts\sync-alt-barcodes.ps1""", 0, True

' Run prices sync after alt-barcodes finishes (hidden window)
WshShell.Run "powershell.exe -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File ""C:\Scraping\homesavers-scanner\scripts\sync-prices.ps1""", 0, True
