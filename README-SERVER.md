# 🚀 로컬 서버 실행 가이드

ES6 모듈을 사용하는 Rhythm Chart Editor를 로컬에서 테스트하기 위한 서버 실행 방법입니다.

## 📁 제공되는 파일들

### 1. `start-server.bat` (권장)
- **Node.js 기반 HTTP 서버**
- CORS 지원 및 캐시 비활성화
- 포트: 8080
- 자동 브라우저 열기

### 2. `start-python-server.bat` (대안)
- **Python 기반 HTTP 서버**
- Python 3/2 자동 감지
- 포트: 8000
- 자동 브라우저 열기

## 🔧 사용 방법

### Node.js 서버 (권장)
1. `start-server.bat` 더블클릭
2. Node.js가 없으면 자동으로 설치 안내
3. http-server 패키지 자동 설치
4. 브라우저가 자동으로 열림 (`http://localhost:8080`)

### Python 서버 (대안)
1. `start-python-server.bat` 더블클릭  
2. Python이 없으면 설치 안내
3. 브라우저가 자동으로 열림 (`http://localhost:8000`)

## ⚠️ 문제 해결

### CORS 에러가 발생하는 경우
- ❌ `file://` 프로토콜로 직접 열기
- ✅ HTTP 서버를 통해 접속하기

### Node.js 설치가 필요한 경우
1. https://nodejs.org 방문
2. LTS 버전 다운로드 및 설치
3. `start-server.bat` 재실행

### Python 설치가 필요한 경우
1. https://www.python.org/downloads/ 방문
2. 최신 버전 다운로드
3. **중요**: 설치 시 "Add Python to PATH" 체크
4. `start-python-server.bat` 재실행

## 🌐 GitHub Pages
- 로컬 테스트 완료 후 GitHub에 푸시하면 자동 배포
- GitHub Pages에서는 CORS 문제 없이 정상 작동

## 🛑 서버 중지
- **Ctrl + C** 키를 눌러 서버 중지
- 터미널 창을 닫아도 서버 중지

---

**💡 팁**: 개발 중에는 Node.js 서버를 사용하는 것을 권장합니다. 더 빠르고 안정적입니다!