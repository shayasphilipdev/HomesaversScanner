@echo off
:: ============================================================
:: setup_venv.bat — one-time setup for Homesavers Scanner sync
:: Creates a Python virtual environment and installs dependencies.
:: Run this once before using run_sync.bat.
:: ============================================================

set VENV_DIR=C:\Scraping\homesavers-scanner\.venv

echo Creating virtual environment at %VENV_DIR% ...
python -m venv "%VENV_DIR%"
if errorlevel 1 (
    echo ERROR: Failed to create venv. Make sure Python is installed.
    exit /b 1
)

echo Installing dependencies...
"%VENV_DIR%\Scripts\pip.exe" install pandas openpyxl requests

if errorlevel 1 (
    echo ERROR: pip install failed.
    exit /b 1
)

echo.
echo Setup complete. You can now run:
echo   scripts\run_sync.bat prices
echo   scripts\run_sync.bat alt-barcodes
echo   scripts\run_sync.bat server
