@echo off
chcp 65001 >nul
echo ================================
echo  Rhythm Chart Editor - Local Server
echo ================================
echo.

REM 현재 디렉토리로 이동
cd /d "%~dp0"

REM Node.js 설치 확인
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed.
    echo.
    echo To install Node.js:
    echo 1. Download Node.js LTS from https://nodejs.org
    echo 2. Run this file again after installation.
    echo.
    pause
    exit /b 1
)

echo Node.js version: 
node --version
echo.

REM http-server 패키지 확인 및 설치
echo Checking http-server package...
npx http-server --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Installing http-server...
    npm install -g http-server
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to install http-server.
        echo Try running as administrator or install manually:
        echo npm install -g http-server
        echo.
        pause
        exit /b 1
    )
)

echo.
echo ================================
echo  서버를 시작합니다...
echo ================================
echo.
echo 브라우저에서 다음 주소로 접속하세요:
echo http://localhost:8080
echo.
echo 서버를 중지하려면 Ctrl+C를 누르세요.
echo.

REM 기본 브라우저에서 자동으로 열기 (5초 후)
start "" "http://localhost:8080" 2>nul

REM http-server 실행 (포트 8080, CORS 허용, 캐시 비활성화)
npx http-server -p 8080 -c-1 --cors

echo.
echo 서버가 종료되었습니다.
pause