@echo off
title YouTube Data Extractor - Server
echo.
echo  ============================================
echo   YouTube Data Extractor - Starting Server
echo  ============================================
echo.

:: Navigate to the script directory (where this .bat file lives)
cd /d "%~dp0"
echo  Working directory: %CD%

:: Check if Python is available
python --version >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] Python is not installed or not in PATH.
    echo  Please install Python from https://python.org
    pause
    exit /b 1
)

:: Check if requirements are installed
echo  Checking dependencies...
pip show fastapi >nul 2>&1
if errorlevel 1 (
    echo  Installing dependencies...
    pip install -r requirements.txt
    echo.
)

echo.
echo  ============================================
echo   Server starting at: http://localhost:9000
echo  ============================================
echo.
echo  Open your browser and go to:
echo  http://localhost:9000
echo.
echo  Press Ctrl+C to stop the server.
echo  ============================================
echo.

:: Open browser automatically
start "" "http://localhost:9000"

:: Start the server (port 9000 to avoid conflicts with AutoTube)
python -m uvicorn main:app --host 127.0.0.1 --port 9000
pause
