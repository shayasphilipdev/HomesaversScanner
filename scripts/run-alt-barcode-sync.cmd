@echo off
REM ============================================================================
REM  Runner for the Homesavers Alternate-Barcode sync.
REM  Windows Task Scheduler calls THIS file (see install-alt-barcode-task.cmd).
REM  It just launches the PowerShell job sitting next to it, passing through any
REM  extra arguments (e.g. -DryRun) so you can also run it by hand:
REM
REM      run-alt-barcode-sync.cmd            (normal run)
REM      run-alt-barcode-sync.cmd -DryRun    (parse + map only, no upload)
REM
REM  %~dp0 expands to this file's own folder, so the path keeps working even if
REM  the project is moved.
REM ============================================================================
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0sync-alt-barcodes.ps1" %*
exit /b %ERRORLEVEL%
