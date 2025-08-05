@echo off
chcp 65001 >nul

echo ================================
echo  Local Server for Chart Editor
echo ================================
echo.

cd /d "%~dp0"

echo Starting server on port 8080...
echo Open browser: http://localhost:8080
echo Press Ctrl+C to stop server
echo.

timeout /t 3 >nul
start "" "http://localhost:8080"

npx http-server -p 8080 -c-1 --cors

pause