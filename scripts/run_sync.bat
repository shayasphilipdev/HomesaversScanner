@echo off
setlocal
:: ============================================================
:: run_sync.bat — Homesavers Scanner sync
::
:: Usage:
::   run_sync.bat prices       — import latest ItemMaster_*.xlsx → prices table
::   run_sync.bat alt-barcodes — import latest ALT Barcode Master_*.xlsx
::   run_sync.bat all          — run both in sequence
::   run_sync.bat server       — start local upload server (http://localhost:8765)
::
:: Uses the base Python install. The .venv copy in this (untrusted) folder was
:: quarantined/zeroed by antivirus after it made network calls; the base
:: install has requests + pandas + openpyxl and is AV-safe.
:: ============================================================

set PYEXE=C:\Users\shayas\AppData\Local\Programs\Python\Python313\python.exe
if not exist "%PYEXE%" set PYEXE=py
set SCRIPTS_DIR=%~dp0

set JOB=%1
if "%JOB%"=="" (
    echo Usage: run_sync.bat [prices^|alt-barcodes^|all]
    exit /b 1
)

echo [%DATE% %TIME%] Starting sync: %JOB%

if /i "%JOB%"=="prices"       goto run_prices
if /i "%JOB%"=="alt-barcodes" goto run_alt_barcodes
if /i "%JOB%"=="all"          goto run_all
if /i "%JOB%"=="server"       goto run_server

echo Unknown job: %JOB%. Use prices, alt-barcodes, all, or server.
exit /b 1


:run_prices
"%PYEXE%" "%SCRIPTS_DIR%sync-prices.py"
goto end


:run_alt_barcodes
"%PYEXE%" "%SCRIPTS_DIR%sync-alt-barcodes.py"
goto end


:run_all
call "%~f0" prices
call "%~f0" alt-barcodes
goto end


:run_server
echo [%DATE% %TIME%] Starting local upload server on http://localhost:8765 ...
"%PYEXE%" "%SCRIPTS_DIR%local_upload_server.py"
goto end


:end
echo [%DATE% %TIME%] Sync %JOB% done.
