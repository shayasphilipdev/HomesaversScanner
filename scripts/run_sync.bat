@echo off
setlocal
:: ============================================================
:: run_sync.bat — Homesavers Scanner sync
::
:: Usage:
::   run_sync.bat prices       — import latest ItemMaster_*.xlsx → prices table
::   run_sync.bat alt-barcodes — import latest ALT Barcode Master_*.xlsx
::   run_sync.bat all          — run both in sequence
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

echo Unknown job: %JOB%. Use prices, alt-barcodes, or all.
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


:end
echo [%DATE% %TIME%] Sync %JOB% done.
