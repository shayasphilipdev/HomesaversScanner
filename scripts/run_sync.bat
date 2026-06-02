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
:: Uses the PriceTracker virtual environment (pandas + openpyxl already installed).
:: ============================================================

set VENV_PYTHON=C:\Scraping\PriceTracker\.venv\Scripts\python.exe
set SCRIPTS_DIR=%~dp0

if not exist "%VENV_PYTHON%" (
    echo ERROR: PriceTracker venv not found at %VENV_PYTHON%
    exit /b 1
)

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
"%VENV_PYTHON%" "%SCRIPTS_DIR%sync-prices.py"
goto end


:run_alt_barcodes
"%VENV_PYTHON%" "%SCRIPTS_DIR%sync-alt-barcodes.py"
goto end


:run_all
call "%~f0" prices
call "%~f0" alt-barcodes
goto end


:run_server
echo [%DATE% %TIME%] Starting local upload server on http://localhost:8765 ...
"%VENV_PYTHON%" "%SCRIPTS_DIR%local_upload_server.py"
goto end


:end
echo [%DATE% %TIME%] Sync %JOB% done.
