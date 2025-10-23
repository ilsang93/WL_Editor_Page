// 모듈 임포트
import {
    lerp,
    getNoteTimingParams,
    convertNoteTypeToExternal,
    convertExternalToNoteType,
    calculateLongNoteTime,
    calculatePathBeat,
    timeToBeat,
    beatToTime,
    directionToVector,
    getPreDelaySeconds,
    calculateUnityMovementPerBeat,
    calculateUnityNodeDistance,
    convertEditorToUnityCoordinate,
    convertUnityToEditorCoordinate,
    calculateUnityNotePosition,
    normalizeDirection
} from './utils.js';

import {
    drawCircle,
    drawText,
    drawDirectionArrow,
    drawTriangle,
    processLongNote,
    drawWaveform,
    drawRuler
} from './canvas.js';

import {
    SoundPool,
    formatTime
} from './audio.js';

import {
    validateNote,
    validateChart,
    noteToJsonFormat,
    jsonToNoteFormat,
    sortNotesByTime,
    ensureInitialDirectionNote,
    ensureFinalDirectionNote,
    getNoteColor
} from './notes.js';

import {
    addEvent,
    removeEvent,
    addEventParam,
    removeEventParam,
    getAllEvents,
    clearAllEvents,
    eventsToJson,
    loadEventsFromJson,
    getEventTypes,
    getParamTypes,
    getEventTypeDescription,
    getParamTypeDescription,
    getEventIdsByType,
    isCustomEventType,
    createEvent,
    createEventParam,
    sortEventsByTime,
    getPredefinedParamsForEventId,
    applyPredefinedParams,
    cloneEvent,
    insertMultipleEvents,
    getEventAtIndex,
    updateEvent,
    updateMultipleEvents
} from './events.js';

// 전역 변수들
let zoom = 30;
let viewOffset = {
    x: 0,
    y: 0
};
let isPanning = false;
let lastMousePos = {
    x: 0,
    y: 0
};

let isPlaying = false;
let isPaused = false;
let isCameraTracking = true;
let startTime = 0;
let pauseStartTime = 0; // 일시정지 시작 시간
let elapsedTime = 0;
let animationFrameId = null;

let countdownTimer = null;
let demoAudio = new Audio();
let audioFileURL = null;
let savedAudioFile = null; // 저장된 오디오 파일 정보

let highlightedNoteIndex = null;
let highlightedNoteTimer = 0;
let highlightedEventIndex = null;
let highlightedEventTimer = 0;
let selectedNoteIndex = null; // 현재 선택된 노트의 인덱스 (포커스용)
let selectedNoteIndices = new Set(); // 선택된 노트들의 인덱스 세트 (다중 선택용)
let lastClickedNoteIndex = null; // 마지막으로 클릭된 노트 인덱스 (Shift 선택용)
let selectedEventIndices = new Set(); // 선택된 이벤트들의 인덱스 세트
let lastClickedEventIndex = null; // 마지막으로 클릭된 이벤트 인덱스 (Shift 선택용)

let globalAnimationFrameId = null;
let isDrawLoopRunning = false;
let isBatchEditEnabled = false;

let musicVolume = 0.5; // 0.0 ~ 1.0
let sfxVolume = 1.0; // 0.0 ~ 1.0
let speedMultiplier = 1.0; // 1.0 ~ 3.0 배속

// 렌더링 디바운싱을 위한 변수
let renderScheduled = false;
let pendingRenderFlags = {
    noteList: false,
    eventList: false,
    canvas: false,
    waveform: false
};

// Virtual Scrolling 상태
let virtualScrollState = {
    scrollTop: 0,
    itemHeight: 35, // 각 행의 높이 (픽셀)
    visibleCount: 50, // 화면에 보이는 항목 수
    bufferCount: 10 // 위아래 버퍼 항목 수
};

const demoPlayer = {
    x: 0,
    y: 0
};

const notes = [];

// 성능 최적화를 위한 캐싱 시스템
let pathCache = {
    pathDirectionNotes: null,
    nodePositions: null,
    segmentTimes: null,
    lastNotesHash: null,
    lastBpm: null,
    lastSubdivisions: null,
    lastPreDelaySeconds: null,
    lastSpeedMultiplier: null
};

// 캐시 무효화 함수
function invalidatePathCache() {
    pathCache.pathDirectionNotes = null;
    pathCache.nodePositions = null;
    pathCache.segmentTimes = null;
    pathCache.lastNotesHash = null;
}

// 노트 배열 해시 생성 (변경 감지용)
function generateNotesHash(notes, bpm, subdivisions, preDelaySeconds) {
    const noteString = notes.map(n =>
        `${n.beat}-${n.type}-${n.direction}-${n.bpm || bpm}-${n.subdivisions || subdivisions}`
    ).join('|');
    return `${noteString}-${bpm}-${subdivisions}-${preDelaySeconds}`;
}

// pathDirectionNotes 계산 함수
function calculatePathDirectionNotes(directionNotes, bpm, subdivisions, preDelaySeconds) {
    return directionNotes.map((note, index) => {
        const pathBeat = calculatePathBeat(note, preDelaySeconds, bpm, subdivisions);
        let finalTime;
        if (note.beat === 0 && note.type === "direction") {
            finalTime = 0;
        } else {
            const noteBpm = note.bpm || bpm;
            const noteSubdivisions = note.subdivisions || subdivisions;
            const originalTime = beatToTime(note.beat, noteBpm, noteSubdivisions);
            finalTime = originalTime + preDelaySeconds;
        }
        return {
            ...note,
            finalTime: finalTime,
            pathBeat: pathBeat
        };
    }).sort((a, b) => a.finalTime - b.finalTime);
}

// nodePositions 및 segmentTimes 계산 함수
function calculateNodePositions(pathDirectionNotes, bpm, subdivisions) {
    const nodePositions = [];
    const segmentTimes = [];
    let pos = { x: 0, y: 0 };
    nodePositions.push(pos);

    for (let i = 0; i < pathDirectionNotes.length - 1; i++) {
        const a = pathDirectionNotes[i];
        const b = pathDirectionNotes[i + 1];
        const dTime = b.finalTime - a.finalTime;
        let adjustedDTime = dTime;

        let next;
        if (b.type === "node" && b.wait) {
            next = { x: pos.x, y: pos.y };
        } else {
            const movementSpeed = calculateMovementSpeed(a, b, bpm, subdivisions);
            const dist = movementSpeed * adjustedDTime;

            let direction = a.direction;
            if (a.type === "node") {
                for (let j = i - 1; j >= 0; j--) {
                    const prevNote = pathDirectionNotes[j];
                    if (prevNote.type !== "node" && prevNote.direction) {
                        direction = prevNote.direction;
                        break;
                    }
                }
                direction = direction || "right";
            }

            const [dx, dy] = directionToVector(direction);
            const mag = Math.hypot(dx, dy) || 1;
            next = {
                x: pos.x + (dx / mag) * dist,
                y: pos.y + (dy / mag) * dist
            };
        }

        segmentTimes.push({
            start: a.finalTime,
            end: b.finalTime,
            from: { ...pos },
            to: { ...next }
        });
        pos = next;
        nodePositions.push(pos);
    }

    return { nodePositions, segmentTimes };
}

// 경로 세그먼트 그리기 함수
function drawPathSegments(pathDirectionNotes, nodePositions, segmentTimes, realtimeDrawingEnabled, isPlaying, drawTime) {
    if (nodePositions.length === 0) return;

    ctx.beginPath();
    ctx.moveTo(nodePositions[0].x * zoom + viewOffset.x, nodePositions[0].y * zoom + viewOffset.y);

    for (let i = 0; i < nodePositions.length - 1; i++) {
        const currentPos = nodePositions[i];
        const nextPos = nodePositions[i + 1];
        const segment = segmentTimes[i];

        if (!segment) continue;

        // Node Note의 wait 플래그가 있는 경우 해당 구간의 경로를 그리지 않음
        if (i + 1 < pathDirectionNotes.length && pathDirectionNotes[i + 1].type === "node" && pathDirectionNotes[i + 1].wait) {
            // wait가 설정된 Node Note로 향하는 구간은 경로를 그리지 않음 (정지 상태이므로)
            continue;
        }

        // 실시간 그리기 로직
        if (realtimeDrawingEnabled && isPlaying && segment.end <= drawTime) {
            ctx.lineTo(nextPos.x * zoom + viewOffset.x, nextPos.y * zoom + viewOffset.y);
        } else if (realtimeDrawingEnabled && isPlaying && segment.start <= drawTime && segment.end > drawTime) {
            // 부분적으로 그리기 (선형 보간)
            const segmentProgress = (drawTime - segment.start) / (segment.end - segment.start);
            const partialNext = {
                x: currentPos.x + (nextPos.x - currentPos.x) * segmentProgress,
                y: currentPos.y + (nextPos.y - currentPos.y) * segmentProgress
            };
            ctx.lineTo(partialNext.x * zoom + viewOffset.x, partialNext.y * zoom + viewOffset.y);
        } else if (!realtimeDrawingEnabled || !isPlaying) {
            // 전체 경로 그리기
            ctx.lineTo(nextPos.x * zoom + viewOffset.x, nextPos.y * zoom + viewOffset.y);
        }
    }
}

// 뷰포트 기반 컬링 함수 (줌 레벨에 따라 동적 마진)
function isNoteInViewport(screenX, screenY, zoomLevel = zoom) {
    // 줌 레벨이 낮을수록 마진을 줄여서 더 적극적으로 컬링
    // 줌이 클 때는 여유있게, 작을 때는 엄격하게
    const margin = Math.max(20, Math.min(100, zoomLevel * 3));

    return screenX >= -margin &&
           screenX <= canvas.width + margin &&
           screenY >= -margin &&
           screenY <= canvas.height + margin;
}

// 최적화된 노트 렌더링 함수
function renderNotesOptimized(notes, pathDirectionNotes, nodePositions, bpm, subdivisions, preDelaySeconds, realtimeDrawingEnabled, isPlaying, drawTime) {
    // 줌 레벨이 너무 작으면 노트 렌더링 스킵 (성능 최적화)
    // 줌 레벨이 1.25 이하일 때는 노트가 너무 작아서 겹쳐 보이므로 렌더링 생략 (기존 5에서 1.25로 변경하여 4배 더 줌아웃 가능)
    const MIN_ZOOM_FOR_NOTES = 1.25;
    if (zoom < MIN_ZOOM_FOR_NOTES) {
        // 줌아웃 시 노트 렌더링 스킵 (경로만 표시)
        return;
    }

    // 렌더링할 노트들을 미리 필터링하고 계산된 데이터 캐싱
    const notesToRender = [];

    for (let index = 0; index < notes.length; index++) {
        const note = notes[index];
        if (!note) continue;
        if (note.beat === 0 && !(index === 0 && note.type === "direction")) continue;

        // 노트의 실제 시간 계산
        const noteBpm = note.bpm || bpm;
        const noteSubdivisions = note.subdivisions || subdivisions;
        const noteTime = beatToTime(note.beat, noteBpm, noteSubdivisions) + preDelaySeconds;

        // 실시간 그리기: 그리기 오브젝트가 지나간 노트만 표시
        if (realtimeDrawingEnabled && isPlaying && noteTime > drawTime) {
            continue;
        }

        let finalTime;
        if (note.beat === 0 && note.type === "direction") {
            finalTime = 0;
        } else {
            const originalTime = beatToTime(note.beat, noteBpm, noteSubdivisions);
            finalTime = originalTime + preDelaySeconds;
        }

        const pos = getNotePositionFromPathData(finalTime, pathDirectionNotes, nodePositions);
        if (!pos) continue;

        const screenX = pos.x * zoom + viewOffset.x;
        const screenY = pos.y * zoom + viewOffset.y;

        // 뷰포트 컬링
        if (!isNoteInViewport(screenX, screenY)) continue;

        const pathBeat = timeToBeat(finalTime, bpm, subdivisions);

        notesToRender.push({
            note,
            index,
            screenX,
            screenY,
            pathBeat,
            finalTime
        });
    }

    // 배치된 렌더링으로 성능 최적화
    renderNotesBatched(notesToRender, pathDirectionNotes, nodePositions, bpm, subdivisions);
}

// 배치된 노트 렌더링 함수 (노트 타입별로 그룹화하여 렌더링)
function renderNotesBatched(notesToRender, pathDirectionNotes, nodePositions, bpm, subdivisions) {
    // 노트 타입별로 그룹화
    const notesByType = {
        tab: [],
        direction: [],
        both: [],
        node: [],
        longtab: [],
        longdirection: [],
        longboth: []
    };

    // 노트들을 타입별로 분류
    notesToRender.forEach(noteData => {
        const type = noteData.note.type;
        if (notesByType[type]) {
            notesByType[type].push(noteData);
        }
    });

    // 타입별로 배치 렌더링 (롱노트를 먼저 렌더링하여 1회성 노트가 위에 표시되도록 함)
    renderLongNotes(notesByType.longtab, notesByType.longdirection, notesByType.longboth, pathDirectionNotes, nodePositions, bpm, subdivisions);
    renderTabNotes(notesByType.tab);
    renderDirectionNotes(notesByType.direction);
    renderBothNotes(notesByType.both);
    renderNodeNotes(notesByType.node, bpm);
}

// 탭 노트 배치 렌더링
function renderTabNotes(tabNotes) {
    if (tabNotes.length === 0) return;

    ctx.fillStyle = "#FF6B6B";
    ctx.strokeStyle = "#4CAF50";
    ctx.lineWidth = 2;

    tabNotes.forEach(({ note, screenX, screenY }) => {
        ctx.beginPath();
        ctx.arc(screenX, screenY, 5, 0, 2 * Math.PI);

        if (note.beat === 0 && note.type === "direction") {
            ctx.fillStyle = "red";
        } else {
            ctx.fillStyle = "#FF6B6B";
        }
        ctx.fill();

        if (!(note.beat === 0 && note.type === "direction")) {
            ctx.stroke();
        }
    });
}

// 방향 노트 배치 렌더링
function renderDirectionNotes(directionNotes) {
    if (directionNotes.length === 0) return;

    ctx.lineWidth = 2;

    directionNotes.forEach(({ note, screenX, screenY }) => {
        const [dx, dy] = directionToVector(note.direction);
        const mag = Math.hypot(dx, dy) || 1;
        const ux = (dx / mag) * 16;
        const uy = (dy / mag) * 16;
        const endX = screenX + ux;
        const endY = screenY + uy;

        // 화살표 선 그리기
        ctx.beginPath();
        ctx.moveTo(screenX, screenY);
        ctx.lineTo(endX, endY);

        if (note.beat === 0) {
            ctx.strokeStyle = "#f00";
            ctx.fillStyle = "#f00";
        } else {
            ctx.strokeStyle = "#4CAF50";
            ctx.fillStyle = "#4CAF50";
        }
        ctx.stroke();

        // 화살표 머리 그리기
        const perpX = -uy * 0.5;
        const perpY = ux * 0.5;
        ctx.beginPath();
        ctx.moveTo(endX, endY);
        ctx.lineTo(endX - ux * 0.4 + perpX, endY - uy * 0.4 + perpY);
        ctx.lineTo(endX - ux * 0.4 - perpX, endY - uy * 0.4 - perpY);
        ctx.closePath();
        ctx.fill();
    });
}

// both 노트 배치 렌더링
function renderBothNotes(bothNotes) {
    if (bothNotes.length === 0) return;

    ctx.fillStyle = "#9C27B0";
    ctx.strokeStyle = "#4A148C";
    ctx.lineWidth = 2;

    bothNotes.forEach(({ note, screenX, screenY }) => {
        // 원 그리기
        ctx.beginPath();
        ctx.arc(screenX, screenY, 5, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();

        // 방향 화살표 그리기
        const [dx, dy] = directionToVector(note.direction);
        const mag = Math.hypot(dx, dy) || 1;
        const ux = (dx / mag) * 16;
        const uy = (dy / mag) * 16;
        const endX = screenX + ux;
        const endY = screenY + uy;

        ctx.beginPath();
        ctx.moveTo(screenX, screenY);
        ctx.lineTo(endX, endY);
        ctx.strokeStyle = "#9C27B0";
        ctx.stroke();

        const perpX = -uy * 0.5;
        const perpY = ux * 0.5;
        ctx.beginPath();
        ctx.moveTo(endX, endY);
        ctx.lineTo(endX - ux * 0.4 + perpX, endY - uy * 0.4 + perpY);
        ctx.lineTo(endX - ux * 0.4 - perpX, endY - uy * 0.4 - perpY);
        ctx.closePath();
        ctx.fillStyle = "#9C27B0";
        ctx.fill();
    });
}

// 노드 노트 배치 렌더링
function renderNodeNotes(nodeNotes, bpm) {
    if (nodeNotes.length === 0) return;

    ctx.fillStyle = "#607D8B";
    ctx.strokeStyle = "#263238";
    ctx.lineWidth = 2;

    nodeNotes.forEach(({ note, screenX, screenY }) => {
        const nodeDisplayY = screenY - 30;

        ctx.beginPath();
        ctx.arc(screenX, nodeDisplayY, 6, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();

        // BPM 텍스트 표시
        ctx.fillStyle = "white";
        ctx.font = "bold 8px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const noteBpm = note.bpm || bpm;
        ctx.fillText(noteBpm.toString(), screenX, nodeDisplayY);

        // 연결선 그리기
        ctx.beginPath();
        ctx.moveTo(screenX, nodeDisplayY + 6);
        ctx.lineTo(screenX, screenY - 3);
        ctx.strokeStyle = "rgba(96, 125, 139, 0.5)";
        ctx.lineWidth = 1;
        ctx.stroke();
    });
}

// 롱노트 배치 렌더링
function renderLongNotes(longTabNotes, longDirectionNotes, longBothNotes, pathDirectionNotes, nodePositions, bpm, subdivisions) {
    // 롱노트는 개별적으로 처리해야 함 (각각 다른 길이를 가지므로)
    [...longTabNotes, ...longDirectionNotes, ...longBothNotes].forEach(({ note, screenX, screenY, pathBeat, finalTime }) => {
        if (note.longTime <= 0) return;

        // 노트 타입별 고정 색상 사용
        const color = getNoteColor(note.type);
        const endPos = processLongNote(note, pathBeat, pathDirectionNotes, nodePositions, color, bpm, subdivisions, drawLongNoteBar);

        // 롱노트 시작점 렌더링
        if (note.type === "longtab") {
            renderTabNotes([{ note, screenX, screenY }]);
        } else if (note.type === "longdirection") {
            renderDirectionNotes([{ note, screenX, screenY }]);
        } else if (note.type === "longboth") {
            renderBothNotes([{ note, screenX, screenY }]);
        }

        // 롱노트 끝점 표시
        if (endPos) {
            const endScreenX = endPos.x * zoom + viewOffset.x;
            const endScreenY = endPos.y * zoom + viewOffset.y;
            if (isNoteInViewport(endScreenX, endScreenY)) {
                ctx.beginPath();
                ctx.arc(endScreenX, endScreenY, 4, 0, 2 * Math.PI);
                ctx.fillStyle = color;
                ctx.fill();
                ctx.strokeStyle = "white";
                ctx.lineWidth = 1;
                ctx.stroke();
            }
        }
    });
}

// 히스토리 시스템 (Undo/Redo)
let undoStack = [];
let redoStack = [];
const MAX_HISTORY_SIZE = 50;
let isPerformingUndoRedo = false;

// 기존 구조와의 호환성을 위한 스택 초기화
function initializeUndoRedo() {
    undoStack = [];
    redoStack = [];
    updateUndoRedoButtons();
}

// 현재 상태를 히스토리에 저장
function saveState() {
    if (isPerformingUndoRedo) return; // Undo/Redo 중에는 히스토리 저장 안함

    // 현재 notes 배열의 깊은 복사본을 생성
    const currentNotesState = notes.map(note => ({
        type: note.type,
        beat: note.beat,
        direction: note.direction || "none",
        isLong: note.isLong || false,
        longTime: note.longTime || 0,
        bpm: note.bpm,
        subdivisions: note.subdivisions,
        wait: note.wait || false
    }));

    // 현재 events 배열의 깊은 복사본을 생성
    const currentEventsState = getAllEvents().map(event => ({
        eventType: event.eventType,
        eventId: event.eventId,
        eventTime: event.eventTime,
        eventParams: event.eventParams.map(param => ({
            paramType: param.paramType,
            paramName: param.paramName,
            paramValue: param.paramValue
        }))
    }));

    // 노트와 이벤트를 함께 저장
    const currentState = {
        notes: currentNotesState,
        events: currentEventsState
    };

    undoStack.push(currentState);

    // 스택 크기 제한
    if (undoStack.length > MAX_HISTORY_SIZE) {
        undoStack.shift();
    }

    // 새로운 상태가 저장되면 redo 스택 초기화
    redoStack = [];

    // 버튼 상태 업데이트
    updateUndoRedoButtons();
}

// 실행 취소 (Ctrl+Z)
function undo() {
    if (undoStack.length === 0) return false;

    isPerformingUndoRedo = true;

    // 현재 상태를 redo 스택에 저장
    const currentNotesState = notes.map(note => ({
        type: note.type,
        beat: note.beat,
        direction: note.direction || "none",
        isLong: note.isLong || false,
        longTime: note.longTime || 0,
        bpm: note.bpm,
        subdivisions: note.subdivisions,
        wait: note.wait || false
    }));

    const currentEventsState = getAllEvents().map(event => ({
        eventType: event.eventType,
        eventId: event.eventId,
        eventTime: event.eventTime,
        eventParams: event.eventParams.map(param => ({
            paramType: param.paramType,
            paramName: param.paramName,
            paramValue: param.paramValue
        }))
    }));

    redoStack.push({
        notes: currentNotesState,
        events: currentEventsState
    });

    // 이전 상태 복원
    const previousState = undoStack.pop();

    // 노트 복원
    notes.length = 0;
    notes.push(...previousState.notes);

    // 캐시 무효화
    invalidatePathCache();

    // 이벤트 복원
    clearAllEvents();
    loadEventsFromJson(previousState.events);

    // UI 업데이트
    renderNoteList();
    renderEventList();
    drawPath();
    updateUndoRedoButtons();

    isPerformingUndoRedo = false;
    return true;
}

// 다시 실행 (Ctrl+Y)
function redo() {
    if (redoStack.length === 0) return false;

    isPerformingUndoRedo = true;

    // 현재 상태를 undo 스택에 저장
    const currentNotesState = notes.map(note => ({
        type: note.type,
        beat: note.beat,
        direction: note.direction || "none",
        isLong: note.isLong || false,
        longTime: note.longTime || 0,
        bpm: note.bpm,
        subdivisions: note.subdivisions,
        wait: note.wait || false
    }));

    const currentEventsState = getAllEvents().map(event => ({
        eventType: event.eventType,
        eventId: event.eventId,
        eventTime: event.eventTime,
        eventParams: event.eventParams.map(param => ({
            paramType: param.paramType,
            paramName: param.paramName,
            paramValue: param.paramValue
        }))
    }));

    undoStack.push({
        notes: currentNotesState,
        events: currentEventsState
    });

    // 다음 상태 복원
    const nextState = redoStack.pop();

    // 노트 복원
    notes.length = 0;
    notes.push(...nextState.notes);

    // 캐시 무효화
    invalidatePathCache();

    // 이벤트 복원
    clearAllEvents();
    loadEventsFromJson(nextState.events);

    // UI 업데이트
    renderNoteList();
    renderEventList();
    drawPath();
    updateUndoRedoButtons();

    isPerformingUndoRedo = false;
    return true;
}

// Undo/Redo 버튼 상태 업데이트
function updateUndoRedoButtons() {
    const undoBtn = document.getElementById("undo-btn");
    const redoBtn = document.getElementById("redo-btn");

    if (undoBtn) {
        undoBtn.disabled = undoStack.length === 0;
    }

    if (redoBtn) {
        redoBtn.disabled = redoStack.length === 0;
    }
}

let audioBuffer = null;
let waveformData = null;
let waveformZoom = 1;
let waveformOffset = 0;
let pathHighlightTimer = 0;
let hasAudioFile = false; // 오디오 파일 로드 상태 추가

let tabSoundPool = []; // Tab 사운드 풀
let directionSoundPool = []; // Direction 사운드 풀
let playedNotes = new Set(); // 이미 재생된 노트들을 추적
let executedEvents = new Set(); // 이미 실행된 이벤트들을 추적
const SOUND_POOL_SIZE = 10; // 동시 재생 가능한 사운드 수
const MUSIC_START_TIME = 3.0;

// DOM 요소
const inputAudio = document.getElementById("audio-file");
const btnDemoPlay = document.getElementById("demo-play");
const btnDemoPause = document.getElementById("demo-pause");
const btnDemoStop = document.getElementById("demo-stop");
const spanDemoTime = document.getElementById("demo-time");
const seekbar = document.getElementById("demo-seekbar");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const waveformCanvas = document.getElementById("waveform-canvas");
const waveformCtx = waveformCanvas.getContext("2d");
const waveformContainer = document.getElementById("waveform-container");
const waveformProgress = document.getElementById("waveform-progress");
const rulerCanvas = document.getElementById("ruler-canvas");
const rulerCtx = rulerCanvas.getContext("2d");
const waveformSlider = document.getElementById("waveform-slider");

// Wrapper function for drawWaveform to maintain compatibility
function drawWaveformWrapper() {
    if (!waveformData || !waveformCanvas || !hasAudioFile) return;

    // Use the imported drawWaveform function but call the local complex version
    drawWaveformLocal();
}

// Local complex drawWaveform function
function drawWaveformLocal() {
    if (!waveformData || !waveformCanvas || !hasAudioFile)
        return;

    resizeWaveformCanvas();

    const width = waveformCanvas.width;
    const height = waveformCanvas.height;
    const centerY = height / 2;
    const preDelaySeconds = getPreDelaySeconds();
    const totalDuration = MUSIC_START_TIME + audioBuffer.duration + preDelaySeconds;
    const musicStartRatio = MUSIC_START_TIME / totalDuration;

    waveformCtx.clearRect(0, 0, width, height);

    const musicStartX = width * musicStartRatio;
    waveformCtx.fillStyle = 'rgba(100, 100, 100, 0.8)';
    waveformCtx.fillRect(0, 0, musicStartX, height);

    waveformCtx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    waveformCtx.font = '12px Arial';
    waveformCtx.textAlign = 'center';
    waveformCtx.fillText('게임 시작', musicStartX / 2, height / 2 - 10);
    waveformCtx.fillText('(3초 후 음악 시작)', musicStartX / 2, height / 2 + 5);
    if (preDelaySeconds !== 0) {
        waveformCtx.font = '10px Arial';
        waveformCtx.fillStyle = 'rgba(255, 200, 100, 0.9)';
        waveformCtx.fillText(`Pre-delay: ${preDelaySeconds > 0 ? '+' : ''}${(preDelaySeconds * 1000).toFixed(0)}ms`, musicStartX / 2, height / 2 + 18);
    }

    const musicWidth = width - musicStartX;
    const scaleX = musicWidth / waveformData.length;

    waveformCtx.fillStyle = '#4CAF50';
    for (let i = 0; i < waveformData.length; i++) {
        const dataPoint = waveformData[i];
        const x = musicStartX + i * scaleX;
        const minHeight = Math.abs(dataPoint.min) * centerY;
        const maxHeight = Math.abs(dataPoint.max) * centerY;

        waveformCtx.fillRect(x, centerY - maxHeight, Math.max(1, scaleX), maxHeight + minHeight);
    }

    const duration = totalDuration;
    const rulerHeight = 32;
    rulerCanvas.width = width;
    rulerCanvas.height = rulerHeight;

    rulerCtx.clearRect(0, 0, width, rulerHeight);
    rulerCtx.fillStyle = '#2c2c2c';
    rulerCtx.fillRect(0, 0, width, rulerHeight);

    rulerCtx.strokeStyle = '#555';
    rulerCtx.lineWidth = 1;
    rulerCtx.font = '10px Arial';
    rulerCtx.textAlign = 'left';

    const timeInterval = Math.max(0.1, duration / 50);

    for (let time = 0; time <= duration; time += 0.1) {
        const x = (time / duration) * width;
        const isSecond = Math.abs(time % 1) < 0.05;

        rulerCtx.strokeStyle = time < MUSIC_START_TIME ? '#888' : '#666';
        rulerCtx.beginPath();
        rulerCtx.moveTo(x, 0);
        rulerCtx.lineTo(x, isSecond ? 15 : 8);
        rulerCtx.stroke();

        if (isSecond && time % Math.max(1, Math.floor(timeInterval)) === 0) {
            rulerCtx.fillStyle = time < MUSIC_START_TIME ? '#aaa' : '#ccc';
            if (time < MUSIC_START_TIME) {
                rulerCtx.fillText(`${time.toFixed(0)}s`, x + 1, 28);
            } else {
                const musicTime = time - MUSIC_START_TIME;
                rulerCtx.fillText(`♪${musicTime.toFixed(musicTime < 1 ? 1 : 0)}s`, x + 1, 28);
            }
        }
    }

    const startX = (MUSIC_START_TIME / duration) * width;
    rulerCtx.strokeStyle = '#ff4444';
    rulerCtx.lineWidth = 2;
    rulerCtx.beginPath();
    rulerCtx.moveTo(startX, 0);
    rulerCtx.lineTo(startX, rulerHeight);
    rulerCtx.stroke();

    rulerCtx.fillStyle = '#ff4444';
    rulerCtx.font = 'bold 10px Arial';
    rulerCtx.fillText('음악 시작', startX + 2, 12);
    rulerCtx.font = '8px Arial';
    rulerCtx.fillText('(3초)', startX + 2, 22);
}

// Local generateWaveformData function
function generateWaveformDataLocal(buffer) {
    if (!buffer || !buffer.getChannelData) {
        console.error('Invalid audio buffer');
        return;
    }

    try {
        const channelData = buffer.getChannelData(0);
        const samples = channelData.length;
        const blockSize = Math.max(1, Math.floor(samples / 2000));

        waveformData = [];
        for (let i = 0; i < samples; i += blockSize) {
            let min = 0;
            let max = 0;

            for (let j = 0; j < blockSize && i + j < samples; j++) {
                const sample = channelData[i + j];
                if (sample > max)
                    max = sample;
                if (sample < min)
                    min = sample;
            }

            waveformData.push({
                min,
                max
            });
        }

        console.log(`Generated ${waveformData.length} waveform data points`);
    } catch (error) {
        console.error('Error generating waveform data:', error);
        waveformData = [];
        for (let i = 0; i < 2000; i++) {
            const intensity = Math.random() * 0.5;
            waveformData.push({
                min: -intensity,
                max: intensity
            });
        }
    }
}


// 캔버스 관련 함수들
let lastCanvasWidth = 0;
let lastCanvasHeight = 0;

function resizeCanvas() {
    const currentWidth = canvas.clientWidth;
    const currentHeight = canvas.clientHeight;

    // 크기가 변경되었을 때만 실제로 리사이즈 (성능 최적화)
    if (canvas.width !== currentWidth || canvas.height !== currentHeight) {
        canvas.width = currentWidth;
        canvas.height = currentHeight;
        lastCanvasWidth = currentWidth;
        lastCanvasHeight = currentHeight;
        return true; // 리사이즈 발생
    }
    return false; // 리사이즈 없음
}

function drawGrid() {
    // 줌이 너무 작으면 그리드 생략 (성능 최적화)
    const MIN_ZOOM_FOR_GRID = 0.5;
    if (zoom < MIN_ZOOM_FOR_GRID) return;

    const gridSize = 8;
    const startX = Math.floor(-viewOffset.x / zoom / gridSize) - 1;
    const endX = Math.ceil((canvas.width - viewOffset.x) / zoom / gridSize) + 1;
    const startY = Math.floor(-viewOffset.y / zoom / gridSize) - 1;
    const endY = Math.ceil((canvas.height - viewOffset.y) / zoom / gridSize) + 1;

    ctx.strokeStyle = "rgba(150, 150, 150, 0.2)";
    ctx.lineWidth = 1;

    for (let i = startX; i <= endX; i++) {
        const x = i * gridSize * zoom + viewOffset.x;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
    }

    for (let j = startY; j <= endY; j++) {
        const y = j * gridSize * zoom + viewOffset.y;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
    }
}

function drawPath() {
    const startTime = performance.now();

    resizeCanvas();

    // 캔버스 완전 클리어 (이전 프레임 데이터 제거)
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 컨텍스트 상태 초기화 (변환, 경로 등 리셋)
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.beginPath();
    ctx.restore();

    ensureInitialDirectionNote(notes);

    const preDelaySeconds = getPreDelaySeconds();
    const bpm = parseFloat(document.getElementById("bpm").value || 120);
    const subdivisions = parseInt(document.getElementById("subdivisions").value || 16);

    drawGrid();

    // 실시간 그리기를 위한 변수들
    const realtimeDrawingEnabled = document.getElementById("realtime-drawing").checked;
    const currentTime = isPlaying ? elapsedTime : 0;
    const drawAheadTime = parseFloat(document.getElementById("draw-ahead-time").value || 2.0);
    const drawTime = currentTime + drawAheadTime;

    // 캐시 검증 및 갱신
    const currentNotesHash = generateNotesHash(notes, bpm, subdivisions, preDelaySeconds);
    const needsRecalculation =
        pathCache.lastNotesHash !== currentNotesHash ||
        pathCache.lastBpm !== bpm ||
        pathCache.lastSubdivisions !== subdivisions ||
        pathCache.lastPreDelaySeconds !== preDelaySeconds ||
        pathCache.lastSpeedMultiplier !== speedMultiplier;

    let pathDirectionNotes, nodePositions, segmentTimes;

    if (needsRecalculation) {
        // 캐시 미스 - 새로 계산
        const directionNotes = notes.filter(n =>
            n.type === "direction" ||
            n.type === "both" ||
            n.type === "longdirection" ||
            n.type === "longboth" ||
            n.type === "node"
        ).sort((a, b) => a.beat - b.beat);

        pathDirectionNotes = calculatePathDirectionNotes(directionNotes, bpm, subdivisions, preDelaySeconds);
        const pathData = calculateNodePositions(pathDirectionNotes, bpm, subdivisions);
        nodePositions = pathData.nodePositions;
        segmentTimes = pathData.segmentTimes;

        // 캐시 업데이트
        pathCache.pathDirectionNotes = pathDirectionNotes;
        pathCache.nodePositions = nodePositions;
        pathCache.segmentTimes = segmentTimes;
        pathCache.lastNotesHash = currentNotesHash;
        pathCache.lastBpm = bpm;
        pathCache.lastSubdivisions = subdivisions;
        pathCache.lastPreDelaySeconds = preDelaySeconds;
        pathCache.lastSpeedMultiplier = speedMultiplier;
    } else {
        // 캐시 히트 - 기존 데이터 사용
        pathDirectionNotes = pathCache.pathDirectionNotes;
        nodePositions = pathCache.nodePositions;
        segmentTimes = pathCache.segmentTimes;
    }

    // 경로 그리기
    drawPathSegments(pathDirectionNotes, nodePositions, segmentTimes, realtimeDrawingEnabled, isPlaying, drawTime);

    // 그려진 경로만 표시
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 2;
    ctx.stroke();

    // 그리기 오브젝트 표시 (투명한 원) - 실시간 그리기 활성화 시에만
    if (realtimeDrawingEnabled && isPlaying && drawTime <= (pathDirectionNotes[pathDirectionNotes.length - 1]?.finalTime || 0)) {
        const drawPosition = getPositionAtTime(drawTime, segmentTimes);
        if (drawPosition) {
            ctx.beginPath();
            ctx.arc(drawPosition.x * zoom + viewOffset.x, drawPosition.y * zoom + viewOffset.y, 8, 0, 2 * Math.PI);
            ctx.fillStyle = "rgba(100, 200, 255, 0.6)";
            ctx.fill();
            ctx.strokeStyle = "rgba(100, 200, 255, 0.8)";
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    }

    // 시간 기준 마커 (1초 간격) - 줌 레벨이 충분할 때만 표시
    // 줌 레벨이 2.5 이하일 때는 마커가 너무 많아서 성능 저하 유발 (기존 10에서 2.5로 변경)
    const MIN_ZOOM_FOR_TIME_MARKERS = 2.5;
    if (zoom >= MIN_ZOOM_FOR_TIME_MARKERS) {
        const totalPathTime = pathDirectionNotes[pathDirectionNotes.length - 1]?.finalTime || 0;
        const maxMarkerTime = (realtimeDrawingEnabled && isPlaying) ? Math.min(totalPathTime, drawTime) : totalPathTime;

        for (let time = 1; time < maxMarkerTime; time += 1) {
            const position = getPositionAtTime(time, segmentTimes);
            if (position) {
                const screenX = position.x * zoom + viewOffset.x;
                const screenY = position.y * zoom + viewOffset.y;

                // 뷰포트 컬링 적용
                if (isNoteInViewport(screenX, screenY)) {
                    ctx.beginPath();
                    ctx.arc(screenX, screenY, 4, 0, 2 * Math.PI);
                    ctx.fillStyle = "rgba(128,128,128,0.4)";
                    ctx.fill();
                }
            }
        }
    }

    // BPM 기반 비트 마커 - 줌 레벨이 충분할 때만 표시
    // 줌 레벨이 3.75 이하일 때는 비트 마커가 너무 조밀해서 성능 저하 및 가독성 저하 (기존 15에서 3.75로 변경)
    const MIN_ZOOM_FOR_BEAT_MARKERS = 3.75;
    if (zoom >= MIN_ZOOM_FOR_BEAT_MARKERS) {
        for (let i = 0; i < pathDirectionNotes.length - 1; i++) {
            const a = pathDirectionNotes[i];
            const b = pathDirectionNotes[i + 1];

            // 이 구간에서 사용할 BPM/subdivision
            const segmentBpm = a.bpm || bpm;
            const segmentSubdivisions = a.subdivisions || subdivisions;

            // subdivision 간격으로 비트 마커 표시
            const beatInterval = beatToTime(1, segmentBpm, segmentSubdivisions);
            const maxMarkerTime = (realtimeDrawingEnabled && isPlaying) ? drawTime : (pathDirectionNotes[pathDirectionNotes.length - 1]?.finalTime || 0);

            for (let time = a.finalTime + beatInterval; time < b.finalTime && time <= maxMarkerTime; time += beatInterval) {
                const position = getPositionAtTime(time, segmentTimes);
                if (position) {
                    const screenX = position.x * zoom + viewOffset.x;
                    const screenY = position.y * zoom + viewOffset.y;

                    // 뷰포트 컬링 적용
                    if (isNoteInViewport(screenX, screenY)) {
                        ctx.beginPath();
                        ctx.arc(screenX, screenY, 2, 0, 2 * Math.PI);
                        ctx.fillStyle = "rgba(100,150,255,0.6)";
                        ctx.fill();
                    }
                }
            }
        }
    }

    // 최적화된 노트 렌더링
    renderNotesOptimized(notes, pathDirectionNotes, nodePositions, bpm, subdivisions, preDelaySeconds, realtimeDrawingEnabled, isPlaying, drawTime);



    if (isPlaying && !isNaN(demoPlayer.x) && !isNaN(demoPlayer.y)) {
        const screenX = demoPlayer.x * zoom + viewOffset.x;
        const screenY = demoPlayer.y * zoom + viewOffset.y;

        ctx.save();
        ctx.translate(screenX, screenY);
        ctx.strokeStyle = "blue";
        ctx.fillStyle = "blue";
        ctx.beginPath();
        const spikes = 5;
        const outerRadius = 10;
        const innerRadius = 4;
        for (let i = 0; i < spikes * 2; i++) {
            const radius = i % 2 === 0 ? outerRadius : innerRadius;
            const angle = (i * Math.PI) / spikes;
            const x = Math.cos(angle) * radius;
            const y = Math.sin(angle) * radius;
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    if (highlightedNoteIndex !== null && highlightedNoteTimer > 0) {
        const note = notes[highlightedNoteIndex];
        const noteBpm = note.bpm || parseFloat(document.getElementById("bpm").value || 120);
        const noteSubdivisions = note.subdivisions || parseInt(document.getElementById("subdivisions").value || 16);
        const noteFinalTime = note.beat === 0 && note.type === "direction" ? 0 : beatToTime(note.beat, noteBpm, noteSubdivisions) + preDelaySeconds;

        const pos = getNotePositionFromPathData(noteFinalTime, pathDirectionNotes, nodePositions);
        if (pos) {
            const x = pos.x * zoom + viewOffset.x;
            const y = pos.y * zoom + viewOffset.y;

            const alpha = Math.min(1, highlightedNoteTimer * 2);
            const radius = 15 + (0.5 - highlightedNoteTimer) * 30;

            ctx.beginPath();
            ctx.arc(x, y, radius, 0, 2 * Math.PI);
            ctx.strokeStyle = `rgba(255, 200, 0, ${alpha})`;
            ctx.lineWidth = 3;
            ctx.stroke();
        }
    }

    // 선택된 노트 하이라이트 (노란색 원)
    if (selectedNoteIndex !== null && notes[selectedNoteIndex]) {
        const note = notes[selectedNoteIndex];
        const noteBpm = note.bpm || parseFloat(document.getElementById("bpm").value || 120);
        const noteSubdivisions = note.subdivisions || parseInt(document.getElementById("subdivisions").value || 16);
        const noteFinalTime = note.beat === 0 && note.type === "direction" ? 0 : beatToTime(note.beat, noteBpm, noteSubdivisions) + preDelaySeconds;

        const pos = getNotePositionFromPathData(noteFinalTime, pathDirectionNotes, nodePositions);
        if (pos) {
            const x = pos.x * zoom + viewOffset.x;
            const y = pos.y * zoom + viewOffset.y;

            ctx.beginPath();
            ctx.arc(x, y, 12, 0, 2 * Math.PI); // 좀 더 큰 원
            ctx.strokeStyle = `rgba(255, 255, 0, 0.8)`; // 노란색
            ctx.lineWidth = 4;
            ctx.stroke();

            // 애니메이션 효과를 위한 추가 원 (선택 사항)
            ctx.beginPath();
            ctx.arc(x, y, 15, 0, 2 * Math.PI);
            ctx.strokeStyle = `rgba(255, 255, 0, 0.4)`; // 더 투명한 노란색
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    }

    // EventList 마커 표시
    // 줌 레벨이 너무 작으면 이벤트 렌더링 스킵 (노트와 동일한 기준 적용)
    const MIN_ZOOM_FOR_EVENTS = 1.0; // 노트보다 조금 더 관대하게 설정 (노트: 1.25, 이벤트: 1.0)
    const events = getAllEvents();

    if (zoom >= MIN_ZOOM_FOR_EVENTS) {
        events.forEach((event, eventIndex) => {
            if (!event || typeof event.eventTime !== 'number') return;

            // 이벤트 시간에 해당하는 위치 계산
            const pos = getNotePositionFromPathData(event.eventTime, pathDirectionNotes, nodePositions);
            if (!pos) return;

            const screenX = pos.x * zoom + viewOffset.x;
            const screenY = pos.y * zoom + viewOffset.y;

            // 뷰포트 컬링 - 화면 밖의 이벤트는 그리지 않음
            if (!isNoteInViewport(screenX, screenY)) return;

        // 강조된 이벤트인지 확인
        const isHighlighted = highlightedEventIndex === eventIndex && highlightedEventTimer > 0;

        if (isHighlighted) {
            // 강조 효과를 위한 큰 원 그리기
            const alpha = Math.min(1, highlightedEventTimer * 2);
            const radius = 15 + (2.0 - highlightedEventTimer) * 20;

            ctx.beginPath();
            ctx.arc(screenX, screenY, radius, 0, 2 * Math.PI);
            ctx.strokeStyle = `rgba(255, 152, 0, ${alpha * 0.8})`;
            ctx.lineWidth = 3;
            ctx.stroke();

            // 내부 원
            ctx.beginPath();
            ctx.arc(screenX, screenY, radius * 0.6, 0, 2 * Math.PI);
            ctx.fillStyle = `rgba(255, 152, 0, ${alpha * 0.3})`;
            ctx.fill();
        }

            // 삼각형 마커 그리기 (강조된 경우 더 크게)
            const markerSize = isHighlighted ? 15 : 10;
            const fillColor = isHighlighted ? "#FFB300" : "#FF9800";
            const strokeColor = isHighlighted ? "#FF8F00" : "#FF6F00";
            drawTriangle(ctx, screenX, screenY, markerSize, fillColor, strokeColor, 2);

            // 이벤트 ID를 삼각형 아래에 표시
            if (event.eventId) {
                const textColor = isHighlighted ? "#FFF3E0" : "#FFB74D";
                drawText(ctx, event.eventId, screenX, screenY + (isHighlighted ? 20 : 15), "bold 8px Arial", textColor);
            }
        });
    }

    if (pathHighlightTimer > 0) {
        ctx.save();
        ctx.strokeStyle = `rgba(255, 100, 100, ${pathHighlightTimer})`;
        ctx.lineWidth = 4;
        ctx.shadowColor = 'rgba(255, 100, 100, 0.5)';
        ctx.shadowBlur = 10;

        ctx.beginPath();
        let pos = {
            x: 0,
            y: 0
        };
        ctx.moveTo(pos.x * zoom + viewOffset.x, pos.y * zoom + viewOffset.y);

        for (let i = 0; i < pathDirectionNotes.length - 1; i++) {
            const a = pathDirectionNotes[i];
            const b = pathDirectionNotes[i + 1];
            const dBeat = b.pathBeat - a.pathBeat;
            const dist = (8 * dBeat) / subdivisions;
            const [dx, dy] = directionToVector(a.direction);
            const mag = Math.hypot(dx, dy) || 1;
            const next = {
                x: pos.x + (dx / mag) * dist,
                y: pos.y + (dy / mag) * dist
            };
            ctx.lineTo(next.x * zoom + viewOffset.x, next.y * zoom + viewOffset.y);
            pos = next;
        }
        ctx.stroke();
        ctx.restore();
    }

    // 성능 측정 로그
    const endTime = performance.now();
    const renderTime = endTime - startTime;
    const cacheStatus = needsRecalculation ? 'MISS' : 'HIT';

    // 성능이 좋지 않을 때만 로그 출력 (10ms 이상)
    if (renderTime > 10) {
        console.log(`[Performance] drawPath: ${renderTime.toFixed(2)}ms, Cache: ${cacheStatus}, Notes: ${notes.length}`);
    }
}


function initializeNoteBpmSubdivisions() {
    const currentBpm = parseFloat(document.getElementById("bpm").value || 120);
    const currentSubdivisions = parseInt(document.getElementById("subdivisions").value || 16);

    let hasChanges = false;
    notes.forEach(note => {
        if (note.bpm === undefined) {
            note.bpm = currentBpm;
            hasChanges = true;
        }
        if (note.subdivisions === undefined) {
            note.subdivisions = currentSubdivisions;
            hasChanges = true;
        }
    });

    if (hasChanges) {
        console.log('Initialized missing BPM/subdivision values for existing notes');
        saveToStorage();
    }
}

function getPositionAtTime(time, segmentTimes) {
    for (let s of segmentTimes) {
        if (s.start <= time && time <= s.end) {
            const interp = (time - s.start) / (s.end - s.start);
            return {
                x: s.from.x + (s.to.x - s.from.x) * interp,
                y: s.from.y + (s.to.y - s.from.y) * interp
            };
        }
    }
    return null;
}

function calculateMovementSpeed(fromNote, toNote, globalBpm, globalSubdivisions) {
    // 구간의 평균 BPM을 사용하여 속도 계산
    const fromBpm = fromNote.bpm || globalBpm;
    const toBpm = toNote.bpm || globalBpm;
    const avgBpm = (fromBpm + toBpm) / 2;

    // Unity 공식 적용: multiplierConstant = 0.4 × 배속
    // 속도 = multiplierConstant × BPM
    const multiplierConstant = 0.4 * speedMultiplier;
    return multiplierConstant * avgBpm;
}

function drawLongNoteBar(startPathBeat, endPathBeat, pathDirectionNotes, nodePositions, color, lineWidth, noteSubdivisions) {
    const subdivisions = noteSubdivisions || parseInt(document.getElementById("subdivisions").value || 16);
    const segments = Math.max(10, Math.floor((endPathBeat - startPathBeat) * 2));

    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();

    let firstPoint = true;
    for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const currentBeat = startPathBeat + (endPathBeat - startPathBeat) * t;

        let pos = null;

        // Try to find position within existing path segments
        for (let j = 0; j < pathDirectionNotes.length - 1; j++) {
            const a = pathDirectionNotes[j];
            const b = pathDirectionNotes[j + 1];
            const pa = nodePositions[j];
            const pb = nodePositions[j + 1];

            if (a.pathBeat <= currentBeat && currentBeat <= b.pathBeat) {
                const interp = (currentBeat - a.pathBeat) / (b.pathBeat - a.pathBeat);
                pos = {
                    x: pa.x + (pb.x - pa.x) * interp,
                    y: pa.y + (pb.y - pa.y) * interp
                };
                break;
            }
        }

        // If position not found and currentBeat is beyond the last segment, extend along the last direction
        if (!pos && pathDirectionNotes.length >= 2 && currentBeat > pathDirectionNotes[pathDirectionNotes.length - 1].pathBeat) {
            const lastNote = pathDirectionNotes[pathDirectionNotes.length - 1];
            const lastPos = nodePositions[nodePositions.length - 1];
            const beatDiff = currentBeat - lastNote.pathBeat;
            const dist = (8 * beatDiff) / subdivisions;

            const [dx, dy] = directionToVector(lastNote.direction);
            const mag = Math.hypot(dx, dy) || 1;

            pos = {
                x: lastPos.x + (dx / mag) * dist,
                y: lastPos.y + (dy / mag) * dist
            };
        }

        if (pos) {
            const screenX = pos.x * zoom + viewOffset.x;
            const screenY = pos.y * zoom + viewOffset.y;

            if (firstPoint) {
                ctx.moveTo(screenX, screenY);
                firstPoint = false;
            } else {
                ctx.lineTo(screenX, screenY);
            }
        }
    }
    ctx.stroke();

    const overlayColor = color.replace(/rgb\([^)]+\)/, (match) => {
        const values = match.match(/\d+/g);
        return `rgba(${values[0]}, ${values[1]}, ${values[2]}, 0.3)`;
    }).replace(/#([0-9A-Fa-f]{6})/, (match, hex) => {
        const r = parseInt(hex.substr(0, 2), 16);
        const g = parseInt(hex.substr(2, 2), 16);
        const b = parseInt(hex.substr(4, 2), 16);
        return `rgba(${r}, ${g}, ${b}, 0.3)`;
    });

    ctx.strokeStyle = overlayColor;
    ctx.lineWidth = lineWidth + 4;
    ctx.beginPath();

    firstPoint = true;
    for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const currentBeat = startPathBeat + (endPathBeat - startPathBeat) * t;

        let pos = null;
        for (let j = 0; j < pathDirectionNotes.length - 1; j++) {
            const a = pathDirectionNotes[j];
            const b = pathDirectionNotes[j + 1];
            const pa = nodePositions[j];
            const pb = nodePositions[j + 1];

            if (a.pathBeat <= currentBeat && currentBeat <= b.pathBeat) {
                const interp = (currentBeat - a.pathBeat) / (b.pathBeat - a.pathBeat);
                pos = {
                    x: pa.x + (pb.x - pa.x) * interp,
                    y: pa.y + (pb.y - pa.y) * interp
                };
                break;
            }
        }

        if (pos) {
            const screenX = pos.x * zoom + viewOffset.x;
            const screenY = pos.y * zoom + viewOffset.y;

            if (firstPoint) {
                ctx.moveTo(screenX, screenY);
                firstPoint = false;
            } else {
                ctx.lineTo(screenX, screenY);
            }
        }
    }
    ctx.stroke();
}

// 오디오 관련 함수들
function loadNoteSounds() {
    try {
        tabSoundPool = [];
        for (let i = 0; i < SOUND_POOL_SIZE; i++) {
            const audio = new Audio('sfx/tab.wav');
            audio.volume = sfxVolume;
            audio.preload = 'auto';
            tabSoundPool.push(audio);
        }

        directionSoundPool = [];
        for (let i = 0; i < SOUND_POOL_SIZE; i++) {
            const audio = new Audio('sfx/tab.wav');
            audio.volume = sfxVolume;
            audio.preload = 'auto';
            directionSoundPool.push(audio);
        }

        console.log(`Note sound pools loaded: ${SOUND_POOL_SIZE} instances each (using sfx/tab.mp3)`);
    } catch (error) {
        console.warn('Failed to load note sounds:', error);
        tabSoundPool = [];
        directionSoundPool = [];
    }
}

function getAvailableSound(soundPool) {
    for (let audio of soundPool) {
        if (audio.paused || audio.ended || audio.currentTime === 0) {
            return audio;
        }
    }

    let oldestAudio = soundPool[0];
    let maxCurrentTime = soundPool[0].currentTime;

    for (let audio of soundPool) {
        if (audio.currentTime > maxCurrentTime) {
            maxCurrentTime = audio.currentTime;
            oldestAudio = audio;
        }
    }

    return oldestAudio;
}

function playNoteSound(noteType) {
    try {
        let audio = null;

        if ((noteType === 'tab' || noteType === 'longtab' || noteType === 'both' || noteType === 'longboth') && tabSoundPool.length > 0) {
            audio = getAvailableSound(tabSoundPool);
        } else if ((noteType === 'direction' || noteType === 'longdirection' || noteType === 'both' || noteType === 'longboth') && directionSoundPool.length > 0) {
            audio = getAvailableSound(directionSoundPool);
        }

        if (audio) {
            audio.currentTime = 0;
            audio.play().catch(e => {
                console.warn(`${noteType} sound play failed:`, e);
            });
        }
    } catch (error) {
        console.warn('Error playing note sound:', error);
    }
}

function resizeWaveformCanvas() {
    const wrapper = document.getElementById('waveform-wrapper');
    const rect = wrapper.getBoundingClientRect();

    waveformCanvas.width = Math.max(rect.width * waveformZoom, rect.width);
    waveformCanvas.height = 120;

    rulerCanvas.width = waveformCanvas.width;
    rulerCanvas.height = 40;
}


function processAudioForWaveform(audioFile) {
    console.log('Processing audio file:', audioFile.name);

    hasAudioFile = true;
    savedAudioFile = audioFile;

    saveAudioFile(audioFile).catch(err => {
        console.warn('Failed to save audio to IndexedDB:', err);
    });

    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const reader = new FileReader();

        reader.onload = function (e) {
            audioContext.decodeAudioData(e.target.result)
                .then(buffer => {
                    console.log('AudioContext decoding successful');
                    audioBuffer = buffer;
                    generateWaveformDataLocal(buffer);
                    drawWaveformWrapper();
                    saveToStorage();
                })
                .catch(err => {
                    console.warn('AudioContext decoding failed:', err);
                    tryAudioElementMethod(audioFile);
                });
        };

        reader.onerror = function () {
            console.warn('FileReader failed');
            tryAudioElementMethod(audioFile);
        };

        reader.readAsArrayBuffer(audioFile);
    } catch (error) {
        console.warn('AudioContext not supported:', error);
        tryAudioElementMethod(audioFile);
    }
}

function tryAudioElementMethod(audioFile) {
    console.log('Trying Audio element method');
    const audio = new Audio();
    const url = URL.createObjectURL(audioFile);
    audio.src = url;

    audio.addEventListener('loadedmetadata', () => {
        console.log('Audio metadata loaded, duration:', audio.duration);
        audioBuffer = { duration: audio.duration };
        generateDummyWaveform(audio.duration);
        drawWaveformWrapper();
        saveToStorage();
        URL.revokeObjectURL(url);
    });

    audio.addEventListener('error', () => {
        console.error('Audio element failed');
        hasAudioFile = false;
        savedAudioFile = null;
        audioBuffer = null;
        waveformData = null;
        drawWaveformWrapper();
        URL.revokeObjectURL(url);
    });

    setTimeout(() => {
        if (!audioBuffer || audioBuffer.duration === undefined) {
            console.warn('Audio loading timeout, clearing waveform');
            hasAudioFile = false;
            savedAudioFile = null;
            audioBuffer = null;
            waveformData = null;
            drawWaveformWrapper();
        }
    }, 5000);
}


function generateDummyWaveform(duration) {
    console.log('Generating dummy waveform for duration:', duration);
    waveformData = [];

    for (let i = 0; i < 2000; i++) {
        const time = (i / 2000) * duration;
        const frequency = 0.1 + Math.sin(time * 0.1) * 0.05;
        const baseIntensity = 0.3 + Math.sin(time * frequency) * 0.2;
        const variation = Math.random() * 0.3;
        const intensity = Math.max(0, Math.min(1, baseIntensity + variation));

        waveformData.push({
            min: -intensity * 0.8,
            max: intensity
        });
    }

    console.log(`Generated ${waveformData.length} dummy waveform points`);
}

// 재생 관련 함수들
function startDemo() {
    isPlaying = true;
    isPaused = false;
    elapsedTime = 0;
    startTime = performance.now();

    resetPlayedNotes();
    resetExecutedEvents();

    updateDemo();

    setTimeout(() => {
        if (!isPaused) {
            demoAudio.currentTime = 0;
            demoAudio.play();
        }
    }, MUSIC_START_TIME * 1000);
}

function updateDemo() {
    if (!isPlaying || isPaused)
        return;

    elapsedTime = (performance.now() - startTime) / 1000;
    const bpm = parseFloat(document.getElementById("bpm").value || 120);
    const subdivisions = parseInt(document.getElementById("subdivisions").value || 16);

    // TODO: 변속 기능 - 각 노트의 BPM을 고려한 복합 시간 계산 필요
    // 현재는 전역 BPM으로만 계산하지만, 향후 각 구간별 BPM 변화를 반영해야 함
    const currentBeat = timeToBeat(elapsedTime, bpm, subdivisions);

    checkNoteHits(elapsedTime);
    checkEventExecution(elapsedTime);

    if (!isNaN(demoAudio.duration) && elapsedTime >= demoAudio.duration + MUSIC_START_TIME) {
        stopDemo();
        return;
    }

    if (!isNaN(demoAudio.duration)) {
        const totalTime = demoAudio.duration + getPreDelaySeconds();
        spanDemoTime.textContent = `${formatTime(elapsedTime)} / ${formatTime(totalTime)}`;
        seekbar.max = Math.round(totalTime * 1000);
        seekbar.value = Math.round(elapsedTime * 1000);
    }

    if (elapsedTime >= MUSIC_START_TIME) {
        demoAudio.play();
    }

    updateDemoPlayerPosition(elapsedTime);

    if (isCameraTracking) {
        const targetX = canvas.width / 2 - demoPlayer.x * zoom;
        const targetY = canvas.height / 2 - demoPlayer.y * zoom;
        viewOffset.x = lerp(viewOffset.x, targetX, 0.1);
        viewOffset.y = lerp(viewOffset.y, targetY, 0.1);
    }

    drawPath();
    updateWaveformProgress();

    if (highlightedNoteTimer > 0) {
        highlightedNoteTimer -= 1 / 60;
        if (highlightedNoteTimer <= 0) {
            highlightedNoteTimer = 0;
            highlightedNoteIndex = null;
        }
    }

    animationFrameId = requestAnimationFrame(updateDemo);
}

function checkNoteHits(currentTime) {
    const preDelaySeconds = getPreDelaySeconds();
    const tolerance = 0.05;

    notes.forEach((note, index) => {
        const noteId = `${note.type}-${note.beat}-${index}`;

        if (playedNotes.has(noteId))
            return;

        let finalTime;
        if (note.beat === 0 && note.type === "direction") {
            finalTime = preDelaySeconds;
            if (currentTime >= finalTime - tolerance && currentTime <= finalTime + tolerance) {
                playedNotes.add(noteId);
                highlightNoteHit(index);
                console.log(`0번 노트 통과 (효과음 없음): beat ${note.beat}, finalTime ${finalTime.toFixed(3)}s, currentTime ${currentTime.toFixed(3)}s`);
            }
            return;
        } else {
            // 각 노트의 개별 BPM/subdivision 사용
            const noteBpm = note.bpm || bpm;
            const noteSubdivisions = note.subdivisions || subdivisions;
            const originalTime = beatToTime(note.beat, noteBpm, noteSubdivisions);
            finalTime = originalTime + preDelaySeconds;
        }

        if (currentTime >= finalTime - tolerance &&
            currentTime <= finalTime + tolerance) {

            playNoteSound(note.type);
            playedNotes.add(noteId);
            highlightNoteHit(index);

            console.log(`Note hit: ${note.type} at beat ${note.beat}, finalTime ${finalTime.toFixed(3)}s, currentTime ${currentTime.toFixed(3)}s`);
        }
    });
}

function highlightNoteHit(noteIndex) {
    highlightedNoteIndex = noteIndex;
    highlightedNoteTimer = 0.3;

    if (!isDrawLoopRunning) {
        isDrawLoopRunning = true;
        drawLoop();
    }
}

function resetPlayedNotes() {
    playedNotes.clear();
    console.log('Played notes reset');
}

function resetExecutedEvents() {
    executedEvents.clear();
    console.log('Executed events reset');
}

function checkEventExecution(currentTime) {
    const events = getAllEvents();
    const tolerance = 0.05; // 50ms 허용 오차

    events.forEach((event, index) => {
        if (!event || typeof event.eventTime !== 'number') return;

        const eventId = `${event.eventType}-${event.eventId}-${event.eventTime}-${index}`;

        // 이미 실행된 이벤트는 건너뛰기
        if (executedEvents.has(eventId)) return;

        // 현재 시간이 이벤트 시간에 도달했는지 확인
        if (currentTime >= event.eventTime - tolerance && currentTime <= event.eventTime + tolerance) {
            executeEvent(event, index);
            executedEvents.add(eventId);
        }
    });
}

function executeEvent(event, index) {
    console.log(`Executing event: ${event.eventType}-${event.eventId} at time ${event.eventTime}s`);

    // 이벤트 실행 시각적 피드백
    highlightEventExecution(index);

    // 실제 이벤트 실행 로직은 여기에 추가
    // 예: 오버레이 효과, 카메라 움직임 등
    // TODO: 실제 이벤트 실행 기능 구현
}

function highlightEventExecution(eventIndex) {
    highlightedEventIndex = eventIndex;
    highlightedEventTimer = 0.5; // 이벤트는 노트보다 조금 더 오래 강조

    if (!isDrawLoopRunning) {
        isDrawLoopRunning = true;
        drawLoop();
    }
}

function resetEventExecutionToTime(targetTime) {
    // 지정된 시간 이후의 모든 이벤트 실행 상태를 리셋
    const events = getAllEvents();
    const eventsToReset = [];

    events.forEach((event, index) => {
        if (event && typeof event.eventTime === 'number' && event.eventTime > targetTime) {
            const eventId = `${event.eventType}-${event.eventId}-${event.eventTime}-${index}`;
            eventsToReset.push(eventId);
        }
    });

    eventsToReset.forEach(eventId => {
        executedEvents.delete(eventId);
    });

    console.log(`Reset ${eventsToReset.length} events after time ${targetTime}s`);
}

function updateDemoPlayerPosition(currentTime) {
    const preDelaySeconds = getPreDelaySeconds();

    const directionNotes = notes.filter(n =>
        n.type === "direction" ||
        n.type === "both" ||
        n.type === "longdirection" ||
        n.type === "longboth" ||
        n.type === "node"
    ).sort((a, b) => a.beat - b.beat);

    const bpm = parseFloat(document.getElementById("bpm").value || 120);
    const subdivisions = parseInt(document.getElementById("subdivisions").value || 16);

    const pathDirectionNotes = directionNotes.map((note, index) => {
        const pathBeat = calculatePathBeat(note, preDelaySeconds, bpm, subdivisions);
        let finalTime;
        if (note.beat === 0 && note.type === "direction") {
            // beat 0 direction 노트는 실제 게임 시작점 (0초)
            finalTime = 0;
        } else {
            // 각 노트의 개별 BPM/subdivision 사용하여 finalTime 계산
            const noteBpm = note.bpm || bpm;
            const noteSubdivisions = note.subdivisions || subdivisions;
            const originalTime = beatToTime(note.beat, noteBpm, noteSubdivisions);
            finalTime = originalTime + preDelaySeconds;
        }
        return {
            ...note,
            finalTime: finalTime,
            pathBeat: pathBeat
        };
    }).sort((a, b) => a.finalTime - b.finalTime);

    const nodePositions = [];
    let pos = {
        x: 0,
        y: 0
    };
    nodePositions.push(pos);

    // BPM 기반 동적 속도 계산 사용

    for (let i = 0; i < pathDirectionNotes.length - 1; i++) {
        const a = pathDirectionNotes[i];
        const b = pathDirectionNotes[i + 1];
        const dTime = b.finalTime - a.finalTime;

        // beat 0이 0초이므로 자연스럽게 올바른 시간 구간이 계산됨
        let adjustedDTime = dTime;

        let next;

        // "대기" 체크된 Node 노트는 이전 위치와 같은 위치에 배치
        if (b.type === "node" && b.wait) {
            next = {
                x: pos.x,  // 이전 노트와 같은 위치
                y: pos.y
            };
        } else {
            // 구간별 BPM에 따른 동적 속도 계산
            const movementSpeed = calculateMovementSpeed(a, b, bpm, subdivisions);
            const dist = movementSpeed * adjustedDTime;

            // Node 타입 노트의 경우 이전 direction 노트의 방향을 찾아서 사용
            let direction = a.direction;
            if (a.type === "node") {
                // 이전 direction 노트의 방향을 찾기
                for (let j = i - 1; j >= 0; j--) {
                    const prevNote = pathDirectionNotes[j];
                    if (prevNote.type !== "node" && prevNote.direction) {
                        direction = prevNote.direction;
                        break;
                    }
                }
                direction = direction || "right"; // 기본값
            }

            const [dx, dy] = directionToVector(direction);
            const mag = Math.hypot(dx, dy) || 1;
            next = {
                x: pos.x + (dx / mag) * dist,
                y: pos.y + (dy / mag) * dist
            };
        }
        pos = next;
        nodePositions.push(pos);
    }

    // 시작점에서 시작 (시간이 0보다 작거나 첫 번째 노트 시간보다 작은 경우)  
    if (pathDirectionNotes.length === 0) {
        demoPlayer.x = 0;
        demoPlayer.y = 0;
        return;
    }

    // 첫 번째 게임 노트 시간 전이면 시작점에서 첫 번째 노트까지 이동
    if (pathDirectionNotes.length > 1 && currentTime < pathDirectionNotes[1].finalTime) {
        const firstGameNote = pathDirectionNotes[1]; // 실제 첫 번째 게임 노트 (index 1)
        const startPos = nodePositions[0]; // 시작점 (0, 0)
        const firstNotePos = nodePositions[1]; // 첫 번째 노트 위치

        if (firstNotePos) {
            // 0초부터 첫 번째 게임 노트 시간까지의 진행도 계산
            // 플레이어는 시작과 동시에 이동 시작
            const t = currentTime / firstGameNote.finalTime;
            demoPlayer.x = startPos.x + (firstNotePos.x - startPos.x) * t;
            demoPlayer.y = startPos.y + (firstNotePos.y - startPos.y) * t;
        } else {
            demoPlayer.x = 0;
            demoPlayer.y = 0;
        }
        return;
    }

    // 마지막 노트 시간 후면 마지막 위치에 고정
    if (currentTime >= pathDirectionNotes[pathDirectionNotes.length - 1].finalTime) {
        const lastPos = nodePositions[nodePositions.length - 1];
        demoPlayer.x = lastPos.x;
        demoPlayer.y = lastPos.y;
        return;
    }

    // 해당하는 구간에서 위치 계산
    for (let i = 0; i < pathDirectionNotes.length - 1; i++) {
        const a = pathDirectionNotes[i];
        const b = pathDirectionNotes[i + 1];
        const pa = nodePositions[i];
        const pb = nodePositions[i + 1];

        if (currentTime >= a.finalTime && currentTime <= b.finalTime) {
            let t = (currentTime - a.finalTime) / (b.finalTime - a.finalTime);

            // Node 타입 노트에서 wait 체크박스가 체크된 경우 대기 처리
            if (b.type === "node" && b.wait) {
                // a 노트에 도달한 후 b 노트(Node)의 finalTime까지 a 위치에서 대기
                if (currentTime >= a.finalTime && currentTime < b.finalTime) {
                    // a 노트 위치에서 대기
                    demoPlayer.x = pa.x;
                    demoPlayer.y = pa.y;
                    return;
                }
                // b.finalTime에 도달하면 다음 구간으로 진행 (일반적인 t 계산)
            }

            demoPlayer.x = pa.x + (pb.x - pa.x) * t;
            demoPlayer.y = pa.y + (pb.y - pa.y) * t;
            return;
        }
    }
}

function getNotePositionFromPathData(finalTime, pathDirectionNotes, nodePositions) {
    for (let i = 0; i < pathDirectionNotes.length - 1; i++) {
        const a = pathDirectionNotes[i];
        const b = pathDirectionNotes[i + 1];
        const pa = nodePositions[i];
        const pb = nodePositions[i + 1];

        if (a.finalTime <= finalTime && finalTime <= b.finalTime) {
            const interp = (finalTime - a.finalTime) / (b.finalTime - a.finalTime);
            return {
                x: pa.x + (pb.x - pa.x) * interp,
                y: pa.y + (pb.y - pa.y) * interp
            };
        }
    }
    return null;
}

function stopDemo() {
    isPlaying = false;
    isPaused = false;
    cancelAnimationFrame(animationFrameId);
    demoAudio.pause();
    demoAudio.currentTime = 0;
    elapsedTime = 0;
    resetPlayedNotes();
    resetExecutedEvents();
    spanDemoTime.textContent = "00:00:00 / " + formatTime(demoAudio.duration || 0);
    seekbar.value = 0;
    updateWaveformProgress();
    drawPath();
}

function pauseDemo() {
    if (!isPlaying || isPaused)
        return;
    isPaused = true;
    pauseStartTime = performance.now();
    cancelAnimationFrame(animationFrameId);
    demoAudio.pause();
}

function resumeDemo() {
    if (!isPlaying || !isPaused)
        return;
    isPaused = false;
    const pausedDuration = performance.now() - pauseStartTime;
    startTime += pausedDuration;

    // 일시정지 후 재개할 때는 별도의 상태 리셋이 필요하지 않음
    // 현재 elapsedTime에 맞는 상태가 이미 유지되어 있음
    updateDemo();

    if (elapsedTime >= MUSIC_START_TIME) {
        demoAudio.play();
    } else {
        setTimeout(() => {
            if (!isPaused) {
                demoAudio.play();
            }
        }, (MUSIC_START_TIME - elapsedTime) * 1000);
    }
}

// IndexedDB 및 저장/로드 관련 함수들
const DB_NAME = 'ChartEditorDB';
const DB_VERSION = 1;
const AUDIO_STORE = 'audioFiles';

let db = null;

async function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            db = request.result;
            resolve(db);
        };

        request.onupgradeneeded = (e) => {
            const database = e.target.result;
            if (!database.objectStoreNames.contains(AUDIO_STORE)) {
                database.createObjectStore(AUDIO_STORE);
            }
        };
    });
}

async function saveAudioFile(file) {
    if (!db) await initDB();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction([AUDIO_STORE], 'readwrite');
        const store = transaction.objectStore(AUDIO_STORE);

        const audioData = {
            file: file,
            name: file.name,
            size: file.size,
            type: file.type,
            lastModified: file.lastModified
        };

        const request = store.put(audioData, 'currentAudio');
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

async function loadAudioFileFromDB() {
    if (!db) await initDB();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction([AUDIO_STORE], 'readonly');
        const store = transaction.objectStore(AUDIO_STORE);
        const request = store.get('currentAudio');

        request.onsuccess = () => {
            const result = request.result;
            if (result && result.file) {
                resolve(result.file);
            } else {
                resolve(null);
            }
        };
        request.onerror = () => reject(request.error);
    });
}

function saveToStorage() {
    const preDelayValue = parseInt(document.getElementById("pre-delay").value || 0);
    const bpmValue = parseFloat(document.getElementById("bpm").value || 120);
    const subdivisionsValue = parseInt(document.getElementById("subdivisions").value || 16);
    const speedMultiplierValue = parseFloat(document.getElementById("speed-multiplier").value || 1.0);

    const saveData = {
        notes: notes,
        events: getAllEvents(),
        bpm: bpmValue,
        subdivisions: subdivisionsValue,
        audioFileName: savedAudioFile ? savedAudioFile.name : null,
        audioFileSize: savedAudioFile ? savedAudioFile.size : null,
        audioFileType: savedAudioFile ? savedAudioFile.type : null,
        preDelay: preDelayValue,
        speedMultiplier: speedMultiplierValue
    };
    localStorage.setItem("autosave_notes", JSON.stringify(saveData));
}

function loadFromStorage() {
    const saved = localStorage.getItem("autosave_notes");
    if (saved) {
        try {
            const parsed = JSON.parse(saved);

            if (Array.isArray(parsed)) {
                // 구 형식: 배열만 있는 경우 - 현재 UI 설정값 사용
                const currentBpm = parseFloat(document.getElementById("bpm").value || 120);
                const currentSubdivisions = parseInt(document.getElementById("subdivisions").value || 16);

                notes.splice(0, notes.length, ...parsed);
                notes.forEach(note => {
                    if (note.isLong === undefined) note.isLong = false;
                    if (note.longTime === undefined) note.longTime = 0;
                    // 기존 노트에 BPM/subdivision이 없으면 현재 설정값으로 초기화
                    if (note.bpm === undefined) note.bpm = currentBpm;
                    if (note.subdivisions === undefined) note.subdivisions = currentSubdivisions;
                    // Node 타입 노트의 wait 필드 초기화
                    if (note.type === "node" && note.wait === undefined) note.wait = false;
                });

                // 캐시 무효화
                invalidatePathCache();

                // 구 형식에서는 EventList 데이터가 없으므로 클리어
                clearAllEvents();
            } else if (parsed.notes && Array.isArray(parsed.notes)) {
                // 신 형식: 전역 BPM/subdivision이 포함된 경우
                const globalBpm = parsed.bpm || 120;
                const globalSubdivisions = parsed.subdivisions || 16;

                notes.splice(0, notes.length, ...parsed.notes);
                notes.forEach(note => {
                    if (note.isLong === undefined) note.isLong = false;
                    if (note.longTime === undefined) note.longTime = 0;
                    // 기존 노트에 BPM/subdivision이 없으면 로드된 전역값으로 초기화
                    if (note.bpm === undefined) note.bpm = globalBpm;
                    if (note.subdivisions === undefined) note.subdivisions = globalSubdivisions;
                    // Node 타입 노트의 wait 필드 초기화
                    if (note.type === "node" && note.wait === undefined) note.wait = false;
                });

                // 캐시 무효화
                invalidatePathCache();

                if (parsed.bpm !== undefined) {
                    document.getElementById("bpm").value = parsed.bpm;
                    document.getElementById("bpm").dataset.previousValue = parsed.bpm;
                }
                if (parsed.subdivisions !== undefined) {
                    document.getElementById("subdivisions").value = parsed.subdivisions;
                    document.getElementById("subdivisions").dataset.previousValue = parsed.subdivisions;
                }

                if (parsed.preDelay !== undefined) {
                    const adjustedPreDelay = parsed.preDelay;
                    document.getElementById("pre-delay").value = adjustedPreDelay;
                }

                if (parsed.speedMultiplier !== undefined) {
                    document.getElementById("speed-multiplier").value = parsed.speedMultiplier;
                    speedMultiplier = parsed.speedMultiplier;
                }

                // EventList 데이터 로드
                if (parsed.events && Array.isArray(parsed.events)) {
                    loadEventsFromJson(parsed.events);
                } else {
                    clearAllEvents();
                }

                loadAudioFileFromDB().then(audioFile => {
                    if (audioFile) {
                        console.log('Auto-loading saved audio file:', audioFile.name);

                        const fileInput = document.getElementById("audio-file");
                        const dt = new DataTransfer();
                        dt.items.add(audioFile);
                        fileInput.files = dt.files;

                        if (audioFileURL) URL.revokeObjectURL(audioFileURL);
                        audioFileURL = URL.createObjectURL(audioFile);
                        demoAudio.src = audioFileURL;
                        demoAudio.volume = musicVolume;
                        demoAudio.load();

                        const container = fileInput.parentElement;
                        let indicator = container.querySelector('.file-indicator');
                        if (!indicator) {
                            indicator = document.createElement('div');
                            indicator.className = 'file-indicator';
                            indicator.style.cssText = 'margin-top: 5px; font-size: 12px; color: #4CAF50; font-weight: bold;';
                            container.appendChild(indicator);
                        }
                        indicator.textContent = `자동 복원: ${audioFile.name}`;

                        processAudioForWaveform(audioFile);
                    }
                }).catch(err => {
                    console.warn('Failed to load audio from IndexedDB:', err);
                });
            }
        } catch (e) {
            console.error("불러오기 실패:", e);
        }
    }
}

// validateChart function moved to notes.js module


// UI 관련 함수들

// Tab 노트들의 BPM/Subdivisions 값을 다음 편집 가능 노트에서 상속받도록 업데이트
function updateTabNotesInheritance() {
    const globalBpm = parseFloat(document.getElementById("bpm").value || 120);
    const globalSubdivisions = parseInt(document.getElementById("subdivisions").value || 16);

    notes.forEach((note, index) => {
        // Tab 계열 노트만 처리
        if (note.type === "tab" || note.type === "longtab") {
            // 다음 BPM/Subdivisions 편집 가능 노트 찾기
            let inheritedBpm = globalBpm;
            let inheritedSubdivisions = globalSubdivisions;

            for (let i = index + 1; i < notes.length; i++) {
                const nextNote = notes[i];
                const canEdit = ["direction", "longdirection", "both", "longboth", "node"].includes(nextNote.type);
                if (canEdit) {
                    inheritedBpm = nextNote.bpm || globalBpm;
                    inheritedSubdivisions = nextNote.subdivisions || globalSubdivisions;
                    break;
                }
            }

            // Tab 노트에 상속받은 값 설정
            note.bpm = inheritedBpm;
            note.subdivisions = inheritedSubdivisions;
        }
    });
}

// 최적화된 렌더링 스케줄러 (디바운싱)
function scheduleRender(flags = {}) {
    // 플래그 업데이트
    if (flags.noteList) pendingRenderFlags.noteList = true;
    if (flags.eventList) pendingRenderFlags.eventList = true;
    if (flags.canvas) pendingRenderFlags.canvas = true;
    if (flags.waveform) pendingRenderFlags.waveform = true;

    if (renderScheduled) return;

    renderScheduled = true;
    requestAnimationFrame(() => {
        // 한 프레임에 모든 렌더링 작업을 묶어서 처리
        if (pendingRenderFlags.canvas) {
            drawPath();
        }
        if (pendingRenderFlags.noteList) {
            renderNoteListImmediate();
        }
        if (pendingRenderFlags.eventList) {
            renderEventListImmediate();
        }
        if (pendingRenderFlags.waveform && waveformData) {
            drawWaveformWrapper();
        }

        // 플래그 초기화
        pendingRenderFlags = {
            noteList: false,
            eventList: false,
            canvas: false,
            waveform: false
        };
        renderScheduled = false;
    });
}

// 중복 검사 최적화 함수 (O(n²) → O(n))
function findDuplicateNoteIndices(notes, bpm, subdivisions) {
    const duplicateIndices = new Set();
    const noteMap = new Map(); // key: "beat-bpm-subdivisions", value: [indices]

    notes.forEach((note, index) => {
        const noteBpm = note.bpm || bpm;
        const noteSubdivisions = note.subdivisions || subdivisions;
        const key = `${note.beat}-${noteBpm}-${noteSubdivisions}`;

        if (!noteMap.has(key)) {
            noteMap.set(key, []);
        }
        noteMap.get(key).push(index);
    });

    // 2개 이상인 경우만 중복으로 처리
    for (const indices of noteMap.values()) {
        if (indices.length > 1) {
            indices.forEach(idx => duplicateIndices.add(idx));
        }
    }

    return duplicateIndices;
}

// renderNoteList 래퍼 함수 (디바운싱 적용)
function renderNoteList() {
    scheduleRender({ noteList: true });
}

// 실제 렌더링 함수 (즉시 실행)
function renderNoteListImmediate() {
    // Tab 노트들의 상속 값을 먼저 업데이트
    updateTabNotesInheritance();

    const tbody = document.getElementById("note-list");
    tbody.innerHTML = "";

    const bpm = parseFloat(document.getElementById("bpm").value || 120);
    const subdivisions = parseInt(document.getElementById("subdivisions").value || 16);
    const preDelaySeconds = getPreDelaySeconds();

    // 중복 검사 최적화 적용
    const duplicateNoteIndices = findDuplicateNoteIndices(notes, bpm, subdivisions);

    // Virtual Scrolling: 렌더링할 범위 계산
    const totalNotes = notes.length;
    const startIndex = Math.max(0, Math.floor(virtualScrollState.scrollTop / virtualScrollState.itemHeight) - virtualScrollState.bufferCount);
    const endIndex = Math.min(totalNotes, startIndex + virtualScrollState.visibleCount + virtualScrollState.bufferCount * 2);

    // 상단 스페이서 (스크롤 위치 유지용)
    if (startIndex > 0) {
        const offsetY = startIndex * virtualScrollState.itemHeight;
        const spacerTop = document.createElement("tr");
        spacerTop.style.height = `${offsetY}px`;
        spacerTop.style.pointerEvents = "none";
        tbody.appendChild(spacerTop);
    }

    // Virtual Scrolling: 보이는 범위만 렌더링
    for (let index = startIndex; index < endIndex; index++) {
        const note = notes[index];
        if (!note) continue;
        const tr = document.createElement("tr");
        let className = "tab-note";
        if (note.type === "direction" || note.type === "longdirection") {
            className = "dir-note";
        } else if (note.type === "both" || note.type === "longboth") {
            className = "both-note";
        } else if (note.type === "longtab") {
            className = "long-tab-note";
        } else if (note.type === "node") {
            className = "node-note";
        }
        tr.className = className;
        if (index === selectedNoteIndex) {
            tr.classList.add("highlight");
        }

        // 다중 선택된 노트 표시
        if (selectedNoteIndices.has(index)) {
            tr.classList.add("selected");
        }

        // 중복 beat 값인 경우 빨간색으로 표시 (같은 BPM, subdivision인 경우에만)
        if (duplicateNoteIndices.has(index)) {
            tr.classList.add("duplicate-beat");
        }

        const tdIndex = document.createElement("td");
        tdIndex.textContent = index;

        const tdType = document.createElement("td");
        const typeSelect = document.createElement("select");
        typeSelect.style.fontSize = "11px";
        typeSelect.style.width = "70px";

        const typeOptions = [
            { value: "tab", label: "Tab" },
            { value: "longtab", label: "LTab" },
            { value: "direction", label: "Direction" },
            { value: "longdirection", label: "LDir" },
            { value: "both", label: "Both" },
            { value: "longboth", label: "LBoth" },
            { value: "node", label: "Node" }
        ];

        typeOptions.forEach(option => {
            const opt = document.createElement("option");
            opt.value = option.value;
            opt.textContent = option.label;
            if (note.type === option.value) {
                opt.selected = true;
            }
            typeSelect.appendChild(opt);
        });

        typeSelect.addEventListener("change", () => {
            // 변경 전 상태를 히스토리에 저장
            saveState();

            const oldType = note.type;
            const newType = typeSelect.value;

            const updateNoteType = (n) => {
                // 타입 변경
                n.type = newType;

                // isLong 속성 업데이트
                n.isLong = ["longtab", "longdirection", "longboth"].includes(newType);

                // longTime 초기화 (롱노트로 변경시)
                if (n.isLong && !n.longTime) {
                    const subdivisions = parseInt(document.getElementById("subdivisions").value || 16);
                    n.longTime = subdivisions;
                }

                // direction 속성 처리
                if (["direction", "longdirection", "both", "longboth"].includes(newType)) {
                    if (!n.direction) {
                        n.direction = "none";
                    }
                } else {
                    // 방향이 필요없는 타입으로 변경시 direction 제거
                    delete n.direction;
                }

                // Node 타입 전환 시 wait 속성 처리
                if (newType === "node" && !n.hasOwnProperty("wait")) {
                    n.wait = false;
                }
            };

            // 다중 선택된 노트들의 타입 일괄 변경
            if (selectedNoteIndices.has(index) && selectedNoteIndices.size > 1) {
                selectedNoteIndices.forEach(idx => {
                    if (idx < notes.length) {
                        updateNoteType(notes[idx]);
                    }
                });
            } else {
                updateNoteType(note);
            }

            saveToStorage();
            drawPath();
            renderNoteList();
            if (waveformData) drawWaveformWrapper();
        });

        tdType.appendChild(typeSelect);

        const tdBeat = document.createElement("td");
        const inputBeat = document.createElement("input");
        inputBeat.type = "number";
        inputBeat.step = "1";
        inputBeat.value = note.beat;
        inputBeat.addEventListener("change", () => {
            // 변경 전 상태를 히스토리에 저장
            saveState();

            const oldBeat = note.beat;
            const newBeat = parseInt(inputBeat.value);
            const diff = newBeat - oldBeat;

            if (isBatchEditEnabled) {
                notes.forEach((n, i) => {
                    if (i > index) {
                        n.beat += diff;
                    }
                });
            } else if (selectedNoteIndices.has(index) && selectedNoteIndices.size > 1) {
                // 다중 선택된 노트들의 beat 일괄 조정
                selectedNoteIndices.forEach(idx => {
                    if (idx < notes.length) {
                        notes[idx].beat += diff;
                    }
                });
            } else {
                note.beat = newBeat;
            }

            saveToStorage();
            drawPath();
            renderNoteList();
            if (waveformData)
                drawWaveformWrapper();
        });
        tdBeat.appendChild(inputBeat);

        const tdTime = document.createElement("td");
        // 각 노트의 BPM/subdivision 사용
        const noteBpm = note.bpm || bpm;
        const noteSubdivisions = note.subdivisions || subdivisions;
        const originalTime = beatToTime(note.beat, noteBpm, noteSubdivisions);

        if (note.beat === 0 && note.type === "direction") {
            tdTime.textContent = `${originalTime.toFixed(3)}s`;
            tdTime.style.color = '#666';
            tdTime.title = '게임 시작점';
        } else {
            const finalTime = originalTime + preDelaySeconds;
            tdTime.innerHTML = `\n        <div style="color: #4CAF50; font-weight: bold;">${finalTime.toFixed(3)}s</div>\n        <div style="font-size: 11px; color: #999;">원본: ${originalTime.toFixed(3)}s</div>\n    `;
            tdTime.title = `원본: ${originalTime.toFixed(3)}s → 최종: ${finalTime.toFixed(3)}s (pre-delay: ${preDelaySeconds > 0 ? '+' : ''}${preDelaySeconds.toFixed(3)}s)`;
        }

        const tdLong = document.createElement("td");
        if (note.isLong) {
            const inputLongTime = document.createElement("input");
            inputLongTime.type = "number";
            inputLongTime.step = "1";
            inputLongTime.min = "1";
            inputLongTime.value = note.longTime || subdivisions;
            inputLongTime.title = "비트 단위 길이";
            inputLongTime.addEventListener("change", () => {
                // 변경 전 상태를 히스토리에 저장
                saveState();

                note.longTime = parseInt(inputLongTime.value) || subdivisions;
                saveToStorage();
                drawPath();
                if (waveformData)
                    drawWaveformWrapper();
            });
            tdLong.appendChild(inputLongTime);
        } else {
            tdLong.textContent = "-";
        }

        const tdDir = document.createElement("td");
        if (note.type === "direction" || note.type === "longdirection" || note.type === "both" || note.type === "longboth") {
            const select = document.createElement("select");
            ["none", "up", "down", "left", "right", "upleft", "upright", "downleft", "downright"].forEach(d => {
                const opt = document.createElement("option");
                opt.value = d;
                opt.textContent = d;
                if (note.direction === d)
                    opt.selected = true;
                select.appendChild(opt);
            });
            select.addEventListener("change", () => {
                // 변경 전 상태를 히스토리에 저장
                saveState();

                const newDirection = select.value;

                // 다중 선택된 노트 중 방향 지정이 가능한 노트만 변경
                if (selectedNoteIndices.has(index) && selectedNoteIndices.size > 1) {
                    selectedNoteIndices.forEach(idx => {
                        if (idx < notes.length) {
                            const n = notes[idx];
                            // 방향을 가질 수 있는 타입인지 확인
                            if (["direction", "longdirection", "both", "longboth"].includes(n.type)) {
                                n.direction = newDirection;
                            }
                        }
                    });
                } else {
                    note.direction = newDirection;
                }

                saveToStorage();
                drawPath();
                if (waveformData)
                    drawWaveformWrapper();
            });
            tdDir.appendChild(select);
        } else {
            tdDir.textContent = "-";
        }

        // BPM 컬럼 추가 (Direction, Both, Node 계열 노트에서만 editable)
        const tdBpm = document.createElement("td");
        const canEditBpm = ["direction", "longdirection", "both", "longboth", "node"].includes(note.type);

        if (canEditBpm) {
            const inputBpm = document.createElement("input");
            inputBpm.type = "number";
            inputBpm.min = "60";
            inputBpm.max = "300";
            inputBpm.step = "0.1";
            inputBpm.value = note.bpm || bpm;
            inputBpm.style.width = "60px";
            inputBpm.style.fontSize = "11px";
            inputBpm.addEventListener("change", () => {
                const newBpm = parseFloat(inputBpm.value) || bpm;
                if (newBpm >= 60 && newBpm <= 300) {
                    // 변경 전 상태를 히스토리에 저장
                    saveState();

                    // 다중 선택된 노트 중 BPM 변경이 가능한 노트만 변경
                    if (selectedNoteIndices.has(index) && selectedNoteIndices.size > 1) {
                        selectedNoteIndices.forEach(idx => {
                            if (idx < notes.length) {
                                const n = notes[idx];
                                // BPM을 가질 수 있는 타입인지 확인
                                if (["direction", "longdirection", "both", "longboth", "node"].includes(n.type)) {
                                    n.bpm = newBpm;
                                }
                            }
                        });
                    } else {
                        note.bpm = newBpm;
                    }

                    updateTabNotesInheritance(); // Tab 노트들의 상속 값 업데이트
                    saveToStorage();
                    drawPath();
                    renderNoteList();
                    if (waveformData) drawWaveformWrapper();
                } else {
                    inputBpm.value = note.bpm || bpm; // 복원
                }
            });
            tdBpm.appendChild(inputBpm);
        } else {
            // Tab 계열 노트는 이미 상속받은 BPM 값을 표시
            tdBpm.textContent = note.bpm || bpm;
            tdBpm.style.color = "#999";
            tdBpm.style.fontStyle = "italic";
            tdBpm.title = "Tab 노트는 다음 BPM 편집 가능 노트의 값을 추종합니다";
        }

        // Subdivisions 컬럼 추가 (Direction, Both, Node 계열 노트에서만 editable)
        const tdSubdivisions = document.createElement("td");
        const canEditSubdivisions = ["direction", "longdirection", "both", "longboth", "node"].includes(note.type);

        if (canEditSubdivisions) {
            const selectSubdivisions = document.createElement("select");
            [2, 4, 8, 12, 16, 24, 32, 48].forEach(subValue => {
                const opt = document.createElement("option");
                opt.value = subValue;
                opt.textContent = `${subValue}분박`;
                if ((note.subdivisions || subdivisions) === subValue) {
                    opt.selected = true;
                }
                selectSubdivisions.appendChild(opt);
            });
            selectSubdivisions.style.fontSize = "11px";
            selectSubdivisions.style.width = "65px";
            selectSubdivisions.addEventListener("change", () => {
                // 변경 전 상태를 히스토리에 저장
                saveState();

                const newSubdivisions = parseInt(selectSubdivisions.value);

                // 다중 선택된 노트 중 Subdivisions 변경이 가능한 노트만 변경
                if (selectedNoteIndices.has(index) && selectedNoteIndices.size > 1) {
                    selectedNoteIndices.forEach(idx => {
                        if (idx < notes.length) {
                            const n = notes[idx];
                            // Subdivisions를 가질 수 있는 타입인지 확인
                            if (["direction", "longdirection", "both", "longboth", "node"].includes(n.type)) {
                                n.subdivisions = newSubdivisions;
                            }
                        }
                    });
                } else {
                    note.subdivisions = newSubdivisions;
                }

                updateTabNotesInheritance(); // Tab 노트들의 상속 값 업데이트
                saveToStorage();
                drawPath();
                renderNoteList();
                if (waveformData) drawWaveformWrapper();
            });
            tdSubdivisions.appendChild(selectSubdivisions);
        } else {
            // Tab 계열 노트는 이미 상속받은 Subdivisions 값을 표시
            tdSubdivisions.textContent = `${note.subdivisions || subdivisions}분박`;
            tdSubdivisions.style.color = "#999";
            tdSubdivisions.style.fontStyle = "italic";
            tdSubdivisions.title = "Tab 노트는 다음 Subdivisions 편집 가능 노트의 값을 추종합니다";
        }

        // Wait 컬럼 추가 (Node 타입만)
        const tdWait = document.createElement("td");
        if (note.type === "node") {
            const waitCheckbox = document.createElement("input");
            waitCheckbox.type = "checkbox";
            waitCheckbox.checked = note.wait || false;
            waitCheckbox.addEventListener("change", () => {
                // 변경 전 상태를 히스토리에 저장
                saveState();

                note.wait = waitCheckbox.checked;
                saveToStorage();
                drawPath();
            });
            tdWait.appendChild(waitCheckbox);
        } else {
            tdWait.textContent = "-";
        }

        const tdDelete = document.createElement("td");
        const btn = document.createElement("button");
        btn.textContent = "삭제";
        btn.disabled = (note.beat === 0 && note.type === "direction" && index === 0);
        btn.addEventListener("click", () => {
            // 변경 전 상태를 히스토리에 저장
            saveState();

            notes.splice(index, 1);

            // 캐시 무효화
            invalidatePathCache();

            saveToStorage();
            drawPath();
            renderNoteList();
            if (waveformData)
                drawWaveformWrapper();
        });
        tdDelete.appendChild(btn);

        tr.append(tdIndex, tdType, tdBeat, tdTime, tdLong, tdDir, tdBpm, tdSubdivisions, tdWait, tdDelete);
        tr.addEventListener("click", (e) => {
            if (["INPUT", "SELECT", "BUTTON"].includes(e.target.tagName))
                return;

            if (e.shiftKey && lastClickedNoteIndex !== null) {
                // Shift 클릭: 범위 선택
                const start = Math.min(lastClickedNoteIndex, index);
                const end = Math.max(lastClickedNoteIndex, index);
                for (let i = start; i <= end; i++) {
                    selectedNoteIndices.add(i);
                }
                lastClickedNoteIndex = index;
                renderNoteList();
            } else if (e.ctrlKey || e.metaKey) {
                // Ctrl/Cmd 클릭: 다중 선택
                if (selectedNoteIndices.has(index)) {
                    selectedNoteIndices.delete(index);
                } else {
                    selectedNoteIndices.add(index);
                }
                lastClickedNoteIndex = index;
                renderNoteList();
            } else {
                // 일반 클릭: 포커스
                lastClickedNoteIndex = index;
                focusNoteAtIndex(index);
            }
        });
        tbody.appendChild(tr);
    }

    // 하단 스페이서 (스크롤 위치 유지용)
    if (endIndex < totalNotes) {
        const remainingHeight = (totalNotes - endIndex) * virtualScrollState.itemHeight;
        const spacerBottom = document.createElement("tr");
        spacerBottom.style.height = `${remainingHeight}px`;
        spacerBottom.style.pointerEvents = "none";
        tbody.appendChild(spacerBottom);
    }
}

function focusNoteAtIndex(index) {
    if (index < 0 || index >= notes.length) {
        selectedNoteIndex = null;
        drawPath();
        renderNoteList();
        updateSelectedNoteUnityCoordinates();
        return;
    }

    selectedNoteIndex = index;
    console.log('focusNoteAtIndex - selectedNoteIndex set to:', selectedNoteIndex);
    const note = notes[index];

    const bpm = parseFloat(document.getElementById("bpm").value || 120);
    const subdivisions = parseInt(document.getElementById("subdivisions").value || 16);
    const preDelaySeconds = getPreDelaySeconds();

    const pathBeat = calculatePathBeat(note, preDelaySeconds, bpm, subdivisions);

    const directionNotes = notes.filter(n =>
        n.type === "direction" ||
        n.type === "both" ||
        n.type === "longdirection" ||
        n.type === "longboth" ||
        n.type === "node"
    ).sort((a, b) => a.beat - b.beat);

    const pathDirectionNotes = directionNotes.map((n, i) => {
        const pBeat = calculatePathBeat(n, preDelaySeconds, bpm, subdivisions);
        let finalTime;
        if (n.beat === 0 && n.type === "direction") {
            finalTime = 0;
        } else {
            const noteBpm = n.bpm || bpm;
            const noteSubdivisions = n.subdivisions || subdivisions;
            const originalTime = beatToTime(n.beat, noteBpm, noteSubdivisions);
            finalTime = originalTime + preDelaySeconds;
        }
        return { ...n, pathBeat: pBeat, finalTime: finalTime };
    }).sort((a, b) => a.finalTime - b.finalTime);

    const nodePositions = [];
    let pos = { x: 0, y: 0 };
    nodePositions.push(pos);

    // Use time-based movement calculation like updateDemoPlayerPosition
    const MOVEMENT_SPEED = 8;

    for (let i = 0; i < pathDirectionNotes.length - 1; i++) {
        const a = pathDirectionNotes[i];
        const b = pathDirectionNotes[i + 1];
        const dTime = b.finalTime - a.finalTime;

        // beat 0이 0초이므로 자연스럽게 올바른 시간 구간이 계산됨
        let adjustedDTime = dTime;

        let next;

        // Handle waiting Node notes
        if (b.type === "node" && b.wait) {
            next = { x: pos.x, y: pos.y };
        } else {
            // 구간별 BPM에 따른 동적 속도 계산
            const movementSpeed = calculateMovementSpeed(a, b, bpm, subdivisions);
            const dist = movementSpeed * adjustedDTime;

            // For Node type notes, find the previous direction note's direction
            let direction = a.direction;
            if (a.type === "node") {
                for (let j = i - 1; j >= 0; j--) {
                    const prevNote = pathDirectionNotes[j];
                    if (prevNote.type !== "node" && prevNote.direction) {
                        direction = prevNote.direction;
                        break;
                    }
                }
            }

            const [dx, dy] = directionToVector(direction);
            const mag = Math.hypot(dx, dy) || 1;
            next = {
                x: pos.x + (dx / mag) * dist,
                y: pos.y + (dy / mag) * dist
            };
        }
        pos = next;
        nodePositions.push(pos);
    }

    const noteBpm = note.bpm || bpm;
    const noteSubdivisions = note.subdivisions || subdivisions;
    const noteFinalTime = note.beat === 0 && note.type === "direction" ? preDelaySeconds : beatToTime(note.beat, noteBpm, noteSubdivisions) + preDelaySeconds;
    const noteCanvasPos = getNotePositionFromPathData(noteFinalTime, pathDirectionNotes, nodePositions);

    if (noteCanvasPos) {
        viewOffset.x = canvas.width / 2 - noteCanvasPos.x * zoom;
        viewOffset.y = canvas.height / 2 - noteCanvasPos.y * zoom;
    }

    // 노트 리스트 하이라이트 업데이트
    const tbody = document.getElementById("note-list");
    Array.from(tbody.children).forEach((row, i) => {
        if (i === index) {
            row.classList.add("highlight");
            row.scrollIntoView({ behavior: "smooth", block: "nearest" });
        } else {
            row.classList.remove("highlight");
        }
    });

    drawPath();

    // Unity 좌표 정보 업데이트
    updateSelectedNoteUnityCoordinates();
}

function focusEventAtIndex(index) {
    const events = getAllEvents();
    if (index < 0 || index >= events.length) {
        return;
    }

    const event = events[index];
    if (!event || typeof event.eventTime !== 'number') {
        return;
    }

    // 이벤트 시간에 해당하는 위치 계산
    const bpm = parseFloat(document.getElementById("bpm").value || 120);
    const subdivisions = parseInt(document.getElementById("subdivisions").value || 16);
    const preDelaySeconds = getPreDelaySeconds();

    const directionNotes = notes.filter(n =>
        n.type === "direction" ||
        n.type === "both" ||
        n.type === "longdirection" ||
        n.type === "longboth" ||
        n.type === "node"
    ).sort((a, b) => a.beat - b.beat);

    const pathDirectionNotes = calculatePathDirectionNotes(directionNotes, bpm, subdivisions, preDelaySeconds);
    const pathData = calculateNodePositions(pathDirectionNotes, bpm, subdivisions);
    const nodePositions = pathData.nodePositions;

    // 이벤트 위치 계산
    const pos = getNotePositionFromPathData(event.eventTime, pathDirectionNotes, nodePositions);
    if (!pos) return;

    // 화면 중앙으로 이동
    viewOffset.x = canvas.width / 2 - pos.x * zoom;
    viewOffset.y = canvas.height / 2 - pos.y * zoom;

    // 이벤트 강조 타이머 설정
    highlightedEventIndex = index;
    highlightedEventTimer = 2.0; // 2초간 강조

    drawPath();

    // 그리기 루프 시작 (강조 효과를 위해)
    if (!isDrawLoopRunning) {
        isDrawLoopRunning = true;
        drawLoop();
    }
}

function updateWaveformSlider() {
    const maxScroll = Math.max(0, waveformZoom - 1);
    if (maxScroll === 0) {
        waveformSlider.disabled = true;
        waveformSlider.value = 0;
    } else {
        waveformSlider.disabled = false;
        const value = Math.round((waveformOffset / maxScroll) * 100);
        waveformSlider.value = Math.max(0, Math.min(100, value));
    }
}

function updateWaveformPosition() {
    const wrapper = document.getElementById('waveform-wrapper');
    if (!wrapper)
        return;

    const wrapperWidth = wrapper.offsetWidth;
    const canvasWidth = waveformCanvas.width;

    const maxOffset = Math.max(0, canvasWidth - wrapperWidth);
    const scrollLeft = (waveformOffset / Math.max(waveformZoom - 1, 1)) * maxOffset;

    const leftPos = -scrollLeft + 'px';

    if (waveformCanvas.style.left !== leftPos) {
        waveformCanvas.style.left = leftPos;
        rulerCanvas.style.left = leftPos;
    }
}

function updateWaveformProgress() {
    if (!audioBuffer || !isPlaying)
        return;

    const preDelaySeconds = getPreDelaySeconds();
    const duration = MUSIC_START_TIME + audioBuffer.duration;
    const progressPercent = Math.min(elapsedTime / duration, 1);
    const canvasWidth = waveformCanvas.width;
    const wrapper = document.getElementById('waveform-wrapper');
    const scrollLeft = parseFloat(waveformCanvas.style.left || '0');

    const progressX = (progressPercent * canvasWidth) + scrollLeft;
    waveformProgress.style.left = Math.max(0, progressX) + 'px';
}

function setupWaveformFloating() {
    const container = document.getElementById('waveform-container');
    const triggerZone = document.querySelector('.waveform-trigger-zone');

    if (!container || !triggerZone) {
        console.error('Container or trigger zone not found');
        return;
    }

    console.log('Setting up waveform floating...');

    triggerZone.addEventListener('mouseenter', () => {
        console.log('Mouse entered trigger zone');
        container.classList.add('visible');
    });

    container.addEventListener('mouseenter', () => {
        console.log('Mouse entered container');
        container.classList.add('visible');
    });

    container.addEventListener('mouseleave', (e) => {
        console.log('Mouse left container');
        setTimeout(() => {
            if (!container.matches(':hover')) {
                container.classList.remove('visible');
            }
        }, 100);
    });

    document.addEventListener('mousemove', (e) => {
        const windowHeight = window.innerHeight;
        const triggerHeight = 30;

        if (e.clientY >= windowHeight - triggerHeight && e.clientX >= 400) {
            if (!container.classList.contains('visible')) {
                console.log('Mouse in bottom area, showing container');
                container.classList.add('visible');
            }
        }
    });

    console.log('Waveform floating setup complete');
}

function setupWaveformControls() {
    const zoomInBtn = document.getElementById('waveform-zoom-in');
    const zoomOutBtn = document.getElementById('waveform-zoom-out');
    const resetBtn = document.getElementById('waveform-reset');
    const zoomLevel = document.getElementById('waveform-zoom-level');

    zoomInBtn.addEventListener('click', () => {
        waveformZoom = Math.min(waveformZoom * 2, 16);
        updateZoomLevel();
        drawWaveformWrapper();
        updateWaveformSlider();
    });

    zoomOutBtn.addEventListener('click', () => {
        waveformZoom = Math.max(waveformZoom / 2, 0.25);
        updateZoomLevel();
        drawWaveformWrapper();
        updateWaveformSlider();
    });

    resetBtn.addEventListener('click', () => {
        waveformZoom = 1;
        waveformOffset = 0;
        updateZoomLevel();
        drawWaveformWrapper();
        updateWaveformSlider();
    });

    function updateZoomLevel() {
        zoomLevel.textContent = Math.round(waveformZoom * 100) + '%';
    }
}

function setupWaveformClick() {
    waveformCanvas.addEventListener('click', (e) => {
        if (!audioBuffer || !waveformData || !hasAudioFile) {
            alert('먼저 오디오 파일을 선택해주세요.');
            return;
        }

        const rect = waveformCanvas.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const wrapper = document.getElementById('waveform-wrapper');
        const scrollLeft = Math.abs(parseFloat(waveformCanvas.style.left || '0'));
        const actualClickX = clickX + scrollLeft;
        const canvasWidth = waveformCanvas.width;

        const preDelaySeconds = getPreDelaySeconds();
        const totalDuration = audioBuffer.duration + preDelaySeconds;
        const clickTime = (actualClickX / canvasWidth) * totalDuration;

        if (clickTime < preDelaySeconds) {
            alert(`음악 시작 전 구간입니다. ${preDelaySeconds}초 이후 구간을 클릭해주세요.`);
            return;
        }

        const bpm = parseFloat(document.getElementById("bpm").value || 120);
        const subdivisions = parseInt(document.getElementById("subdivisions").value || 16);
        const clickBeat = timeToBeat(clickTime, bpm, subdivisions);

        const pos = getNotePosition(clickBeat);
        if (!pos) {
            alert('해당 시간에 경로가 만들어지지 않았습니다. 더 많은 direction 노트를 추가해주세요.');
            return;
        }

        viewOffset.x = canvas.width / 2 - pos.x * zoom;
        viewOffset.y = canvas.height / 2 - pos.y * zoom;

        pathHighlightTimer = 1.0;

        drawPath();

        if (!isDrawLoopRunning) {
            isDrawLoopRunning = true;
            drawLoop();
        }
    });
}

function setupWaveformWheel() {
    waveformCanvas.addEventListener('wheel', (e) => {
        e.preventDefault();

        const rect = waveformCanvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const canvasWidth = waveformCanvas.width;

        const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
        const newZoom = Math.max(0.25, Math.min(16, waveformZoom * zoomFactor));

        if (newZoom !== waveformZoom) {
            const mouseRatio = mouseX / canvasWidth;
            waveformOffset = mouseRatio * (newZoom - waveformZoom);

            waveformZoom = newZoom;
            document.getElementById('waveform-zoom-level').textContent = Math.round(waveformZoom * 100) + '%';

            drawWaveformWrapper();
            updateWaveformSlider();
        }
    }, {
        passive: false
    });
}

function setupWaveformSlider() {
    waveformSlider.addEventListener('input', (e) => {
        const value = parseInt(e.target.value);
        const maxScroll = Math.max(0, waveformZoom - 1);
        waveformOffset = (value / 100) * maxScroll;

        updateWaveformPosition();
    });
}

function setupToggleFeatures() {
    const sidebar = document.getElementById('sidebar');
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const controlBar = document.getElementById('control-bar');
    const controlBarToggle = document.getElementById('control-bar-toggle');
    const main = document.getElementById('main');
    const waveformContainer = document.getElementById('waveform-container');
    const waveformTriggerZone = document.querySelector('.waveform-trigger-zone');

    sidebarToggle.addEventListener('click', () => {
        const isHidden = sidebar.classList.contains('hidden');

        if (isHidden) {
            sidebar.classList.remove('hidden');
            sidebarToggle.classList.remove('hidden');
            main.classList.remove('sidebar-hidden');
            waveformContainer.classList.remove('sidebar-hidden');
            waveformTriggerZone.classList.remove('sidebar-hidden');
            sidebarToggle.textContent = '◀';
        } else {
            sidebar.classList.add('hidden');
            sidebarToggle.classList.add('hidden');
            main.classList.add('sidebar-hidden');
            waveformContainer.classList.add('sidebar-hidden');
            waveformTriggerZone.classList.add('sidebar-hidden');
            sidebarToggle.textContent = '▶';
        }

        setTimeout(() => {
            resizeCanvas();
            if (waveformData) {
                resizeWaveformCanvas();
                drawWaveformWrapper();
            }
            drawPath();
        }, 300);
    });

    controlBarToggle.addEventListener('click', () => {
        const isHidden = controlBar.classList.contains('hidden');

        if (isHidden) {
            controlBar.classList.remove('hidden');
            controlBarToggle.classList.remove('hidden');
            controlBarToggle.textContent = '×';
        } else {
            controlBar.classList.add('hidden');
            controlBarToggle.classList.add('hidden');
            controlBarToggle.textContent = '⚙';
        }
    });
}

function setupNoteButtons() {
    // Tab 노트 추가
    document.getElementById('add-tab').addEventListener('click', () => {
        addNote({ type: "tab", isLong: false, longTime: 0 });
    });

    // Direction 노트 추가
    document.getElementById('add-dir').addEventListener('click', () => {
        addNote({ type: "direction", isLong: false, longTime: 0 });
    });

    // Both 노트 추가
    document.getElementById('add-both').addEventListener('click', () => {
        addNote({ type: "both", isLong: false, longTime: 0 });
    });

    // Node 노트 추가 (BPM 지정만 가능)
    document.getElementById('add-node').addEventListener('click', () => {
        addNote({ type: "node", isLong: false, longTime: 0 });
    });

    // Long Tab 노트 추가
    document.getElementById('add-long-tab').addEventListener('click', () => {
        addNote({ type: "longtab", isLong: true });
    });

    // Long Direction 노트 추가
    document.getElementById('add-long-dir').addEventListener('click', () => {
        addNote({ type: "longdirection", isLong: true });
    });

    // Long Both 노트 추가  
    document.getElementById('add-long-both').addEventListener('click', () => {
        addNote({ type: "longboth", isLong: true });
    });
}

function setupVolumeControls() {
    const musicVolumeSlider = document.getElementById("music-volume");
    const sfxVolumeSlider = document.getElementById("sfx-volume");
    const musicVolumeDisplay = document.getElementById("music-volume-display");
    const sfxVolumeDisplay = document.getElementById("sfx-volume-display");

    musicVolumeSlider.addEventListener("input", (e) => {
        musicVolume = parseInt(e.target.value) / 100;
        demoAudio.volume = musicVolume;
        musicVolumeDisplay.textContent = e.target.value + "%";
        localStorage.setItem("musicVolume", musicVolume);
    });

    sfxVolumeSlider.addEventListener("input", (e) => {
        sfxVolume = parseInt(e.target.value) / 100;
        sfxVolumeDisplay.textContent = e.target.value + "%";

        [...tabSoundPool, ...directionSoundPool].forEach(audio => {
            audio.volume = sfxVolume;
        });

        localStorage.setItem("sfxVolume", sfxVolume);
    });

    const savedMusicVolume = localStorage.getItem("musicVolume");
    const savedSfxVolume = localStorage.getItem("sfxVolume");

    if (savedMusicVolume !== null) {
        musicVolume = parseFloat(savedMusicVolume);
        musicVolumeSlider.value = Math.round(musicVolume * 100);
        musicVolumeDisplay.textContent = Math.round(musicVolume * 100) + "%";
        demoAudio.volume = musicVolume;
    }

    if (savedSfxVolume !== null) {
        sfxVolume = parseFloat(savedSfxVolume);
        sfxVolumeSlider.value = Math.round(sfxVolume * 100);
        sfxVolumeDisplay.textContent = Math.round(sfxVolume * 100) + "%";
    }
}

function setupSubdivisionsOptions() {
    const subdivisionsSelect = document.getElementById("subdivisions");
    if (!subdivisionsSelect) {
        console.warn("subdivisions select element not found");
        return;
    }

    subdivisionsSelect.innerHTML = '';

    const subdivisionsOptions = [{
        value: 2,
        label: "2"
    }, {
        value: 4,
        label: "4"
    }, {
        value: 8,
        label: "8"
    }, {
        value: 12,
        label: "12"
    }, {
        value: 16,
        label: "16"
    }, {
        value: 24,
        label: "24"
    }, {
        value: 32,
        label: "32"
    }, {
        value: 48,
        label: "48"
    }
    ];

    subdivisionsOptions.forEach(option => {
        const optionElement = document.createElement("option");
        optionElement.value = option.value;
        optionElement.textContent = option.label;
        subdivisionsSelect.appendChild(optionElement);
    });

    subdivisionsSelect.value = "16";
    subdivisionsSelect.dataset.previousValue = "16";
}

function showSuccessMessage(message) {
    const successDiv = document.createElement('div');
    successDiv.innerHTML = message;
    successDiv.style.cssText = `\n        position: fixed; top: 10px; left: 50%; transform: translateX(-50%);\n        z-index: 9999; padding: 12px 24px;\n        background: linear-gradient(135deg, #4CAF50, #45a049);\n        color: white; border-radius: 6px; font-size: 14px; font-weight: bold;\n        box-shadow: 0 4px 12px rgba(76, 175, 80, 0.4);\n        opacity: 0; transition: opacity 0.3s ease;\n    `;

    document.body.appendChild(successDiv);

    setTimeout(() => successDiv.style.opacity = '1', 10);
    setTimeout(() => {
        successDiv.style.opacity = '0';
        setTimeout(() => successDiv.remove(), 300);
    }, 3000);
}

function createAudioSystemButton() {
    const button = document.createElement('button');
    button.id = 'init-improved-audio';
    button.innerHTML = '🎵 개선된 오디오 시스템 시작';
    button.style.cssText = `\n        position: fixed; top: 10px; left: 50%; transform: translateX(-50%);\n        z-index: 9999; padding: 15px 30px;\n        background: linear-gradient(135deg, #4CAF50, #45a049);\n        color: white; border: none; border-radius: 8px;\n        font-size: 16px; font-weight: bold; cursor: pointer;\n        box-shadow: 0 4px 16px rgba(76, 175, 80, 0.4);\n        transition: all 0.3s ease;\n    `;

    button.addEventListener('click', async () => {
        try {
            button.disabled = true;
            button.innerHTML = '🔄 초기화 중...';

            if (typeof AudioSyncModule === 'undefined') {
                throw new Error('AudioSyncModule이 로드되지 않았습니다. audio-sync-module.js 파일을 확인해주세요.');
            }

            const success = await AudioSyncModule.init();

            if (success) {
                showSuccessMessage('✅ 개선된 오디오 시스템이 활성화되었습니다!');
                button.remove();

                console.log('🎉 개선된 오디오 시스템 활성화 완료');

                setTimeout(() => AudioSyncModule.logStatus(), 1000);

            } else {
                throw new Error('오디오 시스템 초기화 실패');
            }

        } catch (error) {
            console.error('❌ 오디오 시스템 초기화 오류:', error);
            alert(`오디오 시스템 초기화에 실패했습니다.\n\n오류: ${error.message}\n\n브라우저를 새로고침한 후 다시 시도해주세요.`);

            button.disabled = false;
            button.innerHTML = '🎵 개선된 오디오 시스템 시작';
        }
    });

    return button;
}

function getNotePosition(beat) {
    const bpm = parseFloat(document.getElementById("bpm").value || 120);
    const subdivisions = parseInt(document.getElementById("subdivisions").value || 16);
    const preDelaySeconds = getPreDelaySeconds();

    let pathBeat = beat;

    const directionNotes = notes.filter(n =>
        n.type === "direction" ||
        n.type === "both" ||
        n.type === "longdirection" ||
        n.type === "longboth"
    ).sort((a, b) => a.beat - b.beat);
    const pathDirectionNotes = directionNotes.map((note, index) => {
        let noteBeat;
        if (note.beat === 0 && note.type === "direction") {
            noteBeat = 0;
        } else {
            // 각 노트의 개별 BPM/subdivision 사용
            const noteBpm = note.bpm || bpm;
            const noteSubdivisions = note.subdivisions || subdivisions;
            const originalTime = beatToTime(note.beat, noteBpm, noteSubdivisions);
            const adjustedTime = originalTime + preDelaySeconds;
            // pathBeat 계산은 전역 BPM/subdivision으로 통일 (경로 생성을 위해)
            noteBeat = timeToBeat(adjustedTime, bpm, subdivisions);
        }
        return {
            ...note,
            pathBeat: noteBeat
        };
    }).sort((a, b) => a.pathBeat - b.pathBeat);

    let pos = {
        x: 0,
        y: 0
    };
    const nodePositions = [pos];

    for (let i = 0; i < pathDirectionNotes.length - 1; i++) {
        const a = pathDirectionNotes[i];
        const b = pathDirectionNotes[i + 1];
        const dBeat = b.pathBeat - a.pathBeat;
        const dist = (8 * dBeat) / subdivisions;
        const [dx, dy] = directionToVector(a.direction);
        const mag = Math.hypot(dx, dy) || 1;
        const next = {
            x: pos.x + (dx / mag) * dist,
            y: pos.y + (dy / mag) * dist
        };
        if (a.pathBeat <= pathBeat && pathBeat <= b.pathBeat) {
            const interp = (pathBeat - a.pathBeat) / (b.pathBeat - a.pathBeat);
            return {
                x: pos.x + (next.x - pos.x) * interp,
                y: pos.y + (next.y - pos.y) * interp
            };
        }
        pos = next;
        nodePositions.push(pos);
    }
    return null;
}


function drawLoop() {
    let needsRedraw = false;

    if (highlightedNoteTimer > 0) {
        highlightedNoteTimer -= 1 / 60;
        if (highlightedNoteTimer <= 0) {
            highlightedNoteIndex = null;
            highlightedNoteTimer = 0;
        }
        needsRedraw = true;
    }

    if (highlightedEventTimer > 0) {
        highlightedEventTimer -= 1 / 60;
        if (highlightedEventTimer <= 0) {
            highlightedEventIndex = null;
            highlightedEventTimer = 0;
        }
        needsRedraw = true;
    }

    if (pathHighlightTimer > 0) {
        pathHighlightTimer -= 1 / 60;
        if (pathHighlightTimer <= 0) {
            pathHighlightTimer = 0;
        }
        needsRedraw = true;
    }

    // 단일 drawPath 호출로 모든 하이라이트 효과를 처리 (GPU 성능 최적화)
    if (needsRedraw) {
        drawPath();
    }

    if (highlightedNoteTimer > 0 || highlightedEventTimer > 0 || pathHighlightTimer > 0) {
        globalAnimationFrameId = requestAnimationFrame(drawLoop);
    } else {
        isDrawLoopRunning = false;
    }
}

// 노트 추가 로직
function addNote(noteProps) {
    const subdivisions = parseInt(document.getElementById("subdivisions").value || 16);
    let newBeat;
    let insertionIndex;

    console.log('addNote called - selectedNoteIndex:', selectedNoteIndex, 'notes.length:', notes.length);

    if (selectedNoteIndex !== null && selectedNoteIndex < notes.length) {
        const selectedNote = notes[selectedNoteIndex];

        // 선택된 노트와 직전 노트의 간격을 계산
        let interval;
        if (selectedNoteIndex > 0) {
            const previousNote = notes[selectedNoteIndex - 1];
            interval = selectedNote.beat - previousNote.beat;
            console.log(`Interval calculation: ${selectedNote.beat} - ${previousNote.beat} = ${interval}`);
        } else {
            // 첫 번째 노트라면 기본 간격 사용
            interval = subdivisions;
            console.log(`First note - using default interval: ${interval}`);
        }

        // 간격이 0 이하라면 기본 간격 사용
        if (interval <= 0) {
            interval = subdivisions;
            console.log(`Invalid interval - using default: ${interval}`);
        }

        // 선택된 노트 + 간격으로 새 노트 beat 설정
        newBeat = selectedNote.beat + interval;
        console.log(`New note beat: ${selectedNote.beat} + ${interval} = ${newBeat}`);

        // 선택된 노트 바로 다음 위치에 삽입
        insertionIndex = selectedNoteIndex + 1;
    } else {
        // 현재 BPM/Subdivisions 가져오기 (maxBeat 계산에 필요)
        const bpm = parseFloat(document.getElementById("bpm").value || 120);
        const subdivisions = parseInt(document.getElementById("subdivisions").value || 16);

        insertionIndex = notes.length;
        const maxBeat = Math.max(0, ...notes.map(n => {
            let endBeat = n.beat;
            if (n.isLong && n.longTime > 0) {
                // 롱노트 길이를 해당 노트의 BPM/subdivision으로 시간 변환 후 전역 기준으로 재변환
                const noteBpm = n.bpm || bpm;
                const noteSubdivisions = n.subdivisions || subdivisions;
                const longTimeInSeconds = beatToTime(n.longTime, noteBpm, noteSubdivisions);
                const longTimeInGlobalBeats = timeToBeat(longTimeInSeconds, bpm, subdivisions);
                endBeat = n.beat + longTimeInGlobalBeats;
            }
            return endBeat;
        }));
        newBeat = maxBeat + subdivisions;
    }

    // 현재 BPM/Subdivisions 가져오기
    const currentBpm = parseFloat(document.getElementById("bpm").value || 120);
    const currentSubdivisions = parseInt(document.getElementById("subdivisions").value || 16);

    const newNote = {
        ...noteProps,
        beat: newBeat,
        bpm: currentBpm,          // 노트별 BPM 저장
        subdivisions: currentSubdivisions  // 노트별 subdivision 저장
    };

    if (newNote.type === "direction" || newNote.type === "longdirection" || newNote.type === "both" || newNote.type === "longboth") {
        const precedingDirectionNotes = notes
            .slice(0, insertionIndex)
            .filter(n => n.type === "direction" || n.type === "longdirection" || n.type === "both" || n.type === "longboth")
            .sort((a, b) => a.beat - b.beat);

        const lastDirNote = precedingDirectionNotes.length > 0 ? precedingDirectionNotes[precedingDirectionNotes.length - 1] : null;
        newNote.direction = lastDirNote ? lastDirNote.direction : "none";
    }

    if (newNote.isLong) {
        newNote.longTime = newNote.longTime || subdivisions;
    }

    // 변경 전 상태를 히스토리에 저장
    saveState();

    notes.splice(insertionIndex, 0, newNote);

    // 캐시 무효화
    invalidatePathCache();

    saveToStorage();
    drawPath();
    renderNoteList();
    if (waveformData) drawWaveformWrapper();

    focusNoteAtIndex(insertionIndex);
}

// BPM/Subdivisions 변경 시 시간 기반으로 노트 업데이트
function updateNotesForTimeBasedChange(oldBpm, oldSubdivisions, newBpm, newSubdivisions) {
    console.log(`Updating notes from BPM ${oldBpm}/${oldSubdivisions} to ${newBpm}/${newSubdivisions}`);

    notes.forEach(note => {
        const timeInSeconds = beatToTime(note.beat, oldBpm, oldSubdivisions);
        note.beat = timeToBeat(timeInSeconds, newBpm, newSubdivisions);

        if (note.isLong && note.longTime > 0) {
            const longTimeInSeconds = beatToTime(note.longTime, oldBpm, oldSubdivisions);
            note.longTime = timeToBeat(longTimeInSeconds, newBpm, newSubdivisions);
            console.log(`Long note length: ${longTimeInSeconds.toFixed(3)}s -> ${note.longTime} beats`);
        }

        console.log(`Note: ${timeInSeconds.toFixed(3)}s -> beat ${note.beat}`);
    });

    ensureInitialDirectionNote(notes);
}

// BPM 필드 변경 핸들러
function handleBpmChange(newBpm) {
    const oldBpm = parseFloat(document.getElementById("bpm").dataset.previousValue || 120);
    const subdivisions = parseInt(document.getElementById("subdivisions").value || 16);
    const isBatchEdit = document.getElementById("batch-edit-toggle").checked;

    console.log(`BPM changed from ${oldBpm} to ${newBpm}, batch edit: ${isBatchEdit}`);

    // 체크박스가 체크되어 있을 때만 기존 노트들 업데이트
    if (isBatchEdit && oldBpm !== newBpm && notes.length > 0) {
        // 모든 노트의 BPM을 새로운 값으로 업데이트
        notes.forEach(note => {
            note.bpm = newBpm;
        });
        updateNotesForTimeBasedChange(oldBpm, subdivisions, newBpm, subdivisions);
    }

    document.getElementById("bpm").dataset.previousValue = newBpm;

    saveToStorage();
    drawPath();
    renderNoteList();
    if (waveformData)
        drawWaveformWrapper();
    updateCoordinateInfo();
}

// Subdivisions 필드 변경 핸들러
function handleSubdivisionsChange(newSubdivisions) {
    const bpm = parseFloat(document.getElementById("bpm").value || 120);
    const oldSubdivisions = parseInt(document.getElementById("subdivisions").dataset.previousValue || 16);
    const isBatchEdit = document.getElementById("batch-edit-toggle").checked;

    console.log(`Subdivisions changed from ${oldSubdivisions} to ${newSubdivisions}, batch edit: ${isBatchEdit}`);

    // 체크박스가 체크되어 있을 때만 기존 노트들 업데이트
    if (isBatchEdit && oldSubdivisions !== newSubdivisions && notes.length > 0) {
        // 모든 노트의 subdivisions을 새로운 값으로 업데이트
        notes.forEach(note => {
            note.subdivisions = newSubdivisions;
        });
        updateNotesForTimeBasedChange(bpm, oldSubdivisions, bpm, newSubdivisions);
    }

    document.getElementById("subdivisions").dataset.previousValue = newSubdivisions;

    saveToStorage();
    drawPath();
    renderNoteList();
    if (waveformData)
        drawWaveformWrapper();
}

// Pre-delay 변경 핸들러
function handlePreDelayChange() {
    console.log(`Pre-delay changed to ${getPreDelaySeconds()}s`);

    saveToStorage();
    renderNoteList();
    if (waveformData)
        drawWaveformWrapper();
}

// 배속 변경 핸들러
function handleSpeedMultiplierChange(newSpeedMultiplier) {
    console.log(`Speed multiplier changed to ${newSpeedMultiplier}x`);

    speedMultiplier = Math.max(1.0, Math.min(3.0, newSpeedMultiplier));

    // 캐시 무효화 및 UI 업데이트
    invalidatePathCache();
    saveToStorage();
    renderNoteList();
    drawPath();
    updateCoordinateInfo();
}

// 좌표 정보 업데이트
function updateCoordinateInfo() {
    const bpm = parseFloat(document.getElementById("bpm").value || 120);

    // Unity 공식으로 정확한 계산
    const unityUnitsPerBeat = calculateUnityMovementPerBeat(bpm, speedMultiplier);
    const editorUnitsPerBeat = 24.0 * speedMultiplier; // 에디터의 현재 공식
    const conversionRatio = unityUnitsPerBeat / editorUnitsPerBeat;

    // UI 업데이트
    const editorUnitsSpan = document.getElementById("editor-units-per-beat");
    const gameUnitsSpan = document.getElementById("game-units-per-beat");
    const ratioSpan = document.getElementById("conversion-ratio");

    if (editorUnitsSpan) editorUnitsSpan.textContent = editorUnitsPerBeat.toFixed(1);
    if (gameUnitsSpan) gameUnitsSpan.textContent = unityUnitsPerBeat.toFixed(2);
    if (ratioSpan) ratioSpan.textContent = conversionRatio.toFixed(3);

    // 선택된 노트의 Unity 좌표 업데이트
    updateSelectedNoteUnityCoordinates();
}

// 선택된 노트의 Unity 좌표 계산 및 표시
function updateSelectedNoteUnityCoordinates() {
    const unityXSpan = document.getElementById("selected-note-unity-x");
    const unityYSpan = document.getElementById("selected-note-unity-y");
    const totalDistanceSpan = document.getElementById("selected-note-total-distance");

    if (!unityXSpan || !unityYSpan || !totalDistanceSpan) return;

    if (selectedNoteIndex === null || selectedNoteIndex >= notes.length) {
        unityXSpan.textContent = "-";
        unityYSpan.textContent = "-";
        totalDistanceSpan.textContent = "-";
        return;
    }

    const selectedNote = notes[selectedNoteIndex];
    const bpm = parseFloat(document.getElementById("bpm").value || 120);
    const subdivisions = parseInt(document.getElementById("subdivisions").value || 16);
    const preDelaySeconds = getPreDelaySeconds();

    try {
        // Unity 노드 위치들 계산
        const unityNodePositions = calculateUnityNodePositions(bpm, subdivisions, preDelaySeconds);

        if (unityNodePositions && unityNodePositions.length > 0) {
            // 선택된 노트의 Unity 위치 계산
            const noteUnityPosition = calculateNoteUnityPosition(selectedNote, unityNodePositions, bpm, subdivisions, preDelaySeconds);

            if (noteUnityPosition) {
                unityXSpan.textContent = noteUnityPosition.x.toFixed(2);
                unityYSpan.textContent = noteUnityPosition.y.toFixed(2);

                // 총 이동 거리 계산
                const totalDistance = Math.hypot(noteUnityPosition.x, noteUnityPosition.y);
                totalDistanceSpan.textContent = totalDistance.toFixed(2);
            } else {
                unityXSpan.textContent = "계산 불가";
                unityYSpan.textContent = "계산 불가";
                totalDistanceSpan.textContent = "-";
            }
        } else {
            unityXSpan.textContent = "-";
            unityYSpan.textContent = "-";
            totalDistanceSpan.textContent = "-";
        }
    } catch (error) {
        console.error("Unity 좌표 계산 오류:", error);
        unityXSpan.textContent = "오류";
        unityYSpan.textContent = "오류";
        totalDistanceSpan.textContent = "-";
    }
}

// Unity 노드 위치들 계산 (Unity 공식 사용)
function calculateUnityNodePositions(bpm, subdivisions, preDelaySeconds) {
    const directionNotes = notes.filter(n =>
        n.type === "direction" ||
        n.type === "both" ||
        n.type === "longdirection" ||
        n.type === "longboth" ||
        n.type === "node"
    ).sort((a, b) => a.beat - b.beat);

    if (directionNotes.length === 0) return [];

    const pathDirectionNotes = calculatePathDirectionNotes(directionNotes, bpm, subdivisions, preDelaySeconds);
    const unityNodePositions = [];
    let currentPosition = { x: 0, y: 0 };
    unityNodePositions.push({ ...currentPosition });

    for (let i = 0; i < pathDirectionNotes.length - 1; i++) {
        const fromNote = pathDirectionNotes[i];
        const toNote = pathDirectionNotes[i + 1];
        const deltaTime = toNote.finalTime - fromNote.finalTime;

        if (toNote.type === "node" && toNote.wait) {
            // Wait 노드는 이동하지 않음
            unityNodePositions.push({ ...currentPosition });
        } else {
            // Unity 공식으로 거리 계산
            const distance = calculateUnityNodeDistance(deltaTime, bpm, speedMultiplier);

            // 방향 결정
            let direction = fromNote.direction;
            if (fromNote.type === "node") {
                // 노드의 경우 이전 방향 노트의 방향 사용
                for (let j = i - 1; j >= 0; j--) {
                    const prevNote = pathDirectionNotes[j];
                    if (prevNote.type !== "node" && prevNote.direction) {
                        direction = prevNote.direction;
                        break;
                    }
                }
                direction = direction || "right";
            }

            // Unity 정규화된 방향 벡터
            const [dx, dy] = normalizeDirection(direction);

            // 다음 위치 계산
            const nextPosition = {
                x: currentPosition.x + dx * distance,
                y: currentPosition.y + dy * distance
            };

            currentPosition = nextPosition;
            unityNodePositions.push({ ...currentPosition });
        }
    }

    return unityNodePositions;
}

// 특정 노트의 Unity 위치 계산
function calculateNoteUnityPosition(note, unityNodePositions, bpm, subdivisions, preDelaySeconds) {
    const directionNotes = notes.filter(n =>
        n.type === "direction" ||
        n.type === "both" ||
        n.type === "longdirection" ||
        n.type === "longboth" ||
        n.type === "node"
    ).sort((a, b) => a.beat - b.beat);

    if (directionNotes.length === 0) return null;

    const pathDirectionNotes = calculatePathDirectionNotes(directionNotes, bpm, subdivisions, preDelaySeconds);
    const timing = getNoteTimingParams(note, bpm, subdivisions);
    const noteTime = beatToTime(note.beat, timing.bpm, timing.subdivisions) + preDelaySeconds;

    // 노트가 속한 구간 찾기
    for (let i = 0; i < pathDirectionNotes.length - 1; i++) {
        const fromNode = pathDirectionNotes[i];
        const toNode = pathDirectionNotes[i + 1];

        if (noteTime >= fromNode.finalTime && noteTime <= toNode.finalTime) {
            // Unity Lerp 방식으로 위치 계산
            const previousNodePosition = unityNodePositions[i];
            const nextNodePosition = unityNodePositions[i + 1];

            return calculateUnityNotePosition(
                noteTime,
                fromNode.finalTime,
                toNode.finalTime,
                previousNodePosition,
                nextNodePosition
            );
        }
    }

    return null;
}

// EventList UI 렌더링
// renderEventList 래퍼 함수 (디바운싱 적용)
function renderEventList() {
    scheduleRender({ eventList: true });
}

// 실제 렌더링 함수 (즉시 실행)
function renderEventListImmediate() {
    const container = document.getElementById("event-list");

    // 성능 최적화: Fragment 사용으로 DOM 조작 최소화
    const fragment = document.createDocumentFragment();

    // 성능 최적화: innerHTML 대신 removeChild로 이벤트 리스너 정리
    while (container.firstChild) {
        container.removeChild(container.firstChild);
    }

    const events = getAllEvents();
    const eventTypes = getEventTypes();

    // 성능 최적화: 이벤트가 많을 때 가상 스크롤링 적용
    if (events.length > 100) {
        return renderEventListVirtualized(events, eventTypes);
    }

    events.forEach((event, eventIndex) => {
        const eventDiv = document.createElement("div");
        eventDiv.className = "event-item";

        // Fragment에 추가 (DOM 조작 최소화)
        renderSingleEventItem(eventDiv, event, eventIndex, eventTypes);
        fragment.appendChild(eventDiv);
    });

    // 한 번에 DOM에 추가 (리플로우 최소화)
    container.appendChild(fragment);
}

// 가상 스크롤링을 위한 최적화된 렌더링 함수
function renderEventListVirtualized(events, eventTypes) {
    const container = document.getElementById("event-list");
    const virtualScrollState = {
        scrollTop: container.scrollTop || 0,
        itemHeight: 120, // 각 이벤트 아이템의 예상 높이
        visibleCount: Math.ceil(container.clientHeight / 120) + 5, // 버퍼 포함
        bufferCount: 5
    };

    const startIndex = Math.max(0, Math.floor(virtualScrollState.scrollTop / virtualScrollState.itemHeight) - virtualScrollState.bufferCount);
    const endIndex = Math.min(events.length, startIndex + virtualScrollState.visibleCount + virtualScrollState.bufferCount * 2);

    // 성능 최적화: innerHTML 대신 removeChild로 이벤트 리스너 정리
    while (container.firstChild) {
        container.removeChild(container.firstChild);
    }

    // 상단 스페이서
    if (startIndex > 0) {
        const topSpacer = document.createElement("div");
        topSpacer.style.height = `${startIndex * virtualScrollState.itemHeight}px`;
        container.appendChild(topSpacer);
    }

    // 보이는 이벤트들만 렌더링
    const fragment = document.createDocumentFragment();
    for (let i = startIndex; i < endIndex; i++) {
        const event = events[i];
        const eventDiv = document.createElement("div");
        eventDiv.className = "event-item";

        renderSingleEventItem(eventDiv, event, i, eventTypes);
        fragment.appendChild(eventDiv);
    }
    container.appendChild(fragment);

    // 하단 스페이서
    if (endIndex < events.length) {
        const bottomSpacer = document.createElement("div");
        bottomSpacer.style.height = `${(events.length - endIndex) * virtualScrollState.itemHeight}px`;
        container.appendChild(bottomSpacer);
    }
}

// 단일 이벤트 아이템 렌더링 함수 (코드 중복 제거)
function renderSingleEventItem(eventDiv, event, eventIndex, eventTypes) {
    // 기존 이벤트 아이템 렌더링 로직을 여기로 이동

        // 선택된 이벤트 표시
        if (selectedEventIndices.has(eventIndex)) {
            eventDiv.classList.add("selected");
        }

        // 이벤트 아이템 클릭 시 선택/해제
        eventDiv.addEventListener("click", (e) => {
            // 입력 필드나 버튼을 클릭한 경우가 아닐 때만 처리
            if (!["INPUT", "SELECT", "BUTTON"].includes(e.target.tagName)) {
                if (e.shiftKey && lastClickedEventIndex !== null) {
                    // Shift 클릭: 범위 선택
                    const start = Math.min(lastClickedEventIndex, eventIndex);
                    const end = Math.max(lastClickedEventIndex, eventIndex);
                    for (let i = start; i <= end; i++) {
                        selectedEventIndices.add(i);
                    }
                    lastClickedEventIndex = eventIndex;
                    scheduleRender({ eventList: true });
                } else if (e.ctrlKey || e.metaKey) {
                    // Ctrl/Cmd 클릭: 다중 선택
                    if (selectedEventIndices.has(eventIndex)) {
                        selectedEventIndices.delete(eventIndex);
                    } else {
                        selectedEventIndices.add(eventIndex);
                    }
                    lastClickedEventIndex = eventIndex;
                    scheduleRender({ eventList: true });
                } else {
                    // 일반 클릭: 해당 위치로 이동
                    lastClickedEventIndex = eventIndex;
                    focusEventAtIndex(eventIndex);
                }
            }
        });

        const eventHeader = document.createElement("div");
        eventHeader.className = "event-header";

        // Event Type 드롭다운
        const typeLabel = document.createElement("label");
        typeLabel.textContent = "Type: ";
        const typeSelect = document.createElement("select");
        typeSelect.className = "event-type-select";
        eventTypes.forEach(type => {
            const option = document.createElement("option");
            option.value = type;
            option.textContent = type;
            option.selected = type === event.eventType;

            // 설명이 있으면 title 속성에 추가
            const description = getEventTypeDescription(type);
            if (description) {
                option.title = description;
            }

            typeSelect.appendChild(option);
        });
        // 현재 선택된 값의 설명을 select에 표시
        const currentDescription = getEventTypeDescription(event.eventType);
        if (currentDescription) {
            typeSelect.title = currentDescription;
        }

        typeSelect.addEventListener("change", (e) => {
            event.eventType = e.target.value;
            // 선택된 값의 설명으로 툴팁 업데이트
            const newDescription = getEventTypeDescription(e.target.value);
            typeSelect.title = newDescription || '';

            // EventType이 변경되면 EventId 입력 요소를 재생성
            const oldIdInput = idLabel.querySelector('.event-id-input, .event-id-select');
            if (oldIdInput) {
                oldIdInput.remove();
            }

            // 타입이 변경되었으므로 eventId 초기화
            event.eventId = '';

            const newIdInput = createEventIdInput();
            idLabel.appendChild(newIdInput);

            saveToStorage();
        });
        typeLabel.appendChild(typeSelect);

        // Event ID 입력 (타입에 따라 드롭다운 또는 텍스트 입력)
        const idLabel = document.createElement("label");
        idLabel.textContent = "ID: ";

        function createEventIdInput() {
            const isCustom = isCustomEventType(event.eventType);
            let idInput;

            if (isCustom) {
                // custom 타입이면 텍스트 입력
                idInput = document.createElement("input");
                idInput.type = "text";
                idInput.className = "event-id-input";
                idInput.value = event.eventId;
                idInput.addEventListener("change", (e) => {
                    event.eventId = e.target.value;
                    saveToStorage();
                });
            } else {
                // 사전 정의된 타입이면 드롭다운
                idInput = document.createElement("select");
                idInput.className = "event-id-select";

                const eventIds = getEventIdsByType(event.eventType);

                // 빈 옵션 추가 (선택 안함)
                const emptyOption = document.createElement("option");
                emptyOption.value = "";
                emptyOption.textContent = "-- 선택 --";
                idInput.appendChild(emptyOption);

                // 사전 정의된 EventId 옵션들 추가
                eventIds.forEach(id => {
                    const option = document.createElement("option");
                    option.value = id;
                    option.textContent = id;
                    option.selected = id === event.eventId;
                    idInput.appendChild(option);
                });

                // 현재 값이 목록에 없으면 "기타" 옵션으로 추가
                if (event.eventId && !eventIds.includes(event.eventId)) {
                    const customOption = document.createElement("option");
                    customOption.value = event.eventId;
                    customOption.textContent = `${event.eventId} (사용자 정의)`;
                    customOption.selected = true;
                    idInput.appendChild(customOption);
                }

                idInput.addEventListener("change", (e) => {
                    event.eventId = e.target.value;

                    // 사전 정의된 파라미터 자동 추가
                    applyPredefinedParams(eventIndex);

                    saveToStorage();
                    scheduleRender({ eventList: true }); // UI 새로고침으로 새로 추가된 파라미터들 표시
                });
            }

            return idInput;
        }

        const idInput = createEventIdInput();
        idLabel.appendChild(idInput);

        // Event Time 입력
        const timeLabel = document.createElement("label");
        timeLabel.textContent = "Time: ";
        const timeInput = document.createElement("input");
        timeInput.type = "number";
        timeInput.className = "event-time-input";
        timeInput.step = "0.1";
        timeInput.value = event.eventTime;
        timeInput.addEventListener("change", (e) => {
            const newTime = parseFloat(e.target.value) || 0;
            const oldTime = event.eventTime;
            const timeDiff = newTime - oldTime;

            // 여러 이벤트가 선택되어 있고, 현재 이벤트가 선택된 이벤트 중 하나일 때
            if (selectedEventIndices.has(eventIndex) && selectedEventIndices.size > 1) {
                // 변경 전 상태를 히스토리에 저장
                saveState();

                // 선택된 모든 이벤트의 시간을 동일한 증감치만큼 조정
                const updates = [];
                selectedEventIndices.forEach(idx => {
                    const eventToUpdate = getEventAtIndex(idx);
                    if (eventToUpdate) {
                        updates.push({
                            index: idx,
                            event: {
                                ...eventToUpdate,
                                eventTime: eventToUpdate.eventTime + timeDiff
                            }
                        });
                    }
                });
                updateMultipleEvents(updates);
            } else {
                // 단일 이벤트 업데이트
                updateEvent(eventIndex, {
                    ...event,
                    eventTime: newTime
                });
            }

            saveToStorage();
            scheduleRender({ eventList: true });
        });
        timeLabel.appendChild(timeInput);

        // 사전 정의된 파라미터 추가 버튼 (Event ID가 설정되어 있을 때만 표시)
        const predefinedParamsBtn = document.createElement("button");
        predefinedParamsBtn.textContent = "기본 파라미터 추가";
        predefinedParamsBtn.className = "add-predefined-params-btn";
        predefinedParamsBtn.style.fontSize = "11px";
        predefinedParamsBtn.style.padding = "2px 6px";

        // 사전 정의된 파라미터가 있는지 확인
        const predefinedParams = getPredefinedParamsForEventId(event.eventType, event.eventId);
        if (predefinedParams.length > 0 && event.eventId) {
            predefinedParamsBtn.style.display = "inline-block";
            predefinedParamsBtn.title = `${predefinedParams.map(p => p.paramName).join(', ')} 파라미터 추가`;
        } else {
            predefinedParamsBtn.style.display = "none";
        }

        predefinedParamsBtn.addEventListener("click", () => {
            applyPredefinedParams(eventIndex);
            saveToStorage();
            scheduleRender({ eventList: true }); // UI 새로고침으로 새로 추가된 파라미터들 표시
        });

        // 삭제 버튼
        const deleteBtn = document.createElement("button");
        deleteBtn.textContent = "Delete";
        deleteBtn.className = "delete-event-btn";
        deleteBtn.addEventListener("click", () => {
            if (confirm("이벤트를 삭제하시겠습니까?")) {
                removeEvent(eventIndex);
                scheduleRender({ eventList: true });
                saveToStorage();
            }
        });

        eventHeader.appendChild(typeLabel);
        eventHeader.appendChild(idLabel);
        eventHeader.appendChild(timeLabel);
        eventHeader.appendChild(predefinedParamsBtn);
        eventHeader.appendChild(deleteBtn);

        // Parameters 컨테이너
        const paramsContainer = document.createElement("div");
        paramsContainer.className = "event-params-container";

        const paramsLabel = document.createElement("div");
        paramsLabel.className = "params-label";

        const toggleIcon = document.createElement("span");
        toggleIcon.className = "params-toggle";
        toggleIcon.textContent = "▼";

        const labelText = document.createElement("span");
        labelText.textContent = "Parameters:";

        paramsLabel.appendChild(toggleIcon);
        paramsLabel.appendChild(labelText);

        const paramsContent = document.createElement("div");
        paramsContent.className = "params-content";

        paramsContainer.appendChild(paramsLabel);

        const paramsList = document.createElement("div");
        paramsList.className = "params-list";

        event.eventParams.forEach((param, paramIndex) => {
            const paramDiv = document.createElement("div");
            paramDiv.className = "param-item";


            // Param Name 입력
            const paramNameLabel = document.createElement("label");
            paramNameLabel.textContent = "Name: ";
            const paramNameInput = document.createElement("input");
            paramNameInput.type = "text";
            paramNameInput.className = "param-name-input";
            paramNameInput.value = param.paramName;
            paramNameInput.addEventListener("change", (e) => {
                param.paramName = e.target.value;
                saveToStorage();
            });
            paramNameLabel.appendChild(paramNameInput);

            // Param Value 입력
            const paramValueLabel = document.createElement("label");
            paramValueLabel.textContent = "Value: ";
            const paramValueInput = document.createElement("input");
            paramValueInput.type = "text";
            paramValueInput.className = "param-value-input";
            paramValueInput.value = param.paramValue;
            paramValueInput.addEventListener("change", (e) => {
                param.paramValue = e.target.value;
                saveToStorage();
            });
            paramValueLabel.appendChild(paramValueInput);

            // Param 삭제 버튼
            const deleteParamBtn = document.createElement("button");
            deleteParamBtn.textContent = "−";
            deleteParamBtn.className = "delete-param-btn";
            deleteParamBtn.addEventListener("click", () => {
                removeEventParam(eventIndex, paramIndex);
                scheduleRender({ eventList: true });
                saveToStorage();
            });

            paramDiv.appendChild(paramNameLabel);
            paramDiv.appendChild(paramValueLabel);
            paramDiv.appendChild(deleteParamBtn);

            paramsList.appendChild(paramDiv);
        });

        // Add Param 버튼
        const addParamBtn = document.createElement("button");
        addParamBtn.textContent = "+ Add Param";
        addParamBtn.className = "add-param-btn";
        addParamBtn.addEventListener("click", () => {
            addEventParam(eventIndex);
            scheduleRender({ eventList: true });
            saveToStorage();
        });

        paramsContent.appendChild(paramsList);
        paramsContent.appendChild(addParamBtn);
        paramsContainer.appendChild(paramsContent);

        // 접기/펼치기 이벤트 리스너
        paramsLabel.addEventListener("click", () => {
            const isCollapsed = paramsContent.classList.contains("collapsed");
            if (isCollapsed) {
                paramsContent.classList.remove("collapsed");
                paramsList.classList.remove("collapsed");
                toggleIcon.classList.remove("collapsed");
                toggleIcon.textContent = "▼";
            } else {
                paramsContent.classList.add("collapsed");
                paramsList.classList.add("collapsed");
                toggleIcon.classList.add("collapsed");
                toggleIcon.textContent = "▶";
            }
        });

        eventDiv.appendChild(eventHeader);
        eventDiv.appendChild(paramsContainer);

        container.appendChild(eventDiv);
    });
}

// 탭 전환 함수
function switchTab(tabName) {
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');

    tabButtons.forEach(btn => btn.classList.remove('active'));
    tabContents.forEach(content => content.classList.remove('active'));

    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
    document.getElementById(`${tabName}-tab`).classList.add('active');

    if (tabName === 'events') {
        // 노트 선택 해제
        selectedNoteIndices.clear();
        lastClickedNoteIndex = null;
        renderEventList();
    } else if (tabName === 'notes') {
        // 이벤트 선택 해제
        selectedEventIndices.clear();
        lastClickedEventIndex = null;
        renderNoteList();
    }
}

// 초기화
document.addEventListener("DOMContentLoaded", async () => {
    console.log('DOM loaded, initializing...');

    // Undo/Redo 시스템 초기화
    initializeUndoRedo();

    try {
        await initDB();
        console.log('IndexedDB initialized');
    } catch (err) {
        console.warn('IndexedDB initialization failed:', err);
    }

    setupSubdivisionsOptions();

    viewOffset = {
        x: canvas.clientWidth / 2,
        y: canvas.clientHeight / 2
    };

    setupWaveformFloating();
    setupWaveformControls();
    setupWaveformWheel();
    setupWaveformSlider();
    setupWaveformClick();

    // Virtual Scrolling 초기화
    const noteListContainer = document.querySelector("#notes-tab table");
    if (noteListContainer) {
        const scrollContainer = noteListContainer.closest(".tab-content");
        if (scrollContainer) {
            // 스크롤 이벤트 리스너 추가
            scrollContainer.addEventListener("scroll", () => {
                virtualScrollState.scrollTop = scrollContainer.scrollTop;
                scheduleRender({ noteList: true });
            });

            // 화면 크기에 따른 visibleCount 계산
            const updateVisibleCount = () => {
                const containerHeight = scrollContainer.clientHeight;
                virtualScrollState.visibleCount = Math.ceil(containerHeight / virtualScrollState.itemHeight) + 10;
            };
            updateVisibleCount();
            window.addEventListener('resize', updateVisibleCount);
        }
    }

    hasAudioFile = false;
    audioBuffer = null;
    waveformData = null;

    const bpmField = document.getElementById("bpm");
    const subdivisionsField = document.getElementById("subdivisions");
    const preDelayField = document.getElementById("pre-delay");

    if (bpmField) {
        bpmField.dataset.previousValue = bpmField.value || "120";
    }
    if (subdivisionsField) {
        subdivisionsField.dataset.previousValue = subdivisionsField.value || "16";
    }

    if (bpmField) {
        bpmField.addEventListener("change", (e) => {
            handleBpmChange(parseFloat(e.target.value || 120));
        });
    }

    if (subdivisionsField) {
        subdivisionsField.addEventListener("change", (e) => {
            handleSubdivisionsChange(parseInt(e.target.value || 16));
        });
    }

    if (preDelayField) {
        preDelayField.addEventListener("change", handlePreDelayChange);
    }

    const speedMultiplierField = document.getElementById("speed-multiplier");
    if (speedMultiplierField) {
        speedMultiplierField.addEventListener("change", (e) => {
            handleSpeedMultiplierChange(parseFloat(e.target.value || 1.0));
        });
    }

    document.getElementById("clear-notes").addEventListener("click", () => {
        if (confirm("모든 데이터를 삭제하시겠습니까?")) {
            // 변경 전 상태를 히스토리에 저장
            saveState();

            localStorage.removeItem("autosave_notes");
            notes.length = 0;
            clearAllEvents();
            ensureInitialDirectionNote(notes);
            drawPath();
            renderNoteList();
            scheduleRender({ eventList: true });
        }
    });

    // 탭 버튼 이벤트 리스너
    document.querySelectorAll('.tab-button').forEach(button => {
        button.addEventListener('click', (e) => {
            const tabName = e.target.getAttribute('data-tab');
            switchTab(tabName);
        });
    });

    // Add Event 버튼 이벤트 리스너
    document.getElementById("add-event").addEventListener("click", () => {
        addEvent();
        renderEventList();
        saveToStorage();
    });

    // 복제 버튼 이벤트 리스너
    document.getElementById("duplicate-events").addEventListener("click", () => {
        if (selectedEventIndices.size === 0) {
            alert("복제할 이벤트를 선택해주세요.");
            return;
        }

        // 변경 전 상태를 히스토리에 저장
        saveState();

        const selectedIndices = Array.from(selectedEventIndices).sort((a, b) => a - b);
        const maxIndex = Math.max(...selectedIndices);
        const clonedEvents = [];

        // 선택된 이벤트들을 복제
        selectedIndices.forEach(index => {
            const event = getEventAtIndex(index);
            if (event) {
                const clonedEvent = cloneEvent(event);
                clonedEvents.push(clonedEvent);
            }
        });

        // 가장 뒤에 있는 선택된 항목 바로 뒤에 삽입
        const insertIndex = maxIndex + 1;
        const newIndices = insertMultipleEvents(insertIndex, clonedEvents);

        // 복제된 이벤트들을 선택
        selectedEventIndices.clear();
        newIndices.forEach(index => selectedEventIndices.add(index));

        saveToStorage();
        renderEventList();
        drawPath();
    });

    // 이벤트 선택 해제 버튼
    document.getElementById("clear-event-selection").addEventListener("click", () => {
        selectedEventIndices.clear();
        lastClickedEventIndex = null;
        renderEventList();
    });

    // Go to URL 버튼 이벤트 리스너
    document.getElementById("go-to-url").addEventListener("click", () => {
        const url = "https://www.notion.so/ilsang93/TrackEvent-278b81f1cb6580f595a3c31abe3a2187?source=copy_link#278b81f1cb65808cb523ea007e49dcc4";
        if (url && url.trim() !== "" && url.trim() !== "https://") {
            window.open(url.trim(), '_blank');
        }
    });

    // 모두 접기 버튼 이벤트 리스너
    document.getElementById("collapse-all").addEventListener("click", () => {
        const paramsContents = document.querySelectorAll(".params-content");
        const paramsLists = document.querySelectorAll(".params-list");
        const toggleIcons = document.querySelectorAll(".params-toggle");

        paramsContents.forEach(content => content.classList.add("collapsed"));
        paramsLists.forEach(list => list.classList.add("collapsed"));
        toggleIcons.forEach(icon => {
            icon.classList.add("collapsed");
            icon.textContent = "▶";
        });
    });

    // 모두 펼치기 버튼 이벤트 리스너
    document.getElementById("expand-all").addEventListener("click", () => {
        const paramsContents = document.querySelectorAll(".params-content");
        const paramsLists = document.querySelectorAll(".params-list");
        const toggleIcons = document.querySelectorAll(".params-toggle");

        paramsContents.forEach(content => content.classList.remove("collapsed"));
        paramsLists.forEach(list => list.classList.remove("collapsed"));
        toggleIcons.forEach(icon => {
            icon.classList.remove("collapsed");
            icon.textContent = "▼";
        });
    });

    // Undo/Redo 버튼 이벤트 리스너
    document.getElementById("undo-btn").addEventListener("click", () => {
        if (undo()) {
            console.log('Undo performed via button');
        }
    });

    document.getElementById("redo-btn").addEventListener("click", () => {
        if (redo()) {
            console.log('Redo performed via button');
        }
    });

    document.getElementById("duplicate-notes").addEventListener("click", () => {
        if (selectedNoteIndices.size === 0) {
            alert("복제할 노트를 선택해주세요.");
            return;
        }

        // 변경 전 상태를 히스토리에 저장
        saveState();

        const selectedIndices = Array.from(selectedNoteIndices).sort((a, b) => a - b);
        const maxIndex = Math.max(...selectedIndices);
        const clonedNotes = [];

        // 선택된 노트들을 복제
        selectedIndices.forEach(index => {
            const note = notes[index];
            const clonedNote = {
                type: note.type,
                beat: note.beat,
                isLong: note.isLong,
                ...(note.longTime && { longTime: note.longTime }),
                ...(note.direction && { direction: note.direction }),
                ...(note.bpm && { bpm: note.bpm }),
                ...(note.subdivisions && { subdivisions: note.subdivisions }),
                ...(note.wait !== undefined && { wait: note.wait })
            };
            clonedNotes.push(clonedNote);
        });

        // 가장 뒤에 있는 선택된 항목 바로 뒤에 삽입
        const newIndices = [];
        clonedNotes.forEach((clonedNote, i) => {
            const insertIndex = maxIndex + 1 + i;
            notes.splice(insertIndex, 0, clonedNote);
            newIndices.push(insertIndex);
        });

        // 복제된 노트들을 선택
        selectedNoteIndices.clear();
        newIndices.forEach(index => selectedNoteIndices.add(index));

        // 캐시 무효화
        invalidatePathCache();

        saveToStorage();
        drawPath();
        renderNoteList();
        if (waveformData) drawWaveformWrapper();
    });

    // 노트 선택 해제 버튼
    document.getElementById("clear-note-selection").addEventListener("click", () => {
        selectedNoteIndices.clear();
        lastClickedNoteIndex = null;
        renderNoteList();
    });

    document.getElementById("sort-notes").addEventListener("click", () => {
        // 변경 전 상태를 히스토리에 저장
        saveState();

        // 시간 기준으로 정렬 (각 노트의 BPM과 subdivision을 고려)
        notes.sort((a, b) => {
            const timeA = beatToTime(a.beat, a.bpm || 120, a.subdivisions || 16);
            const timeB = beatToTime(b.beat, b.bpm || 120, b.subdivisions || 16);
            return timeA - timeB;
        });

        // 이벤트도 시간 기준으로 정렬
        sortEventsByTime();

        saveToStorage();
        drawPath();
        renderNoteList();
        renderEventList();
    });

    document.getElementById("save-json").addEventListener("click", () => {
        const bpm = parseFloat(document.getElementById("bpm").value || 120);
        const subdivisions = parseInt(document.getElementById("subdivisions").value || 16);
        const preDelayValue = parseInt(document.getElementById("pre-delay").value || 0);
        const preDelaySeconds = preDelayValue / 1000;

        // 마지막 Direction Type None 노트 확인 및 추가
        ensureFinalDirectionNote(notes, bpm, subdivisions);

        const validationResult = validateChart(notes, bpm, subdivisions, preDelaySeconds);
        if (!validationResult.isValid) {
            alert(`차트 검증 실패:\n\n${validationResult.errors.join('\n')}\n\n수정 후 다시 시도해주세요.`);
            return;
        }

        // 경고 메시지가 있으면 사용자에게 알림
        if (validationResult.warnings && validationResult.warnings.length > 0) {
            const proceedExport = confirm(`다음과 같은 경고가 있습니다:\n\n${validationResult.warnings.join('\n')}\n\n계속 내보내시겠습니까?`);
            if (!proceedExport) {
                return;
            }
        }

        const validatedNotes = validationResult.notes;

        const levelValue = parseInt(document.getElementById("level").value || 10);
        const minBpm = parseFloat(document.getElementById("min-bpm").value || 60);
        const maxBpm = parseFloat(document.getElementById("max-bpm").value || 300);

        const exportData = {
            diffIndex: 5,
            level: levelValue,
            bpm: bpm,
            minbpm: minBpm,
            maxbpm: maxBpm,
            subdivisions: subdivisions,
            preDelay: preDelayValue,
            noteList: validatedNotes.map(n => {
                // 각 노트의 개별 BPM/subdivision 사용
                const noteBpm = n.bpm || bpm;
                const noteSubdivisions = n.subdivisions || subdivisions;
                const originalTime = beatToTime(n.beat, noteBpm, noteSubdivisions);

                let finalTime;
                if (n.beat === 0 && n.type === "direction") {
                    finalTime = originalTime;
                } else {
                    finalTime = originalTime + preDelaySeconds;
                }

                const noteType = convertNoteTypeToExternal(n.type);

                // LongTime을 각 노트의 BPM/subdivision으로 시간값 변환
                const longTimeInSeconds = (n.isLong && n.longTime > 0) ? calculateLongNoteTime(n, noteBpm, noteSubdivisions) : 0;

                const result = {
                    beat: n.beat,
                    bpm: noteBpm, // 노트별 BPM 사용
                    subdivisions: noteSubdivisions, // 노트별 subdivision 사용
                    originalTime: originalTime,
                    musicTime: MUSIC_START_TIME + originalTime,
                    finalTime: finalTime,
                    isLong: n.isLong || false,
                    longTime: longTimeInSeconds,
                    longTimeBeat: n.longTime || 0,
                    noteType: noteType,
                    direction: n.direction || "none"
                };

                // Node 타입 노트의 경우 isWait 필드 추가
                if (n.type === "node") {
                    result.isWait = n.wait || false;
                }

                return result;
            }),
            eventList: eventsToJson(),
            metadata: {
                description: "Music starts at 3 seconds, with pre-delay correction",
                timingExplanation: "finalTime = 3.0 + originalTime + preDelay (except for beat 0 direction note)",
                preDelayUnit: "milliseconds",
                longTimeUnit: "longTime values are in seconds (calculated using each note's individual BPM/subdivisions)",
                bpmExplanation: "Top-level bpm/subdivisions are global defaults. Each note has individual bpm/subdivisions for variable tempo support",
                validationApplied: "Chart validated and auto-corrected",
                eventListDescription: "Events are separate from notes and contain custom game logic triggers",
                exportedAt: new Date().toISOString()
            }
        };

        // XX_MUSICNAME 형태의 기본 파일명 생성
        let defaultFilename = "XX";
        if (savedAudioFile && savedAudioFile.name) {
            // 음원 파일명에서 확장자 제거
            const musicName = savedAudioFile.name.replace(/\.[^/.]+$/, "");
            defaultFilename = `XX_${musicName}`;
        }

        const blob = new Blob([JSON.stringify(exportData, null, 2)], {
            type: "application/json"
        });

        // 파일 다이얼로그를 통한 저장
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${defaultFilename}.json`;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        URL.revokeObjectURL(a.href);
    });

    document.getElementById("load-json").addEventListener("click", () => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json";
        input.addEventListener("change", (e) => {
            const file = e.target.files[0];
            if (!file)
                return;

            const reader = new FileReader();
            reader.onload = (ev) => {
                try {
                    const json = JSON.parse(ev.target.result);
                    if (!json.noteList || !Array.isArray(json.noteList)) {
                        alert("올바른 JSON 파일이 아닙니다.");
                        return;
                    }

                    // 변경 전 상태를 히스토리에 저장
                    saveState();

                    notes.length = 0;
                    const bpm = json.bpm || 120;
                    const subdivisions = json.subdivisions || 16;

                    let preDelayMs;
                    if (json.preDelay !== undefined) {
                        if (json.preDelay <= 10) {
                            preDelayMs = json.preDelay * 1000;
                            console.log(`Legacy format detected: ${json.preDelay}s converted to ${preDelayMs}ms`);
                        } else {
                            preDelayMs = json.preDelay;
                        }
                    } else {
                        preDelayMs = 0;
                    }

                    json.noteList.forEach(n => {
                        const beat = n.beat !== undefined ? n.beat : timeToBeat(n.time || 0, bpm, subdivisions);

                        const type = convertExternalToNoteType(n.noteType);

                        let longTimeBeat = 0;
                        if (n.longTimeBeat !== undefined) {
                            longTimeBeat = n.longTimeBeat;
                        } else if (n.longTime !== undefined && n.longTime > 0) {
                            // 각 노트의 개별 BPM/subdivision으로 longTime(시간) → longTimeBeat(비트) 변환
                            const noteBpm = n.bpm || bpm;
                            const noteSubdivisions = n.subdivisions || subdivisions;
                            longTimeBeat = timeToBeat(n.longTime, noteBpm, noteSubdivisions);
                        }

                        const noteData = {
                            type: type,
                            beat: beat,
                            direction: n.direction || "none",
                            isLong: n.isLong || false,
                            longTime: longTimeBeat,
                            bpm: n.bpm || bpm, // 노트별 BPM 로드 (없으면 전역 BPM 사용)
                            subdivisions: n.subdivisions || subdivisions // 노트별 subdivision 로드 (없으면 전역 값 사용)
                        };

                        // Node 타입 노트의 경우 wait 필드 추가
                        if (type === "node") {
                            noteData.wait = n.isWait || false;
                        }

                        notes.push(noteData);
                    });

                    document.getElementById("bpm").value = bpm;
                    document.getElementById("subdivisions").value = subdivisions;
                    document.getElementById("pre-delay").value = preDelayMs;

                    // Level 값 설정 (없으면 기본값 10)
                    const levelValue = json.level || 10;
                    document.getElementById("level").value = levelValue;
                    document.getElementById("level-display").textContent = levelValue;

                    // Min/Max BPM 값 설정 (없으면 기본값 사용)
                    const minBpm = json.minbpm || 60;
                    const maxBpm = json.maxbpm || 300;
                    document.getElementById("min-bpm").value = minBpm;
                    document.getElementById("max-bpm").value = maxBpm;

                    document.getElementById("bpm").dataset.previousValue = bpm;
                    document.getElementById("subdivisions").dataset.previousValue = subdivisions;

                    // EventList 로드
                    if (json.eventList && Array.isArray(json.eventList)) {
                        loadEventsFromJson(json.eventList);
                    } else {
                        clearAllEvents();
                    }

                    // 초기 direction 노트 확인 및 추가
                    ensureInitialDirectionNote(notes);
                    // 마지막 direction 노트 확인 및 추가
                    ensureFinalDirectionNote(notes, bpm, subdivisions);

                    saveToStorage();
                    drawPath();
                    renderNoteList();
                    scheduleRender({ eventList: true });
                    if (waveformData)
                        drawWaveformWrapper();
                } catch (err) {
                    alert("불러오기 중 오류 발생: " + err.message);
                }
            };
            reader.readAsText(file);
        });
        input.click();
    });

    inputAudio.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (!file) {
            hasAudioFile = false;
            audioBuffer = null;
            waveformData = null;
            savedAudioFile = null;
            if (audioFileURL)
                URL.revokeObjectURL(audioFileURL);
            audioFileURL = null;
            demoAudio.src = '';
            drawWaveformWrapper();

            const container = inputAudio.parentElement;
            const indicator = container.querySelector('.file-indicator');
            if (indicator)
                indicator.remove();

            saveToStorage();
            return;
        }

        if (audioFileURL)
            URL.revokeObjectURL(audioFileURL);
        audioFileURL = URL.createObjectURL(file);
        demoAudio.src = audioFileURL;
        demoAudio.volume = musicVolume;
        demoAudio.load();

        const container = inputAudio.parentElement;
        let indicator = container.querySelector('.file-indicator');
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.className = 'file-indicator';
            indicator.style.cssText = 'margin-top: 5px; font-size: 12px; color: #4CAF50; font-weight: bold;';
            container.appendChild(indicator);
        }
        indicator.textContent = `선택된 파일: ${file.name}`;

        processAudioForWaveform(file);
    });

    btnDemoPlay.addEventListener("click", () => {
        if (!demoAudio.src) {
            alert("오디오 파일을 먼저 선택해주세요.");
            return;
        }
        if (isPlaying) {
            resumeDemo();
        } else {
            startDemo();
        }
    });
    btnDemoPause.addEventListener("click", pauseDemo);
    btnDemoStop.addEventListener("click", stopDemo);

    seekbar.addEventListener("input", () => {
        if (!isPlaying)
            return;
        elapsedTime = seekbar.value / 1000;
        startTime = performance.now() - elapsedTime * 1000;

        // 현재 시간보다 이후의 노트와 이벤트 실행 상태를 리셋
        const notesToReset = [];
        notes.forEach((note, index) => {
            const noteId = `${note.type}-${note.beat}-${index}`;
            let finalTime;

            if (note.beat === 0 && note.type === "direction") {
                finalTime = getPreDelaySeconds();
            } else {
                const noteBpm = note.bpm || parseFloat(document.getElementById("bpm").value || 120);
                const noteSubdivisions = note.subdivisions || parseInt(document.getElementById("subdivisions").value || 16);
                const originalTime = beatToTime(note.beat, noteBpm, noteSubdivisions);
                finalTime = originalTime + getPreDelaySeconds();
            }

            if (finalTime > elapsedTime) {
                notesToReset.push(noteId);
            }
        });

        notesToReset.forEach(noteId => {
            playedNotes.delete(noteId);
        });

        // 현재 시간보다 이후의 이벤트 실행 상태를 리셋
        resetEventExecutionToTime(elapsedTime);

        const preDelaySeconds = getPreDelaySeconds();
        if (elapsedTime < MUSIC_START_TIME) {
            demoAudio.pause();
            demoAudio.currentTime = 0;
        } else {
            demoAudio.currentTime = Math.max(0, elapsedTime - MUSIC_START_TIME);
            if (!demoAudio.paused) {
                demoAudio.play();
            }
        }
        drawPath();
    });

    canvas.addEventListener("wheel", (e) => {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 1.1 : 0.9;
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const worldX = (mouseX - viewOffset.x) / zoom;
        const worldY = (mouseY - viewOffset.y) / zoom;
        zoom *= delta;
        viewOffset.x = mouseX - worldX * zoom;
        viewOffset.y = mouseY - worldY * zoom;
        drawPath();
    }, {
        passive: false
    });

    canvas.addEventListener("mousedown", (e) => {
        if (e.button === 1) {
            isPanning = true;
            lastMousePos = {
                x: e.clientX,
                y: e.clientY
            };
        }
    });

    canvas.addEventListener("mousemove", (e) => {
        if (isPanning) {
            const dx = e.clientX - lastMousePos.x;
            const dy = e.clientY - lastMousePos.y;
            viewOffset.x += dx;
            viewOffset.y += dy;
            lastMousePos = {
                x: e.clientX,
                y: e.clientY
            };
            drawPath();
        }
    });

    canvas.addEventListener("mouseup", (e) => {
        if (e.button === 1) {
            isPanning = false;
        }
    });

    canvas.addEventListener("click", (e) => {
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        for (let i = 0; i < notes.length; i++) {
            const pos = getNotePosition(notes[i].beat);
            if (!pos)
                continue;
            const screenX = pos.x * zoom + viewOffset.x;
            const screenY = pos.y * zoom + viewOffset.y;
            const dist = Math.hypot(screenX - mx, screenY - my);
            if (dist < 10) {
                focusNoteAtIndex(i);
                break;
            }
        }
    });

    const batchEditCheckbox = document.getElementById('batch-edit-toggle');
    batchEditCheckbox.addEventListener('change', (e) => {
        isBatchEditEnabled = e.target.checked;
    });

    const cameraTrackingCheckbox = document.getElementById('camera-tracking');
    cameraTrackingCheckbox.addEventListener('change', (e) => {
        isCameraTracking = e.target.checked;
    });

    window.addEventListener('resize', () => {
        resizeWaveformCanvas();
        if (waveformData) {
            drawWaveformWrapper();
        }
    });

    setupVolumeControls();
    setupToggleFeatures();
    setupNoteButtons();

    ensureInitialDirectionNote(notes);
    loadFromStorage();

    // 기존 노트들에 개별 BPM/subdivision이 없으면 현재 설정값으로 초기화
    initializeNoteBpmSubdivisions();

    loadNoteSounds();

    drawPath();
    renderNoteList();
    renderEventList();
    updateCoordinateInfo();

    // 키보드 단축키
    document.addEventListener('keydown', (e) => {
        // Ctrl+Z (실행 취소) - 모든 상황에서 작동
        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
            e.preventDefault();
            if (undo()) {
                console.log('Undo performed via Ctrl+Z');
            }
            return;
        }

        // Ctrl+Y 또는 Ctrl+Shift+Z (다시 실행) - 모든 상황에서 작동
        if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
            e.preventDefault();
            if (redo()) {
                console.log('Redo performed via Ctrl+Y or Ctrl+Shift+Z');
            }
            return;
        }

        // Ctrl+C (복사) - 선택된 이벤트/노트를 JSON 형태로 클립보드에 복사
        if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
            // 입력 필드에서는 기본 복사 기능 사용
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                return;
            }
            // 아무것도 선택되지 않았으면 기본 복사 기능 사용 (텍스트 선택 등)
            if (selectedEventIndices.size === 0 && selectedNoteIndices.size === 0) {
                return;
            }
            e.preventDefault();
            copySelectedItems();
            return;
        }

        // Ctrl+V (붙여넣기) - 클립보드의 JSON 데이터를 리스트에 추가
        if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
            // 입력 필드에서는 기본 붙여넣기 기능 사용
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                return;
            }
            e.preventDefault();
            pasteItems();
            return;
        }

        // 입력 필드나 버튼에 포커스가 있을 때는 노트 추가 단축키 작동 안 함
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'BUTTON') {
            return;
        }

        switch (e.key) {
            case ' ': // Space 키로 모든 선택 해제
                clearAllSelections();
                break;
            case 'Delete': // Del 키로 선택된 노트/이벤트 삭제
                deleteSelectedItems();
                break;
            case 'q':
                addNote({ type: "tab", isLong: false, longTime: 0 });
                break;
            case 'w':
                addNote({ type: "direction", isLong: false, longTime: 0 });
                break;
            case 'e':
                addNote({ type: "both", isLong: false, longTime: 0 });
                break;
            case 'a':
                addNote({ type: "longtab", isLong: true });
                break;
            case 's':
                addNote({ type: "longdirection", isLong: true });
                break;
            case 'd':
                addNote({ type: "longboth", isLong: true });
                break;
        }
    });

    // 초기 버튼 상태 설정
    updateUndoRedoButtons();

    console.log('Initialization complete');
});

// 선택 관련 함수들

// 선택된 항목들 삭제 (Del 키)
function deleteSelectedItems() {
    // 현재 활성화된 탭 확인
    const notesTab = document.getElementById('notes-tab');
    const eventsTab = document.getElementById('events-tab');
    const isNotesTabActive = notesTab.classList.contains('active');
    const isEventsTabActive = eventsTab.classList.contains('active');

    if (isNotesTabActive) {
        // 노트 탭이 활성화된 경우 - 선택된 노트들 삭제
        deleteSelectedNotes();
    } else if (isEventsTabActive) {
        // 이벤트 탭이 활성화된 경우 - 선택된 이벤트들 삭제
        deleteSelectedEvents();
    }
}

// 선택된 노트들 삭제
function deleteSelectedNotes() {
    if (selectedNoteIndices.size === 0) {
        return; // 선택된 노트가 없으면 아무것도 하지 않음
    }

    // 변경 전 상태를 히스토리에 저장
    saveState();

    // 인덱스를 내림차순으로 정렬하여 뒤에서부터 삭제 (인덱스 변화 방지)
    const sortedIndices = Array.from(selectedNoteIndices).sort((a, b) => b - a);

    let deletedCount = 0;
    for (const index of sortedIndices) {
        const note = notes[index];
        // beat 0인 direction 노트이고 첫 번째 노트인 경우 삭제 금지
        if (note && note.beat === 0 && note.type === "direction" && index === 0) {
            continue; // 이 노트는 삭제하지 않음
        }

        if (index >= 0 && index < notes.length) {
            notes.splice(index, 1);
            deletedCount++;
        }
    }

    if (deletedCount > 0) {
        // 캐시 무효화
        invalidatePathCache();

        // 선택 상태 초기화
        selectedNoteIndices.clear();
        selectedNoteIndex = null;
        lastClickedNoteIndex = null;

        // UI 업데이트 및 저장
        saveToStorage();
        renderNoteList();
        drawPath();
        if (waveformData) {
            drawWaveformWrapper();
        }

        console.log(`${deletedCount}개의 노트가 삭제되었습니다.`);
    }
}

// 선택된 이벤트들 삭제
function deleteSelectedEvents() {
    if (selectedEventIndices.size === 0) {
        return; // 선택된 이벤트가 없으면 아무것도 하지 않음
    }

    // 변경 전 상태를 히스토리에 저장
    saveState();

    // 인덱스를 내림차순으로 정렬하여 뒤에서부터 삭제 (인덱스 변화 방지)
    const sortedIndices = Array.from(selectedEventIndices).sort((a, b) => b - a);

    let deletedCount = 0;
    for (const index of sortedIndices) {
        if (removeEvent(index)) {
            deletedCount++;
        }
    }

    if (deletedCount > 0) {
        // 선택 상태 초기화
        selectedEventIndices.clear();
        lastClickedEventIndex = null;

        // UI 업데이트 및 저장
        saveToStorage();
        renderEventList();

        console.log(`${deletedCount}개의 이벤트가 삭제되었습니다.`);
    }
}

// 모든 선택 해제
function clearAllSelections() {
    selectedNoteIndices.clear();
    selectedEventIndices.clear();
    selectedNoteIndex = null;
    lastClickedNoteIndex = null;
    lastClickedEventIndex = null;

    // UI 업데이트
    renderNoteList();
    renderEventList();

    console.log('모든 선택이 해제되었습니다.');
}

// 복사/붙여넣기 관련 함수들

// 선택된 이벤트/노트들을 JSON 형태로 클립보드에 복사
async function copySelectedItems() {
    try {
        // 아무것도 선택되지 않았으면 복사하지 않음
        if (selectedEventIndices.size === 0 && selectedNoteIndices.size === 0) {
            console.log('복사할 항목이 선택되지 않았습니다.');
            return;
        }

        const itemsToCopy = {
            type: 'WL_Editor_Data',
            events: [],
            notes: []
        };

        // 현재 설정값들 가져오기
        const currentBpm = parseFloat(document.getElementById("bpm").value || 120);
        const currentSubdivisions = parseInt(document.getElementById("subdivisions").value || 16);
        const currentPreDelaySeconds = getPreDelaySeconds();

        // 선택된 이벤트들 복사
        if (selectedEventIndices.size > 0) {
            const allEvents = getAllEvents();
            const eventIndices = Array.from(selectedEventIndices).sort((a, b) => a - b);
            for (const index of eventIndices) {
                if (index >= 0 && index < allEvents.length) {
                    const event = allEvents[index];
                    // 출력 형태의 JSON으로 변환
                    const jsonEvent = {
                        eventType: event.eventType,
                        eventId: event.eventId,
                        eventTime: event.eventTime,
                        eventParams: event.eventParams.map(param => ({
                            paramName: param.paramName,
                            paramValue: param.paramValue
                        }))
                    };
                    itemsToCopy.events.push(jsonEvent);
                }
            }
        }

        // 선택된 노트들 복사
        if (selectedNoteIndices.size > 0) {
            const noteIndices = Array.from(selectedNoteIndices).sort((a, b) => a - b);
            for (const index of noteIndices) {
                if (index >= 0 && index < notes.length) {
                    const note = notes[index];
                    // 출력 형태의 JSON으로 변환
                    const jsonNote = noteToJsonFormat(note, currentBpm, currentSubdivisions, currentPreDelaySeconds);
                    itemsToCopy.notes.push(jsonNote);
                }
            }
        }

        if (itemsToCopy.events.length === 0 && itemsToCopy.notes.length === 0) {
            console.log('복사할 항목이 선택되지 않았습니다.');
            return;
        }

        // 클립보드에 복사
        const jsonString = JSON.stringify(itemsToCopy, null, 2);
        await navigator.clipboard.writeText(jsonString);

        console.log(`복사 완료: 이벤트 ${itemsToCopy.events.length}개, 노트 ${itemsToCopy.notes.length}개`);

        // 사용자에게 알림 (선택사항)
        showNotification(`복사 완료: 이벤트 ${itemsToCopy.events.length}개, 노트 ${itemsToCopy.notes.length}개`);

    } catch (error) {
        console.error('복사 중 오류:', error);
        showNotification('복사 중 오류가 발생했습니다.');
    }
}

// 클립보드의 JSON 데이터를 현재 선택된 항목과 같은 시간으로 붙여넣기
async function pasteItems() {
    try {
        const clipboardText = await navigator.clipboard.readText();
        let pasteData;

        try {
            pasteData = JSON.parse(clipboardText);
        } catch (parseError) {
            console.log('클립보드에 유효한 JSON 데이터가 없습니다.');
            return;
        }

        // WL_Editor_Data 형태인지 확인
        if (!pasteData || pasteData.type !== 'WL_Editor_Data') {
            console.log('WL Editor 데이터가 아닙니다.');
            return;
        }

        let pastedEventCount = 0;
        let pastedNoteCount = 0;

        // 현재 설정값들 가져오기
        const currentBpm = parseFloat(document.getElementById("bpm").value || 120);
        const currentSubdivisions = parseInt(document.getElementById("subdivisions").value || 16);

        // 현재 선택된 항목의 시간 가져오기
        let targetTime = null;
        let targetBeat = null;

        // 이벤트가 선택되어 있으면 이벤트 시간 사용
        if (selectedEventIndices.size > 0) {
            const allEvents = getAllEvents();
            const selectedIndex = Array.from(selectedEventIndices)[0];
            if (selectedIndex >= 0 && selectedIndex < allEvents.length) {
                targetTime = allEvents[selectedIndex].eventTime;
            }
        }

        // 노트가 선택되어 있으면 노트 비트 사용
        if (selectedNoteIndices.size > 0) {
            const selectedIndex = Array.from(selectedNoteIndices)[0];
            if (selectedIndex >= 0 && selectedIndex < notes.length) {
                targetBeat = notes[selectedIndex].beat;
            }
        }

        // 붙여넣기 전 현재 상태 저장 (Undo 지원)
        saveState();

        // 이벤트 붙여넣기
        if (pasteData.events && Array.isArray(pasteData.events)) {
            for (const eventData of pasteData.events) {
                const newEvent = {
                    eventType: eventData.eventType || 'camera',
                    eventId: eventData.eventId || '',
                    eventTime: targetTime !== null ? targetTime : (eventData.eventTime || 0),
                    eventParams: Array.isArray(eventData.eventParams) ?
                        eventData.eventParams.map(param => ({
                            paramType: 'string', // 기본값, 실제로는 사전 정의된 파라미터 타입 사용
                            paramName: param.paramName || '',
                            paramValue: param.paramValue || ''
                        })) : []
                };

                // 파라미터 타입 복원을 위해 사전 정의된 파라미터 확인
                const predefinedParams = getPredefinedParamsForEventId(newEvent.eventType, newEvent.eventId);
                newEvent.eventParams.forEach(param => {
                    const predefined = predefinedParams.find(p => p.paramName === param.paramName);
                    if (predefined) {
                        param.paramType = predefined.paramType;
                    }
                });

                addEvent(newEvent);
                pastedEventCount++;
            }
        }

        // 노트 붙여넣기
        if (pasteData.notes && Array.isArray(pasteData.notes)) {
            for (const noteData of pasteData.notes) {
                const newNote = {
                    type: convertExternalToNoteType(noteData.noteType) || 'tab',
                    beat: targetBeat !== null ? targetBeat : (noteData.beat || 0),
                    direction: noteData.direction || "none",
                    isLong: noteData.isLong || false,
                    longTime: noteData.longTimeBeat || 0,
                    bpm: noteData.bpm || currentBpm,
                    subdivisions: noteData.subdivisions || currentSubdivisions
                };

                // Node 타입의 경우 wait 필드 추가
                if (newNote.type === "node") {
                    newNote.wait = noteData.isWait || false;
                }

                notes.push(newNote);
                pastedNoteCount++;
            }
        }

        if (pastedEventCount > 0 || pastedNoteCount > 0) {
            if (pastedEventCount > 0) {
                scheduleRender({ eventList: true });
            }
            if (pastedNoteCount > 0) {
                renderNoteList();
            }

            console.log(`붙여넣기 완료: 이벤트 ${pastedEventCount}개, 노트 ${pastedNoteCount}개`);
            showNotification(`붙여넣기 완료: 이벤트 ${pastedEventCount}개, 노트 ${pastedNoteCount}개`);
        } else {
            console.log('붙여넣을 데이터가 없습니다.');
        }

    } catch (error) {
        console.error('붙여넣기 중 오류:', error);
        showNotification('붙여넣기 중 오류가 발생했습니다.');
    }
}

// 알림 표시 함수 (간단한 구현)
function showNotification(message) {
    // 기존 알림이 있으면 제거
    const existingNotification = document.getElementById('copy-paste-notification');
    if (existingNotification) {
        existingNotification.remove();
    }

    // 새 알림 생성
    const notification = document.createElement('div');
    notification.id = 'copy-paste-notification';
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #333;
        color: white;
        padding: 10px 15px;
        border-radius: 5px;
        z-index: 10000;
        font-size: 14px;
        transition: opacity 0.3s;
    `;

    document.body.appendChild(notification);

    // 3초 후 자동 제거
    setTimeout(() => {
        notification.style.opacity = '0';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 3000);
}