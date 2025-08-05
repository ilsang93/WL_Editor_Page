@echo off
chcp 65001 >nul

echo ================================
echo  Python Local Server
echo ================================
echo.

cd /d "%~dp0"

echo Starting Python server on port 8000...
echo Open browser: http://localhost:8000
echo Press Ctrl+C to stop server
echo.

timeout /t 3 >nul
start "" "http://localhost:8000"

python -m http.server 8000

pause