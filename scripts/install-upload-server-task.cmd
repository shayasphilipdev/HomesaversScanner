@echo off
REM ============================================================================
REM  One-click installer for the local upload server.
REM
REM  The Manual Upload buttons in Admin -> Settings POST the .xlsx to a small
REM  Python server on http://localhost:8765, which parses it with pandas and
REM  forwards the rows to the API. Cloudflare cannot parse a 20 MB / 227k-row
REM  workbook inside a Worker, and this keeps the sync secret on the PC instead
REM  of in the browser.
REM
REM  It had no autostart of any kind, so it was only ever running if someone
REM  had started it by hand since the last reboot. This registers it to start
REM  at logon, like every other Homesavers job on this machine.
REM
REM  Runs as YOU at logon (not SYSTEM) so it can read C:\Homesavers\.sync-secret
REM  and reach the network shares, and windowless under pythonw.exe so it does
REM  not park a console on the desktop. The server logs to
REM  C:\Homesavers\logs\upload-server.log regardless of whether a console
REM  exists.
REM
REM  HOW TO USE:
REM    1. Double-click this file. No admin rights needed - it is a per-user task.
REM    2. Check it worked:  curl http://localhost:8765/health
REM
REM  Useful follow-ups:
REM    schtasks /Run    /TN "%TASKNAME%"     (start it now)
REM    schtasks /Query  /TN "%TASKNAME%" /V  (status / last result)
REM    schtasks /Delete /TN "%TASKNAME%" /F  (remove it)
REM ============================================================================

setlocal
set "TASKNAME=Homesavers Upload Server"
set "SERVER=%~dp0local_upload_server.py"

REM pythonw.exe = no console window. Fall back to python.exe if it is missing.
set "PYW=C:\Users\%USERNAME%\AppData\Local\Programs\Python\Python313\pythonw.exe"
if not exist "%PYW%" set "PYW=pythonw"

echo.
echo Registering scheduled task "%TASKNAME%"
echo   runner : %PYW%
echo   script : %SERVER%
echo.

schtasks /Create /TN "%TASKNAME%" /SC ONLOGON /F /RL LIMITED ^
  /TR "\"%PYW%\" \"%SERVER%\""

if errorlevel 1 (
  echo.
  echo FAILED to register the task.
  pause
  exit /b 1
)

echo.
echo Starting it now...
schtasks /Run /TN "%TASKNAME%" >nul 2>&1

echo.
echo Done. Verify with:  curl http://localhost:8765/health
echo Log: C:\Homesavers\logs\upload-server.log
pause
