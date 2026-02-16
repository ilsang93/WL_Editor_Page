# WL Editor Page - Rhythm Chart Editor 기술 명세서

> 생성일: 2026-02-17
> 분석 기준: 실제 소스코드 분석

---

## 1. 프로젝트 개요

**이름**: Rhythm Chart Editor (WL Editor Page)
**목적**: Unity 기반 리듬 게임의 노트 차트를 시각적으로 편집하고 JSON으로 내보내는 웹 에디터
**특성**: 빌드 도구 없음, 순수 Vanilla JS (ES6 Modules), 프레임워크 없음

---

## 2. 기술 스택

| 항목 | 상세 |
|------|------|
| 언어 | HTML5, CSS3, JavaScript ES6+ |
| 렌더링 | Canvas API (2D), OffscreenCanvas |
| 오디오 | Web Audio API, HTML5 Audio |
| 저장소 | localStorage (자동저장, 캘리브레이션) |
| 모듈 시스템 | ES6 Native Modules (`type="module"`) |
| 배포 | GitHub Pages / 로컬 HTTP 서버 (포트 8080) |
| 빌드 | 없음 (파일 직접 서빙) |

---

## 3. 파일 구조

```
WL_Editor_Page/
├── index.html              # 메인 UI 마크업
├── style.css               # CSS 스타일 (--sidebar-width: 520px)
├── script.js               # 핵심 로직 (~261KB, 6500줄+)
├── utils.js                # 수학/타이밍/좌표 변환 유틸
├── canvas.js               # Canvas 그리기 함수 모음
├── audio.js                # 오디오 처리 (SoundPool, 웨이브폼)
├── events.js               # 이벤트 데이터 관리
├── event-config.js         # 이벤트 타입/파라미터 설정
├── notes.js                # 노트 검증, JSON 변환
├── audio-sync-module.js    # 오디오 동기화 (Mac 지연 보정)
├── sfx/
│   └── tab.wav             # 노트 SFX 효과음
├── start-server.bat        # Node.js HTTP 서버 실행 (포트 8080)
├── start-python-server.bat # Python HTTP 서버 실행 (포트 8000)
└── README-SERVER.md        # 로컬 서버 실행 가이드
```

---

## 4. UI 구조

```
┌─────────────────────────────────────────────────────────┐
│ TOP BAR: Save JSON | Load JSON | Sort | Clear | Undo/Redo | Volume │
├──────────────────┬──────────────────────────────────────┤
│   SIDEBAR        │         CANVAS AREA                  │
│ ┌──────────────┐ │  (background-canvas + canvas 이중 레이어)│
│ │ BPM / MinBPM │ │                                      │
│ │ MaxBPM       │ │   → 경로(Path) 시각화                │
│ │ 배속         │ │   → 노트 배치                        │
│ │ Pre-delay    │ │   → 그리드/자 표시                   │
│ │ Level        │ │   → 데모 플레이어 위치               │
│ │ Subdivisions │ │                                      │
│ │ 일괄 수정    │ │                                      │
│ ├──────────────┤ │                                      │
│ │ NoteList 탭  │ │                                      │
│ │ EventList 탭 │ │                                      │
│ │              │ │                                      │
│ │  (가상 스크롤)│ │                                      │
│ └──────────────┘ │                                      │
└──────────────────┴──────────────────────────────────────┘
         CONTROL BAR (우하단 플로팅):
         [오디오 파일] [⏸ ▶ ⏹] [타임라인 시크바]
         [Tab+] [Dir+] [Both+] [Node+]
         [LongTab+] [LongDir+] [LongBoth+]
         [카메라 추적] [실시간 그리기] [그리기 시간차]
         [좌표 정보 패널]
```

---

## 5. 노트 타입 시스템

### 5.1 7가지 노트 타입

| 내부 이름 | JSON 이름 | 시각화 | 설명 |
|-----------|-----------|--------|------|
| `tab` | `Tab` | 핑크 원 (#FF6B6B, 테두리 #4CAF50) | 단순 탭 노트 |
| `direction` | `Direction` | 초록 화살표 | 방향 전환 노트 (경로 정의) |
| `both` | `Both` | 보라 원 + 화살표 (#9C27B0) | 탭+방향 동시 |
| `node` | `Node` | 회색 원 (#607D8B, -30px 위) + BPM 텍스트 | 경로 노드 (BPM/속도 변환점) |
| `longtab` | `LongTab` | 탭과 동일 + 롱바 | 홀드 탭 |
| `longdirection` | `LongDirection` | 방향과 동일 + 롱바 | 홀드 방향 |
| `longboth` | `LongBoth` | Both와 동일 + 롱바 | 홀드 Both |

### 5.2 노트 데이터 구조 (내부)

```javascript
{
  type: "tab" | "direction" | "both" | "node" | "longtab" | "longdirection" | "longboth",
  beat: Number,          // 박자 위치 (subdivisions 기준)
  direction: "up" | "down" | "left" | "right" | "upleft" | "upright" | "downleft" | "downright" | "none",
  isLong: Boolean,       // 롱노트 여부
  longTime: Number,      // 롱노트 길이 (박자 단위)
  bpm: Number,           // 개별 BPM (없으면 글로벌 BPM 사용)
  subdivisions: Number,  // 개별 세분음 (없으면 글로벌 subdivisions 사용)
  fade: Boolean,         // BPM 페이드 여부
  wait: Boolean,         // (node만) 정지 여부
  fadeDirectTime: Number // (fade 구간 tab/longtab) 직접 시간값
}
```

### 5.3 방향 벡터 매핑

```
up      → [0, -1]      upright  → [1, -1]
down    → [0, 1]       downleft → [-1, 1]
left    → [-1, 0]      downright→ [1, 1]
right   → [1, 0]       upleft   → [-1, -1]
```

---

## 6. 타이밍 시스템

### 6.1 핵심 변환 공식

```javascript
// beat → time
beatToTime(beat, bpm, subdivisions):
  subdivisionDuration = (60 / bpm) / subdivisions
  return beat × subdivisionDuration

// time → beat
timeToBeat(time, bpm, subdivisions):
  subdivisionDuration = (60 / bpm) / subdivisions
  return time / subdivisionDuration
```

### 6.2 시간 기준

- **originalTime**: 박자 기반 계산 시간 (초)
- **preDelaySeconds**: Pre-delay ms → 초 변환값 (기본 3.0)
- **finalTime**: `originalTime + preDelaySeconds` (beat 0 direction 노트 예외: 0)
- **musicTime**: `3.0 + originalTime` (음악 시작이 항상 3초)

### 6.3 Pre-delay 역할

- 음악 재생 전 대기 시간 (기본 3000ms = 3초)
- 카운트다운 애니메이션 시간으로 사용
- beat 0의 direction 노트는 pre-delay 무시 (finalTime = 0)

---

## 7. 경로(Path) 시스템

### 7.1 경로 계산 흐름

```
direction 노트 + node 노트
        ↓
calculatePathDirectionNotes()   → finalTime, pathBeat 계산
        ↓
calculateNodePositions()        → 누적 월드 좌표(nodePositions), segmentTimes 계산
        ↓
drawPathSegments()              → Canvas에 경로 렌더링
```

### 7.2 이동 속도 공식 (Unity 연동)

```javascript
// Unity 공식
distance = deltaTime × multiplierConstant × bpm
multiplierConstant = 0.4 × speedMultiplier

// 에디터 기준
editorMovementPerBeat = 24 × speedMultiplier

// 변환 비율
ratio = unityMovementPerBeat / editorMovementPerBeat
```

### 7.3 노드 동작

- `wait = false`: 일반 방향 전환점 (캐릭터 계속 이동)
- `wait = true`: 캐릭터 정지 (해당 구간 경로 미표시)

### 7.4 Fade 구간 (BPM 페이드)

BPM이 선형으로 변하는 구간에서의 이동 거리 진행도:

```javascript
calculateFadeProgress(normalizedTime, startBpm, endBpm):
  totalDistance = (startBpm + endBpm) / 2
  currentDistance = startBpm*t + (endBpm-startBpm)*t²/2
  return currentDistance / totalDistance
```

---

## 8. Canvas 렌더링 시스템

### 8.1 이중 레이어 구조

| 레이어 | 캔버스 ID | 내용 | 캐싱 |
|--------|-----------|------|------|
| 하위 | `background-canvas` | 그리드, 경로, 이벤트 마커 | 변경 시만 갱신 |
| 상위 | `canvas` | 노트, 데모 플레이어 | 매 프레임 |

### 8.2 캐시 무효화 조건

`backgroundCache` 무효화:
- zoom 변경
- viewOffset 변경
- notes 배열 변경 (해시 비교)
- BPM/Subdivisions 변경
- 재생 상태 변경

`pathCache` 무효화:
- notes 배열 변경

### 8.3 렌더링 최적화

1. **뷰포트 컬링**: 화면 밖 노트 렌더링 스킵 (margin = max(20, min(100, zoom×3)))
2. **줌 기반 스킵**: zoom < 1.25이면 노트 렌더링 생략 (경로만 표시)
3. **OffscreenCanvas**: 노트 100개 초과 시 오프스크린으로 배치 렌더링
4. **타입별 배치**: 같은 타입 노트를 한 번에 그리기 (beginPath 재활용)
5. **디바운싱**: `pendingRenderFlags`로 불필요한 중복 렌더링 방지

### 8.4 줌/팬 조작

- 마우스 휠: 줌 조절 (기본값 30)
- 마우스 드래그: 팬/이동 (isPanning 플래그)

---

## 9. 오디오 시스템

### 9.1 구성 요소

| 컴포넌트 | 역할 |
|----------|------|
| `demoAudio` (HTML5 Audio) | 음악 재생 |
| `SoundPool` (audio.js) | SFX 폴리포닉 재생 (풀 크기 10) |
| `AudioSyncModule` (audio-sync-module.js) | 플랫폼별 오디오 동기화 |
| Web Audio API | 웨이브폼 시각화 |

### 9.2 AudioSyncModule

- Mac 800ms 지연 문제 해결
- 플랫폼별 최적화 설정:
  - Mac: latencyHint=0, sampleRate=48000
  - Windows: latencyHint='interactive', sampleRate=44100
  - Linux: latencyHint='balanced', sampleRate=44100
- 캘리브레이션 데이터 localStorage 저장 (`rhythm_game_calibration_v2`)

### 9.3 웨이브폼

- `generateWaveformData(audioBuffer, samples=1000)`: 1000개 샘플 추출
- Canvas에 웨이브폼 시각화 (seekbar 위에 표시)

---

## 10. 이벤트 시스템

### 10.1 이벤트 데이터 구조

```javascript
{
  eventType: String,     // 아래 12가지 중 하나
  eventId: String,       // 이벤트 세부 ID
  eventTime: Number,     // 발생 시간 (초)
  eventParams: [
    { paramName: String, paramValue: String | Number | Boolean }
  ]
}
```

### 10.2 이벤트 타입 목록

| 타입 | 이벤트 ID |
|------|-----------|
| `camera` | focus_offset, reset_camera, zoom, rotate, position_from_character, position_from_time, position, damping, position_off |
| `background` | return_default, reset, replace_image, glitch, hologram |
| `character` | clear, glitch, hologram |
| `overlay` | clear, color, glitch, hologram, fog, illusion, flame, replace_image, setadditive |
| `speedshift` | speedup, speeddown, show, dontshow |
| `startrail` | defaultstar, startrail, starfall, none |
| `effect` | firework |
| `postprocessing` | film |
| `light` | setstatic, setnote, setchar, setstaticcolor, setcharcolor, setnotecolor |
| `spotlight` | off, origin, rainbow, color, set |
| `system` | dialog, disableinput, enableinput |
| `custom` | (자유 입력) |

### 10.3 Dialog 이벤트 (system-dialog)

특수 구조: 배열 형태의 dialog items

| 아이템 타입 | 필드 |
|-------------|------|
| `text` | value (텍스트 내용) |
| `character` | value (캐릭터 ID) |
| `focus` | value (포커스 타겟 시간) |
| `focusoff` | 없음 |
| `waitinput` | value (입력 대기 인풋값) |
| `skip` | value (이동할 scene name) |
| `status` | value (캐릭터 표정) |

---

## 11. JSON 내보내기 형식

### 11.1 최상위 구조

```json
{
  "diffIndex": 5,
  "level": 10,
  "bpm": 120,
  "minbpm": 60,
  "maxbpm": 300,
  "subdivisions": 16,
  "preDelay": 3000,
  "noteList": [ /* 노트 배열 */ ],
  "eventList": [ /* 이벤트 배열 */ ],
  "metadata": {
    "description": "...",
    "timingExplanation": "finalTime = 3.0 + originalTime + preDelay (except beat 0 direction)",
    "preDelayUnit": "milliseconds",
    "longTimeUnit": "seconds",
    "bpmExplanation": "...",
    "exportedAt": "ISO8601"
  }
}
```

### 11.2 노트 항목 구조

```json
{
  "beat": 16,
  "bpm": 120,
  "subdivisions": 16,
  "originalTime": 0.5,
  "musicTime": 3.5,
  "finalTime": 3.5,
  "isLong": false,
  "longTime": 0.0,
  "longTimeBeat": 0,
  "noteType": "Tab",
  "direction": "right",
  "fade": false,
  "isWait": false
}
```

### 11.3 이벤트 항목 구조

```json
{
  "eventType": "camera",
  "eventId": "zoom",
  "eventTime": 3.5,
  "eventParams": [
    { "paramName": "distance", "paramValue": 5.0 },
    { "paramName": "fade", "paramValue": 0.5 }
  ]
}
```

### 11.4 파일명 규칙

`XX_${musicName}.json` (예: `XX_MySong.json`)

---

## 12. 차트 검증 규칙

| 규칙 | 내용 |
|------|------|
| 시작 노트 | beat 0에 direction 노트 필수 (없으면 자동 추가, direction="right") |
| 종료 노트 | 마지막 노트 이후 3초 뒤 direction none 노트 자동 추가 |
| 롱노트 중첩 | 롱노트끼리 겹침 금지 |
| 롱탭 범위 내 | tab, direction, both 허용 |
| 롱디렉션 범위 내 | tab만 허용 |
| 롱보스 범위 내 | tab만 허용 |

---

## 13. 상태 관리

### 13.1 주요 전역 변수 (script.js)

```javascript
notes[]             // 노트 배열 (주요 데이터)
zoom                // 줌 레벨 (기본 30)
viewOffset          // { x, y } 뷰포트 오프셋
isPlaying           // 재생 중 여부
isPaused            // 일시정지 여부
isCameraTracking    // 카메라 추적 활성화
musicVolume         // 0.0 ~ 1.0 (기본 0.5)
sfxVolume           // 0.0 ~ 1.0 (기본 1.0)
speedMultiplier     // 1.0 ~ 3.0 (기본 1.0)
selectedNoteIndices // Set<number> - 다중 선택 노트
selectedEventIndices// Set<number> - 다중 선택 이벤트
isBatchEditEnabled  // 일괄 수정 모드
```

### 13.2 Undo/Redo 시스템

- `undoStack[]` / `redoStack[]`: 최대 50개 상태 저장
- 각 상태: notes 배열의 deep copy
- `saveState()`: 현재 상태 스택에 push
- `isPerformingUndoRedo` 플래그로 중복 저장 방지

### 13.3 자동저장

- `localStorage["chartEditorState"]` — BPM, subdivisions, pre-delay, notes, events 포함
- `localStorage["autosave_notes"]` — 노트 배열 별도 저장
- 노트/이벤트 변경 시마다 자동 저장 (디바운스)
- `IndexedDB: ChartEditorDB` (v1, store: audioFiles) — 오디오 파일 영속 저장
  - key: `'currentAudio'`, value: `{ file, name, size, type, lastModified }`

### 13.4 가상 스크롤링

| 대상 | 항목 높이 | 표시 수 | 버퍼 |
|------|-----------|---------|------|
| NoteList | 35px | 50개 | 10개 |
| EventList | 120px (동적) | 동적 | 5개 |

---

## 14. 키보드 단축키

| 키 | 동작 |
|----|------|
| `Ctrl+Z` | 실행 취소 |
| `Ctrl+Y` / `Ctrl+Shift+Z` | 다시 실행 |
| `Ctrl+C` | 선택 노트/이벤트 JSON 복사 |
| `Ctrl+V` | 클립보드 JSON 붙여넣기 |
| `Space` | 전체 선택 해제 |
| `Delete` | 선택 항목 삭제 |
| `q` | Tab 노트 추가 |
| `w` | Direction 노트 추가 |
| `e` | Both 노트 추가 |
| `r` | Node 노트 추가 |
| `a` | Long Tab 노트 추가 |
| `s` | Long Direction 노트 추가 |
| `d` | Long Both 노트 추가 |

---

## 15. 실행 방법

### 15.1 로컬 개발

```bash
# Node.js (권장, 포트 8080)
start-server.bat

# Python (대안, 포트 8000)
start-python-server.bat
```

### 15.2 주의사항

- `file://` 프로토콜 직접 실행 불가 (ES6 모듈 CORS 오류)
- HTTP 서버를 통해서만 동작

### 15.3 배포

- GitHub Pages에 push하면 자동 배포

---

## 16. 모듈 의존성

```
script.js (메인)
  ├── utils.js       (lerp, timeToBeat, beatToTime, 좌표 변환, ...)
  ├── canvas.js      (drawCircle, drawText, drawDirectionArrow, processLongNote, drawWaveform, drawRuler)
  ├── audio.js       (SoundPool, formatTime)
  ├── notes.js       (validateNote, validateChart, noteToJsonFormat, jsonToNoteFormat, ...)
  └── events.js      (addEvent, removeEvent, eventsToJson, loadEventsFromJson, ...)
       └── event-config.js  (EVENT_TYPES, EVENT_IDS_BY_TYPE, PREDEFINED_PARAMS_BY_EVENT_ID, ...)

index.html
  ├── audio-sync-module.js  (전역 window.AudioSyncModule - 비모듈 script)
  └── script.js             (type="module")
```

---

## 17. 파라미터 타입 목록

이벤트 파라미터에서 사용하는 타입:

| 타입 | 설명 |
|------|------|
| `float` | 소수점 실수 |
| `int` | 정수 |
| `bool` | true/false |
| `string` | 문자열 |
| `textarea` | 긴 텍스트 (dialog text) |
