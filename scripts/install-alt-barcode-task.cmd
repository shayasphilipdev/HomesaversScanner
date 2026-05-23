@echo off
REM ============================================================================
REM  One-click installer for the daily Alternate-Barcode sync.
REM  Registers a Windows Task Scheduler job that runs the sync every day
REM  at 07:00 as YOU (the logged-on user) so the mapped Y: network drive is
REM  visible — a SYSTEM-level task would not see your mapped drives.
REM
REM  HOW TO USE:
REM    1. Right-click this file -> "Run as administrator".
REM    2. That's it. To change the time, edit RUNTIME below and re-run.
REM    3. Also set the matching time (07:00) in Admin -> Settings.
REM
REM  Useful follow-ups (run in an admin Command Prompt):
REM    schtasks /Run    /TN "%TASKNAME%"     (run it now to test)
REM    schtasks /Query  /TN "%TASKNAME%" /V  (see status / last result)
REM    schtasks /Delete /TN "%TASKNAME%" /F  (remove it)
REM ============================================================================

setlocal
set "TASKNAME=Homesavers Alt-Barcode Sync"
set "RUNTIME=07:00"
set "RUNNER=%~dp0run-alt-barcode-sync.cmd"

echo.
echo Registering scheduled task "%TASKNAME%"
echo   Runs:    daily at %RUNTIME%
echo   Command: %RUNNER%
echo   As user: %USERDOMAIN%\%USERNAME% (only when you are logged on)
echo.

schtasks /Create ^
  /TN "%TASKNAME%" ^
  /TR "\"%RUNNER%\"" ^
  /SC DAILY ^
  /ST %RUNTIME% ^
  /RL HIGHEST ^
  /RU "%USERDOMAIN%\%USERNAME%" ^
  /IT ^
  /F

if %ERRORLEVEL% EQU 0 (
  echo.
  echo SUCCESS: task created. It will run daily at %RUNTIME%.
  echo Tip: test it now with:  schtasks /Run /TN "%TASKNAME%"
) else (
  echo.
  echo FAILED ^(error %ERRORLEVEL%^). Make sure you ran this "as administrator".
)
echo.
pause
endlocal
