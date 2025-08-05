@echo off
echo ================================
echo  Rhythm Chart Editor - Python Server
echo ================================
echo.

REM 현재 디렉토리로 이동
cd /d "%~dp0"

REM Python 설치 확인 (Python 3 우선)
python --version >nul 2>&1
if %errorlevel% equ 0 (
    echo Python 버전:
    python --version
    echo.
    echo ================================
    echo  Python 서버를 시작합니다...
    echo ================================
    echo.
    echo 브라우저에서 다음 주소로 접속하세요:
    echo http://localhost:8000
    echo.
    echo 서버를 중지하려면 Ctrl+C를 누르세요.
    echo.
    
    REM 기본 브라우저에서 자동으로 열기
    start "" "http://localhost:8000" 2>nul
    
    REM Python 3 HTTP 서버 실행
    python -m http.server 8000
    goto :end
)

REM Python 2 확인 (레거시)
python2 --version >nul 2>&1
if %errorlevel% equ 0 (
    echo Python 2 버전:
    python2 --version
    echo.
    echo ================================
    echo  Python 2 서버를 시작합니다...
    echo ================================
    echo.
    echo 브라우저에서 다음 주소로 접속하세요:
    echo http://localhost:8000
    echo.
    echo 서버를 중지하려면 Ctrl+C를 누르세요.
    echo.
    
    REM 기본 브라우저에서 자동으로 열기
    start "" "http://localhost:8000" 2>nul
    
    REM Python 2 HTTP 서버 실행
    python2 -m SimpleHTTPServer 8000
    goto :end
)

REM Python이 설치되지 않은 경우
echo [ERROR] Python이 설치되지 않았습니다.
echo.
echo Python을 설치하려면:
echo 1. https://www.python.org/downloads/ 에서 Python 다운로드
echo 2. 설치 시 "Add Python to PATH" 옵션 체크
echo 3. 설치 후 이 파일을 다시 실행하세요.
echo.
echo 또는 start-server.bat 파일로 Node.js 서버를 사용하세요.
echo.

:end
pause