// 모듈 임포트
import { exportChartSVG } from './export-svg.js';

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
    normalizeDirection,
    calculateFadeProgress,
    calculateSectionOffsets,
    recomputeSectionIndices
} from './utils.js';

import {
    drawCircle,
    drawText,
    drawDirectionArrow,
    drawTriangle,
    processLongNote,
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
    getEventTypeDescription,
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
    updateMultipleEvents,
    isDialogEvent,
    addDialogItem,
    removeDialogItem,
    moveDialogItem,
    updateDialogItem,
    getDialogItemTypes,
    getDialogItemFields,
    createDialogItem
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
    canvas: false
};

// Virtual Scrolling 상태
let virtualScrollState = {
    // NoteList용
    note: {
        scrollTop: 0,
        itemHeight: 35, // 각 행의 높이 (픽셀)
        visibleCount: 50, // 화면에 보이는 항목 수
        bufferCount: 10 // 위아래 버퍼 항목 수
    },
    // EventList용
    event: {
        scrollTop: 0,
        containerHeight: 0,
        itemHeight: 120, // 기본 아이템 높이 (동적으로 조정됨)
        overscan: 5, // 버퍼로 추가 렌더링할 아이템 수
        renderedRange: { start: 0, end: 0 },
        itemHeights: new Map(), // 각 아이템의 실제 높이 캐싱
        enabled: false // 가상 스크롤링 활성화 여부
    }
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

// 배경 레이어 캐시 (그리드, 경로, 마커)
let backgroundCache = {
    lastZoom: null,
    lastViewOffsetX: null,
    lastViewOffsetY: null,
    lastNotesHash: null,
    lastBpm: null,
    lastSubdivisions: null,
    lastPreDelaySeconds: null,
    lastRealtimeDrawingEnabled: null,
    lastIsPlaying: null,
    lastDrawTime: null
};

// 구간(Section) 오프셋 캐시 - notes 배열과 1:1 대응
let noteSectionOffsets = [];

// 구간 오프셋 lazy 계산 (notes 변경 시 자동 무효화)
function getOrComputeSectionOffsets() {
    if (noteSectionOffsets.length !== notes.length) {
        const bpm = parseFloat(document.getElementById("bpm").value || 120);
        const subdivisions = parseInt(document.getElementById("subdivisions").value || 16);
        noteSectionOffsets = calculateSectionOffsets(notes, bpm, subdivisions);
    }
    return noteSectionOffsets;
}

// direction/node 계열 노트를 _sectionOffset 첨부 후 절대시간 순으로 반환
// (경로 계산, 위치 조회 등 공통으로 사용)
function getDirectionNotesWithOffsets(bpmVal, subsVal) {
    const offsets = getOrComputeSectionOffsets();
    return notes
        .map((n, i) => ({ ...n, _sectionOffset: offsets[i] }))
        .filter(n =>
            n.type === "direction" ||
            n.type === "both" ||
            n.type === "longdirection" ||
            n.type === "longboth" ||
            n.type === "node"
        )
        .sort((a, b) => {
            const aTime = (a._sectionOffset || 0) + beatToTime(a.beat, a.bpm || bpmVal, a.subdivisions || subsVal);
            const bTime = (b._sectionOffset || 0) + beatToTime(b.beat, b.bpm || bpmVal, b.subdivisions || subsVal);
            return aTime - bTime;
        });
}

// 캐시 무효화 함수
function invalidatePathCache() {
    pathCache.pathDirectionNotes = null;
    pathCache.nodePositions = null;
    pathCache.segmentTimes = null;
    pathCache.lastNotesHash = null;
    noteSectionOffsets = []; // 구간 오프셋도 함께 무효화
    // 배열 순서 기준으로 sectionIndex 재계산
    recomputeSectionIndices(notes);
}

// 배경 캐시 무효화
function invalidateBackgroundCache() {
    backgroundCache.lastZoom = null;
    backgroundCache.lastViewOffsetX = null;
    backgroundCache.lastViewOffsetY = null;
    backgroundCache.lastNotesHash = null;
}

// 노트 배열 해시 생성 (변경 감지용)
function generateNotesHash(notes, bpm, subdivisions, preDelaySeconds) {
    const noteString = notes.map(n =>
        `${n.beat}-${n.type}-${n.direction}-${n.bpm || bpm}-${n.subdivisions || subdivisions}`
    ).join('|');
    return `${noteString}-${bpm}-${subdivisions}-${preDelaySeconds}`;
}

// pathDirectionNotes 계산 함수 (_sectionOffset 지원)
function calculatePathDirectionNotes(directionNotes, bpm, subdivisions, preDelaySeconds) {
    return directionNotes.map((note, index) => {
        const pathBeat = calculatePathBeat(note, preDelaySeconds, bpm, subdivisions);
        const sectionOffset = note._sectionOffset || 0;
        let finalTime;
        if (note.beat === 0 && note.type === "direction" && sectionOffset === 0) {
            finalTime = 0;
        } else {
            const noteBpm = note.bpm || bpm;
            const noteSubdivisions = note.subdivisions || subdivisions;
            const originalTime = sectionOffset + beatToTime(note.beat, noteBpm, noteSubdivisions);
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
function drawPathSegments(targetCtx, pathDirectionNotes, nodePositions, segmentTimes, realtimeDrawingEnabled, isPlaying, drawTime) {
    if (nodePositions.length === 0) return;

    targetCtx.beginPath();
    targetCtx.moveTo(nodePositions[0].x * zoom + viewOffset.x, nodePositions[0].y * zoom + viewOffset.y);

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
            targetCtx.lineTo(nextPos.x * zoom + viewOffset.x, nextPos.y * zoom + viewOffset.y);
        } else if (realtimeDrawingEnabled && isPlaying && segment.start <= drawTime && segment.end > drawTime) {
            // 부분적으로 그리기 (선형 보간)
            const segmentProgress = (drawTime - segment.start) / (segment.end - segment.start);
            const partialNext = {
                x: currentPos.x + (nextPos.x - currentPos.x) * segmentProgress,
                y: currentPos.y + (nextPos.y - currentPos.y) * segmentProgress
            };
            targetCtx.lineTo(partialNext.x * zoom + viewOffset.x, partialNext.y * zoom + viewOffset.y);
        } else if (!realtimeDrawingEnabled || !isPlaying) {
            // 전체 경로 그리기
            targetCtx.lineTo(nextPos.x * zoom + viewOffset.x, nextPos.y * zoom + viewOffset.y);
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
    const renderOffsets = getOrComputeSectionOffsets();

    for (let index = 0; index < notes.length; index++) {
        const note = notes[index];
        if (!note) continue;
        const sectionOffset = renderOffsets[index] || 0;
        // beat=0이면서 구간 시작(sectionOffset=0)인 경우 초기 direction 노트만 허용
        if (note.beat === 0 && sectionOffset === 0 && !(index === 0 && note.type === "direction")) continue;

        // 노트의 실제 시간 계산
        let noteTime, finalTime;
        if (note.beat === 0 && note.type === "direction" && sectionOffset === 0) {
            noteTime = preDelaySeconds;
            finalTime = 0;
        } else if ((note.type === "tab" || note.type === "longtab") &&
                   note.hasOwnProperty('fadeDirectTime')) {
            // fade 구간의 tab/longtab 노트는 저장된 직접 시간값 사용
            // fadeDirectTime은 이미 finalTime이므로 그대로 사용
            noteTime = note.fadeDirectTime;
            finalTime = note.fadeDirectTime;
        } else {
            const noteBpm = note.bpm || bpm;
            const noteSubdivisions = note.subdivisions || subdivisions;
            const originalTime = sectionOffset + beatToTime(note.beat, noteBpm, noteSubdivisions);
            noteTime = originalTime + preDelaySeconds;
            finalTime = originalTime + preDelaySeconds;
        }

        // 실시간 그리기: 그리기 오브젝트가 지나간 노트만 표시
        if (realtimeDrawingEnabled && isPlaying && noteTime > drawTime) {
            continue;
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
    // OffscreenCanvas 사용 시도
    let targetCtx = ctx;
    let useOffscreen = false;

    if (offscreenSupported && notesToRender.length > 100) {
        // 노트가 많을 때만 OffscreenCanvas 사용
        try {
            if (!notesOffscreenCanvas || notesOffscreenCanvas.width !== canvas.width || notesOffscreenCanvas.height !== canvas.height) {
                notesOffscreenCanvas = new OffscreenCanvas(canvas.width, canvas.height);
                notesOffscreenCtx = notesOffscreenCanvas.getContext('2d');
            }
            notesOffscreenCtx.clearRect(0, 0, notesOffscreenCanvas.width, notesOffscreenCanvas.height);
            targetCtx = notesOffscreenCtx;
            useOffscreen = true;
        } catch (e) {
            // Offscreen 실패 시 폴백
            console.warn('OffscreenCanvas fallback:', e);
            targetCtx = ctx;
            useOffscreen = false;
        }
    }

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
    // 롱노트는 복잡한 구조로 인해 ctx를 직접 사용 (추후 개선 가능)
    const originalCtx = ctx;
    if (useOffscreen && targetCtx !== ctx) {
        // OffscreenCanvas를 사용 중이면 임시로 전역 ctx를 교체
        window.tempCtx = ctx;
        window.ctx = targetCtx;
    }

    renderLongNotes(notesByType.longtab, notesByType.longdirection, notesByType.longboth, pathDirectionNotes, nodePositions, bpm, subdivisions);
    renderTabNotes(notesByType.tab, targetCtx);
    renderDirectionNotes(notesByType.direction, targetCtx);
    renderBothNotes(notesByType.both, targetCtx);
    renderNodeNotes(notesByType.node, bpm, targetCtx);

    if (useOffscreen && window.tempCtx) {
        // 전역 ctx 복원
        window.ctx = window.tempCtx;
        delete window.tempCtx;
    }

    // OffscreenCanvas를 사용한 경우 메인 캔버스로 전송
    if (useOffscreen && notesOffscreenCanvas) {
        ctx.drawImage(notesOffscreenCanvas, 0, 0);
    }
}

// 탭 노트 배치 렌더링 (배치 최적화)
function renderTabNotes(tabNotes, targetCtx = ctx) {
    if (tabNotes.length === 0) return;

    // 성능 최적화: 노트를 색상별로 그룹화하여 배치 렌더링
    const redNotes = [];
    const normalNotes = [];

    tabNotes.forEach(({ note, screenX, screenY }) => {
        if (note.beat === 0 && note.type === "direction") {
            redNotes.push({ screenX, screenY });
        } else {
            normalNotes.push({ screenX, screenY });
        }
    });

    // 빨간 노트들을 한 번에 렌더링
    if (redNotes.length > 0) {
        targetCtx.fillStyle = "red";
        targetCtx.beginPath();
        redNotes.forEach(({ screenX, screenY }) => {
            targetCtx.moveTo(screenX + 5, screenY);
            targetCtx.arc(screenX, screenY, 5, 0, 2 * Math.PI);
        });
        targetCtx.fill();
    }

    // 일반 노트들을 한 번에 렌더링
    if (normalNotes.length > 0) {
        targetCtx.fillStyle = "#FF6B6B";
        targetCtx.strokeStyle = "#4CAF50";
        targetCtx.lineWidth = 2;

        // Fill 패스
        targetCtx.beginPath();
        normalNotes.forEach(({ screenX, screenY }) => {
            targetCtx.moveTo(screenX + 5, screenY);
            targetCtx.arc(screenX, screenY, 5, 0, 2 * Math.PI);
        });
        targetCtx.fill();

        // Stroke 패스
        targetCtx.beginPath();
        normalNotes.forEach(({ screenX, screenY }) => {
            targetCtx.moveTo(screenX + 5, screenY);
            targetCtx.arc(screenX, screenY, 5, 0, 2 * Math.PI);
        });
        targetCtx.stroke();
    }
}

// 방향 노트 배치 렌더링
function renderDirectionNotes(directionNotes, targetCtx = ctx) {
    if (directionNotes.length === 0) return;

    targetCtx.lineWidth = 2;

    directionNotes.forEach(({ note, screenX, screenY }) => {
        const [dx, dy] = directionToVector(note.direction);
        const mag = Math.hypot(dx, dy) || 1;
        const ux = (dx / mag) * 16;
        const uy = (dy / mag) * 16;
        const endX = screenX + ux;
        const endY = screenY + uy;

        // 화살표 선 그리기
        targetCtx.beginPath();
        targetCtx.moveTo(screenX, screenY);
        targetCtx.lineTo(endX, endY);

        if (note.beat === 0) {
            targetCtx.strokeStyle = "#f00";
            targetCtx.fillStyle = "#f00";
        } else {
            targetCtx.strokeStyle = "#4CAF50";
            targetCtx.fillStyle = "#4CAF50";
        }
        targetCtx.stroke();

        // 화살표 머리 그리기
        const perpX = -uy * 0.5;
        const perpY = ux * 0.5;
        targetCtx.beginPath();
        targetCtx.moveTo(endX, endY);
        targetCtx.lineTo(endX - ux * 0.4 + perpX, endY - uy * 0.4 + perpY);
        targetCtx.lineTo(endX - ux * 0.4 - perpX, endY - uy * 0.4 - perpY);
        targetCtx.closePath();
        targetCtx.fill();
    });
}

// both 노트 배치 렌더링
function renderBothNotes(bothNotes, targetCtx = ctx) {
    if (bothNotes.length === 0) return;

    targetCtx.fillStyle = "#9C27B0";
    targetCtx.strokeStyle = "#4A148C";
    targetCtx.lineWidth = 2;

    bothNotes.forEach(({ note, screenX, screenY }) => {
        // 원 그리기
        targetCtx.beginPath();
        targetCtx.arc(screenX, screenY, 5, 0, 2 * Math.PI);
        targetCtx.fill();
        targetCtx.stroke();

        // 방향 화살표 그리기
        const [dx, dy] = directionToVector(note.direction);
        const mag = Math.hypot(dx, dy) || 1;
        const ux = (dx / mag) * 16;
        const uy = (dy / mag) * 16;
        const endX = screenX + ux;
        const endY = screenY + uy;

        targetCtx.beginPath();
        targetCtx.moveTo(screenX, screenY);
        targetCtx.lineTo(endX, endY);
        targetCtx.strokeStyle = "#9C27B0";
        targetCtx.stroke();

        const perpX = -uy * 0.5;
        const perpY = ux * 0.5;
        targetCtx.beginPath();
        targetCtx.moveTo(endX, endY);
        targetCtx.lineTo(endX - ux * 0.4 + perpX, endY - uy * 0.4 + perpY);
        targetCtx.lineTo(endX - ux * 0.4 - perpX, endY - uy * 0.4 - perpY);
        targetCtx.closePath();
        targetCtx.fillStyle = "#9C27B0";
        targetCtx.fill();
    });
}

// 노드 노트 배치 렌더링
function renderNodeNotes(nodeNotes, bpm, targetCtx = ctx) {
    if (nodeNotes.length === 0) return;

    targetCtx.fillStyle = "#607D8B";
    targetCtx.strokeStyle = "#263238";
    targetCtx.lineWidth = 2;

    nodeNotes.forEach(({ note, screenX, screenY }) => {
        const nodeDisplayY = screenY - 30;

        targetCtx.beginPath();
        targetCtx.arc(screenX, nodeDisplayY, 6, 0, 2 * Math.PI);
        targetCtx.fill();
        targetCtx.stroke();

        // BPM 텍스트 표시
        targetCtx.fillStyle = "white";
        targetCtx.font = "bold 8px Arial";
        targetCtx.textAlign = "center";
        targetCtx.textBaseline = "middle";
        const noteBpm = note.bpm || bpm;
        targetCtx.fillText(noteBpm.toString(), screenX, nodeDisplayY);

        // 연결선 그리기
        targetCtx.beginPath();
        targetCtx.moveTo(screenX, nodeDisplayY + 6);
        targetCtx.lineTo(screenX, screenY - 3);
        targetCtx.strokeStyle = "rgba(96, 125, 139, 0.5)";
        targetCtx.lineWidth = 1;
        targetCtx.stroke();
    });
}

// 롱노트 배치 렌더링
function renderLongNotes(longTabNotes, longDirectionNotes, longBothNotes, pathDirectionNotes, nodePositions, bpm, subdivisions, targetCtx = ctx) {
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
        fade: note.fade || false,
        wait: note.wait || false,
        beatReset: note.beatReset || false
    }));

    // 현재 events 배열의 깊은 복사본을 생성
    const currentEventsState = getAllEvents().map(event => {
        const eventCopy = {
            eventType: event.eventType,
            eventId: event.eventId,
            eventTime: event.eventTime,
            eventParams: event.eventParams.map(param => ({
                paramName: param.paramName,
                paramValue: param.paramValue
            }))
        };

        // dialogItems도 복사 (System-dialog 이벤트용)
        if (event.dialogItems && Array.isArray(event.dialogItems)) {
            eventCopy.dialogItems = event.dialogItems.map(item => ({
                ...item  // 모든 필드 복사 (type, text, speaker, character, emotion, animation 등)
            }));
        }

        return eventCopy;
    });

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
        fade: note.fade || false,
        wait: note.wait || false,
        beatReset: note.beatReset || false
    }));

    const currentEventsState = getAllEvents().map(event => {
        const eventCopy = {
            eventType: event.eventType,
            eventId: event.eventId,
            eventTime: event.eventTime,
            eventParams: event.eventParams.map(param => ({
                paramName: param.paramName,
                paramValue: param.paramValue
            }))
        };

        // dialogItems도 복사 (System-dialog 이벤트용)
        if (event.dialogItems && Array.isArray(event.dialogItems)) {
            eventCopy.dialogItems = event.dialogItems.map(item => ({
                ...item
            }));
        }

        return eventCopy;
    });

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
        fade: note.fade || false,
        wait: note.wait || false,
        beatReset: note.beatReset || false
    }));

    const currentEventsState = getAllEvents().map(event => {
        const eventCopy = {
            eventType: event.eventType,
            eventId: event.eventId,
            eventTime: event.eventTime,
            eventParams: event.eventParams.map(param => ({
                paramName: param.paramName,
                paramValue: param.paramValue
            }))
        };

        // dialogItems도 복사 (System-dialog 이벤트용)
        if (event.dialogItems && Array.isArray(event.dialogItems)) {
            eventCopy.dialogItems = event.dialogItems.map(item => ({
                ...item
            }));
        }

        return eventCopy;
    });

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
// Canvas layers
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const backgroundCanvas = document.getElementById("background-canvas");
const backgroundCtx = backgroundCanvas.getContext("2d");

const rulerCanvas = document.getElementById("ruler-canvas");
const rulerCtx = rulerCanvas ? rulerCanvas.getContext("2d") : null;

// OffscreenCanvas support detection and fallback
let offscreenSupported = false;
let notesOffscreenCanvas = null;
let notesOffscreenCtx = null;

try {
    if (typeof OffscreenCanvas !== 'undefined') {
        offscreenSupported = true;
        console.log('OffscreenCanvas is supported');
    } else {
        console.log('OffscreenCanvas not supported, using fallback');
    }
} catch (e) {
    console.log('OffscreenCanvas detection failed, using fallback');
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
        backgroundCanvas.width = currentWidth;
        backgroundCanvas.height = currentHeight;
        lastCanvasWidth = currentWidth;
        lastCanvasHeight = currentHeight;

        // OffscreenCanvas 크기도 조정
        if (offscreenSupported && notesOffscreenCanvas) {
            notesOffscreenCanvas.width = currentWidth;
            notesOffscreenCanvas.height = currentHeight;
        }

        return true; // 리사이즈 발생
    }
    return false; // 리사이즈 없음
}

function drawGrid(targetCtx, targetCanvas) {
    // 줌이 너무 작으면 그리드 생략 (성능 최적화)
    const MIN_ZOOM_FOR_GRID = 0.5;
    if (zoom < MIN_ZOOM_FOR_GRID) return;

    const gridSize = 8;
    const startX = Math.floor(-viewOffset.x / zoom / gridSize) - 1;
    const endX = Math.ceil((targetCanvas.width - viewOffset.x) / zoom / gridSize) + 1;
    const startY = Math.floor(-viewOffset.y / zoom / gridSize) - 1;
    const endY = Math.ceil((targetCanvas.height - viewOffset.y) / zoom / gridSize) + 1;

    // 성능 최적화: 모든 그리드 선을 한 번에 그리기
    targetCtx.strokeStyle = "rgba(150, 150, 150, 0.2)";
    targetCtx.lineWidth = 1;
    targetCtx.beginPath();

    // 수직선들 한 번에 그리기
    for (let i = startX; i <= endX; i++) {
        const x = i * gridSize * zoom + viewOffset.x;
        targetCtx.moveTo(x, 0);
        targetCtx.lineTo(x, targetCanvas.height);
    }

    // 수평선들 한 번에 그리기
    for (let j = startY; j <= endY; j++) {
        const y = j * gridSize * zoom + viewOffset.y;
        targetCtx.moveTo(0, y);
        targetCtx.lineTo(targetCanvas.width, y);
    }

    targetCtx.stroke();
}

// 배경 레이어 렌더링 (그리드, 경로, 마커)
function drawBackground(pathDirectionNotes, nodePositions, segmentTimes, bpm, subdivisions, realtimeDrawingEnabled, isPlaying, drawTime) {
    // 배경 캔버스 클리어
    backgroundCtx.clearRect(0, 0, backgroundCanvas.width, backgroundCanvas.height);

    // 그리드 그리기
    drawGrid(backgroundCtx, backgroundCanvas);

    // 경로 그리기
    drawPathSegments(backgroundCtx, pathDirectionNotes, nodePositions, segmentTimes, realtimeDrawingEnabled, isPlaying, drawTime);

    // 그려진 경로 표시
    backgroundCtx.strokeStyle = "#000";
    backgroundCtx.lineWidth = 2;
    backgroundCtx.stroke();

    // 시간 기준 마커 (1초 간격)
    const MIN_ZOOM_FOR_TIME_MARKERS = 2.5;
    if (zoom >= MIN_ZOOM_FOR_TIME_MARKERS) {
        const totalPathTime = pathDirectionNotes[pathDirectionNotes.length - 1]?.finalTime || 0;
        const maxMarkerTime = (realtimeDrawingEnabled && isPlaying) ? Math.min(totalPathTime, drawTime) : totalPathTime;

        const timeMarkers = [];
        for (let time = 1; time < maxMarkerTime; time += 1) {
            const position = getPositionAtTime(time, segmentTimes);
            if (position) {
                const screenX = position.x * zoom + viewOffset.x;
                const screenY = position.y * zoom + viewOffset.y;
                if (isNoteInViewport(screenX, screenY)) {
                    timeMarkers.push({ screenX, screenY });
                }
            }
        }

        if (timeMarkers.length > 0) {
            backgroundCtx.fillStyle = "rgba(128,128,128,0.4)";
            backgroundCtx.beginPath();
            timeMarkers.forEach(({ screenX, screenY }) => {
                backgroundCtx.moveTo(screenX + 4, screenY);
                backgroundCtx.arc(screenX, screenY, 4, 0, 2 * Math.PI);
            });
            backgroundCtx.fill();
        }
    }

    // BPM 기반 비트 마커
    const MIN_ZOOM_FOR_BEAT_MARKERS = 3.75;
    if (zoom >= MIN_ZOOM_FOR_BEAT_MARKERS) {
        for (let i = 0; i < pathDirectionNotes.length - 1; i++) {
            const a = pathDirectionNotes[i];
            const b = pathDirectionNotes[i + 1];
            const segmentBpm = a.bpm || bpm;
            const segmentSubdivisions = a.subdivisions || subdivisions;
            const beatInterval = beatToTime(1, segmentBpm, segmentSubdivisions);
            const maxMarkerTime = (realtimeDrawingEnabled && isPlaying) ? drawTime : (pathDirectionNotes[pathDirectionNotes.length - 1]?.finalTime || 0);

            const beatMarkers = [];
            for (let time = a.finalTime + beatInterval; time < b.finalTime && time <= maxMarkerTime; time += beatInterval) {
                const position = getPositionAtTime(time, segmentTimes);
                if (position) {
                    const screenX = position.x * zoom + viewOffset.x;
                    const screenY = position.y * zoom + viewOffset.y;
                    if (isNoteInViewport(screenX, screenY)) {
                        beatMarkers.push({ screenX, screenY });
                    }
                }
            }

            if (beatMarkers.length > 0) {
                backgroundCtx.fillStyle = "rgba(100,150,255,0.6)";
                backgroundCtx.beginPath();
                beatMarkers.forEach(({ screenX, screenY }) => {
                    backgroundCtx.moveTo(screenX + 2, screenY);
                    backgroundCtx.arc(screenX, screenY, 2, 0, 2 * Math.PI);
                });
                backgroundCtx.fill();
            }
        }
    }
}

function drawPath() {
    const startTime = performance.now();

    resizeCanvas();

    ensureInitialDirectionNote(notes);

    const preDelaySeconds = getPreDelaySeconds();
    const bpm = parseFloat(document.getElementById("bpm").value || 120);
    const subdivisions = parseInt(document.getElementById("subdivisions").value || 16);

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
        // 캐시 미스 - 새로 계산 (_sectionOffset 첨부된 direction 노트 사용)
        const directionNotes = getDirectionNotesWithOffsets(bpm, subdivisions);

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

    // 배경 레이어 업데이트 확인 (변경사항이 있을 때만 다시 그리기)
    const needsBackgroundRedraw =
        backgroundCache.lastZoom !== zoom ||
        backgroundCache.lastViewOffsetX !== viewOffset.x ||
        backgroundCache.lastViewOffsetY !== viewOffset.y ||
        backgroundCache.lastNotesHash !== currentNotesHash ||
        backgroundCache.lastBpm !== bpm ||
        backgroundCache.lastSubdivisions !== subdivisions ||
        backgroundCache.lastPreDelaySeconds !== preDelaySeconds ||
        backgroundCache.lastRealtimeDrawingEnabled !== realtimeDrawingEnabled ||
        backgroundCache.lastIsPlaying !== isPlaying ||
        (realtimeDrawingEnabled && isPlaying && Math.abs(backgroundCache.lastDrawTime - drawTime) > 0.1);

    if (needsBackgroundRedraw) {
        drawBackground(pathDirectionNotes, nodePositions, segmentTimes, bpm, subdivisions, realtimeDrawingEnabled, isPlaying, drawTime);

        // 배경 캐시 업데이트
        backgroundCache.lastZoom = zoom;
        backgroundCache.lastViewOffsetX = viewOffset.x;
        backgroundCache.lastViewOffsetY = viewOffset.y;
        backgroundCache.lastNotesHash = currentNotesHash;
        backgroundCache.lastBpm = bpm;
        backgroundCache.lastSubdivisions = subdivisions;
        backgroundCache.lastPreDelaySeconds = preDelaySeconds;
        backgroundCache.lastRealtimeDrawingEnabled = realtimeDrawingEnabled;
        backgroundCache.lastIsPlaying = isPlaying;
        backgroundCache.lastDrawTime = drawTime;
    }

    // 전경 레이어 클리어 (매 프레임)
    ctx.clearRect(0, 0, canvas.width, canvas.height);

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
        let noteFinalTime;
        const highlightSectionOffset = getOrComputeSectionOffsets()[highlightedNoteIndex] || 0;
        if (note.beat === 0 && note.type === "direction" && highlightSectionOffset === 0) {
            noteFinalTime = 0;
        } else if ((note.type === "tab" || note.type === "longtab") &&
                   note.hasOwnProperty('fadeDirectTime')) {
            noteFinalTime = note.fadeDirectTime;
        } else {
            const noteBpm = note.bpm || parseFloat(document.getElementById("bpm").value || 120);
            const noteSubdivisions = note.subdivisions || parseInt(document.getElementById("subdivisions").value || 16);
            noteFinalTime = highlightSectionOffset + beatToTime(note.beat, noteBpm, noteSubdivisions) + preDelaySeconds;
        }

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
        let noteFinalTime;
        const selectedSectionOffset = getOrComputeSectionOffsets()[selectedNoteIndex] || 0;
        if (note.beat === 0 && note.type === "direction" && selectedSectionOffset === 0) {
            noteFinalTime = 0;
        } else if ((note.type === "tab" || note.type === "longtab") &&
                   note.hasOwnProperty('fadeDirectTime')) {
            noteFinalTime = note.fadeDirectTime;
        } else {
            const noteBpm = note.bpm || parseFloat(document.getElementById("bpm").value || 120);
            const noteSubdivisions = note.subdivisions || parseInt(document.getElementById("subdivisions").value || 16);
            noteFinalTime = selectedSectionOffset + beatToTime(note.beat, noteBpm, noteSubdivisions) + preDelaySeconds;
        }

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
    const fromBpm = fromNote.bpm || globalBpm;
    const toBpm = toNote.bpm || globalBpm;

    // Unity TrackGenerator 로직과 동일하게 처리
    // fade가 활성화되고 BPM이 변하면 평균 BPM 사용
    // 그 외에는 toBpm 사용 (기존 방식)
    let effectiveBpm;
    const toFade = toNote.fade || false;

    if (toFade && Math.abs(fromBpm - toBpm) > 0.01) {
        // fade가 활성화되면 평균 BPM 사용 (적분의 근사치)
        effectiveBpm = (fromBpm + toBpm) / 2;
    } else {
        // fade가 없으면 기존 방식 (목표 BPM 사용)
        effectiveBpm = toBpm;
    }

    // Unity 공식 적용: multiplierConstant = 0.4 × 배속
    // 속도 = multiplierConstant × BPM
    const multiplierConstant = 0.4 * speedMultiplier;
    return multiplierConstant * effectiveBpm;
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



function processAudioFile(audioFile) {
    console.log('Processing audio file:', audioFile.name);

    hasAudioFile = true;
    savedAudioFile = audioFile;

    saveAudioFile(audioFile).catch(err => {
        console.warn('Failed to save audio to IndexedDB:', err);
    });

    // Audio duration detection
    const audio = new Audio();
    const url = URL.createObjectURL(audioFile);
    audio.src = url;

    audio.addEventListener('loadedmetadata', () => {
        console.log('Audio metadata loaded, duration:', audio.duration);
        audioBuffer = { duration: audio.duration };
        saveToStorage();
        URL.revokeObjectURL(url);
    });

    audio.addEventListener('error', () => {
        console.error('Audio element failed');
        hasAudioFile = false;
        savedAudioFile = null;
        audioBuffer = null;
        URL.revokeObjectURL(url);
    });
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
    const hitOffsets = getOrComputeSectionOffsets();

    notes.forEach((note, index) => {
        const noteId = `${note.type}-${note.beat}-${index}`;

        if (playedNotes.has(noteId))
            return;

        const sectionOffset = hitOffsets[index] || 0;
        let finalTime;
        if (note.beat === 0 && note.type === "direction" && sectionOffset === 0) {
            finalTime = preDelaySeconds;
            if (currentTime >= finalTime - tolerance && currentTime <= finalTime + tolerance) {
                playedNotes.add(noteId);
                highlightNoteHit(index);
                console.log(`0번 노트 통과 (효과음 없음): beat ${note.beat}, finalTime ${finalTime.toFixed(3)}s, currentTime ${currentTime.toFixed(3)}s`);
            }
            return;
        } else if ((note.type === "tab" || note.type === "longtab") &&
                   note.hasOwnProperty('fadeDirectTime')) {
            // fade 구간의 tab/longtab 노트는 저장된 직접 시간값 사용
            finalTime = note.fadeDirectTime;
        } else {
            // 각 노트의 개별 BPM/subdivision 사용
            const noteBpm = note.bpm || bpm;
            const noteSubdivisions = note.subdivisions || subdivisions;
            const originalTime = sectionOffset + beatToTime(note.beat, noteBpm, noteSubdivisions);
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

// fade를 고려한 정확한 경로상 위치 계산 함수
function calculateExactPositionOnPath(targetTime, pathDirectionNotes, bpm, subdivisions) {
    if (pathDirectionNotes.length === 0) {
        return { x: 0, y: 0 };
    }

    // 시작 위치
    let currentPos = { x: 0, y: 0 };

    // targetTime이 첫 번째 노트 시간보다 이전인 경우 시작점에서 첫 번째 노트로 이동
    if (pathDirectionNotes.length > 1 && targetTime < pathDirectionNotes[1].finalTime) {
        const firstGameNote = pathDirectionNotes[1];
        const movementSpeed = calculateMovementSpeed(pathDirectionNotes[0], firstGameNote, bpm, subdivisions);
        const timeRatio = targetTime / firstGameNote.finalTime;

        // 첫 번째 노트까지의 거리와 방향
        const [dx, dy] = directionToVector(pathDirectionNotes[0].direction);
        const mag = Math.hypot(dx, dy) || 1;
        const totalDist = movementSpeed * firstGameNote.finalTime;

        // fade가 있는지 확인
        const firstFade = firstGameNote.fade || false;
        const firstBpm = pathDirectionNotes[0].bpm || bpm;
        const firstNoteBpm = firstGameNote.bpm || bpm;

        let t = timeRatio;
        if (firstFade && Math.abs(firstBpm - firstNoteBpm) > 0.01) {
            t = calculateFadeProgress(timeRatio, firstBpm, firstNoteBpm);
        }

        return {
            x: currentPos.x + (dx / mag) * totalDist * t,
            y: currentPos.y + (dy / mag) * totalDist * t
        };
    }

    // 마지막 노트 시간 후면 마지막 노트까지의 경로를 모두 계산
    if (targetTime >= pathDirectionNotes[pathDirectionNotes.length - 1].finalTime) {
        for (let i = 0; i < pathDirectionNotes.length - 1; i++) {
            const a = pathDirectionNotes[i];
            const b = pathDirectionNotes[i + 1];

            if (b.type === "node" && b.wait) {
                // wait 노트는 이동하지 않음
                continue;
            }

            const movementSpeed = calculateMovementSpeed(a, b, bpm, subdivisions);
            const dTime = b.finalTime - a.finalTime;

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
            const totalDist = movementSpeed * dTime;

            currentPos.x += (dx / mag) * totalDist;
            currentPos.y += (dy / mag) * totalDist;
        }
        return currentPos;
    }

    // targetTime이 특정 구간 내에 있는 경우
    for (let i = 0; i < pathDirectionNotes.length - 1; i++) {
        const a = pathDirectionNotes[i];
        const b = pathDirectionNotes[i + 1];

        // 이전 구간들을 모두 통과하여 현재 위치 계산
        if (targetTime > b.finalTime) {
            if (b.type === "node" && b.wait) {
                continue;
            }

            const movementSpeed = calculateMovementSpeed(a, b, bpm, subdivisions);
            const dTime = b.finalTime - a.finalTime;

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
            const totalDist = movementSpeed * dTime;

            currentPos.x += (dx / mag) * totalDist;
            currentPos.y += (dy / mag) * totalDist;
            continue;
        }

        // 현재 구간에 있는 경우
        if (a.finalTime <= targetTime && targetTime <= b.finalTime) {
            // wait 노트인 경우 이전 위치에서 대기
            if (b.type === "node" && b.wait) {
                if (targetTime >= a.finalTime && targetTime < b.finalTime) {
                    return currentPos; // 현재 위치에서 대기
                }
                continue;
            }

            const dTime = b.finalTime - a.finalTime;
            const timeRatio = (targetTime - a.finalTime) / dTime;

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

            const movementSpeed = calculateMovementSpeed(a, b, bpm, subdivisions);
            const [dx, dy] = directionToVector(direction);
            const mag = Math.hypot(dx, dy) || 1;
            const totalDist = movementSpeed * dTime;

            // fade를 고려한 진행도 계산
            let t = timeRatio;
            const bFade = b.fade || false;
            const aBpm = a.bpm || bpm;
            const bBpm = b.bpm || bpm;

            if (bFade && Math.abs(aBpm - bBpm) > 0.01) {
                t = calculateFadeProgress(timeRatio, aBpm, bBpm);
            }

            return {
                x: currentPos.x + (dx / mag) * totalDist * t,
                y: currentPos.y + (dy / mag) * totalDist * t
            };
        }
    }

    return currentPos;
}

function updateDemoPlayerPosition(currentTime) {
    const preDelaySeconds = getPreDelaySeconds();

    const bpm = parseFloat(document.getElementById("bpm").value || 120);
    const subdivisions = parseInt(document.getElementById("subdivisions").value || 16);

    const directionNotes = getDirectionNotesWithOffsets(bpm, subdivisions);

    const pathDirectionNotes = directionNotes.map((note, index) => {
        const pathBeat = calculatePathBeat(note, preDelaySeconds, bpm, subdivisions);
        const sectionOffset = note._sectionOffset || 0;
        let finalTime;
        if (note.beat === 0 && note.type === "direction" && sectionOffset === 0) {
            // beat 0 direction 노트는 실제 게임 시작점 (0초)
            finalTime = 0;
        } else {
            // 각 노트의 개별 BPM/subdivision 사용하여 finalTime 계산
            const noteBpm = note.bpm || bpm;
            const noteSubdivisions = note.subdivisions || subdivisions;
            const originalTime = sectionOffset + beatToTime(note.beat, noteBpm, noteSubdivisions);
            finalTime = originalTime + preDelaySeconds;
        }
        return {
            ...note,
            finalTime: finalTime,
            pathBeat: pathBeat
        };
    }).sort((a, b) => a.finalTime - b.finalTime);

    // 새로운 정확한 위치 계산 함수 사용
    const position = calculateExactPositionOnPath(currentTime, pathDirectionNotes, bpm, subdivisions);
    demoPlayer.x = position.x;
    demoPlayer.y = position.y;
}

function getNotePositionFromPathData(finalTime, pathDirectionNotes, nodePositions) {
    const bpm = parseFloat(document.getElementById("bpm").value || 120);

    for (let i = 0; i < pathDirectionNotes.length - 1; i++) {
        const a = pathDirectionNotes[i];
        const b = pathDirectionNotes[i + 1];
        const pa = nodePositions[i];
        const pb = nodePositions[i + 1];

        if (a.finalTime <= finalTime && finalTime <= b.finalTime) {
            // 시간 기반 진행도 계산
            let normalizedTime = (finalTime - a.finalTime) / (b.finalTime - a.finalTime);

            // fade를 고려한 실제 위치 진행도 계산
            let interp = normalizedTime;
            const bFade = b.fade || false;
            const aBpm = a.bpm || bpm;
            const bBpm = b.bpm || bpm;

            if (bFade && Math.abs(aBpm - bBpm) > 0.01) {
                // fade가 활성화되면 비선형 보간 (Unity StageUtils.GetPosition과 동일)
                interp = calculateFadeProgress(normalizedTime, aBpm, bBpm);
            }

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
                    // Fade 필드 초기화 (하위 호환성: number를 boolean으로 변환)
                    if (note.fade === undefined) {
                        note.fade = false;
                    } else if (typeof note.fade === 'number') {
                        note.fade = note.fade > 0;
                    }
                    // wait 필드 초기화 (Node 타입만)
                    if (note.type === "node" && note.wait === undefined) note.wait = false;
                    // beatReset 필드 초기화 (모든 타입)
                    if (note.beatReset === undefined) note.beatReset = false;
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
                    // Fade 필드 초기화 (하위 호환성: number를 boolean으로 변환)
                    if (note.fade === undefined) {
                        note.fade = false;
                    } else if (typeof note.fade === 'number') {
                        note.fade = note.fade > 0;
                    }
                    // wait 필드 초기화 (Node 타입만)
                    if (note.type === "node" && note.wait === undefined) note.wait = false;
                    // beatReset 필드 초기화 (모든 타입)
                    if (note.beatReset === undefined) note.beatReset = false;
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

                        processAudioFile(audioFile);
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

// Fade 시간을 계산 (이전 노트와 현재 노트의 시간 차이)
function calculateFadeDuration(noteIndex) {
    const globalBpm = parseFloat(document.getElementById("bpm").value || 120);

    // 현재 노트의 시간
    const currentTime = calculateNoteTime(noteIndex);

    // 이전 편집 가능 노트 찾기
    for (let i = noteIndex - 1; i >= 0; i--) {
        const prevNote = notes[i];
        const canEdit = ["direction", "longdirection", "both", "longboth", "node"].includes(prevNote.type);
        if (canEdit) {
            const prevTime = calculateNoteTime(i);
            return currentTime - prevTime;
        }
    }

    // 이전 노트가 없으면 현재 시간 자체가 fade 시간
    return currentTime;
}

// Fade 구간에서 시간으로부터 beat를 역산
// fadeStartTime부터 targetTime까지의 경과 시간을 고려하여 beat 계산
function timeToBeatInFade(targetTime, fadeStartTime, fadeEndTime, startBpm, endBpm, subdivisions) {
    const fadeDuration = fadeEndTime - fadeStartTime;

    if (targetTime <= fadeStartTime) {
        // fade 시작 전
        return targetTime * (startBpm / 60) * subdivisions;
    } else if (targetTime >= fadeEndTime) {
        // fade 종료 후
        const fadeStartBeat = fadeStartTime * (startBpm / 60) * subdivisions;
        const fadeBeat = fadeDuration * ((startBpm + endBpm) / 2 / 60) * subdivisions;
        const afterFadeDuration = targetTime - fadeEndTime;
        const afterFadeBeat = afterFadeDuration * (endBpm / 60) * subdivisions;
        return fadeStartBeat + fadeBeat + afterFadeBeat;
    } else {
        // fade 구간 내
        const beforeFadeBeat = fadeStartTime * (startBpm / 60) * subdivisions;
        const timeInFade = targetTime - fadeStartTime;

        // 적분을 사용한 beat 계산
        // v(t) = startBpm + (endBpm - startBpm) * (t / fadeDuration)
        // beat = ∫ v(t) / 60 * subdivisions dt
        // = subdivisions / 60 * [startBpm * t + (endBpm - startBpm) * t^2 / (2 * fadeDuration)]

        const t = timeInFade;
        const fadeBeats = (subdivisions / 60) * (
            startBpm * t +
            (endBpm - startBpm) * t * t / (2 * fadeDuration)
        );

        return beforeFadeBeat + fadeBeats;
    }
}

// Tab 노트가 fade 구간에 있는지 확인하고 fade 정보를 반환
function getTabNoteFadeInfo(note, index) {
    const globalBpm = parseFloat(document.getElementById("bpm").value || 120);
    const globalSubdivisions = parseInt(document.getElementById("subdivisions").value || 16);

    // 이전 편집 가능 노트 찾기
    let prevBpm = globalBpm;
    let prevIndex = -1;

    for (let i = index - 1; i >= 0; i--) {
        const prevNote = notes[i];
        const canEdit = ["direction", "longdirection", "both", "longboth", "node"].includes(prevNote.type);
        if (canEdit) {
            prevBpm = prevNote.bpm || globalBpm;
            prevIndex = i;
            break;
        }
    }

    // 다음 편집 가능 노트 찾기
    let nextBpm = globalBpm;
    let nextFade = false;
    let nextSubdivisions = globalSubdivisions;
    let nextIndex = -1;

    for (let i = index + 1; i < notes.length; i++) {
        const nextNote = notes[i];
        const canEdit = ["direction", "longdirection", "both", "longboth", "node"].includes(nextNote.type);
        if (canEdit) {
            nextBpm = nextNote.bpm || globalBpm;
            nextFade = nextNote.fade || false;
            nextSubdivisions = nextNote.subdivisions || globalSubdivisions;
            nextIndex = i;
            break;
        }
    }

    // fade 구간 확인
    if (nextFade && Math.abs(prevBpm - nextBpm) > 0.01 && nextIndex !== -1 && prevIndex !== -1) {
        const currentNote = notes[index];

        // fadeDirectTime이 이미 있는 노트는 항상 fade 구간에 있다고 판정
        if (currentNote.hasOwnProperty('fadeDirectTime')) {
            const prevTime = calculateNoteTime(prevIndex);
            const nextTime = calculateNoteTime(nextIndex);
            return {
                inFade: true,
                fadeStartTime: prevTime,
                fadeEndTime: nextTime,
                startBpm: prevBpm,
                endBpm: nextBpm,
                subdivisions: nextSubdivisions
            };
        }

        // fadeDirectTime이 없는 노트는 일반적인 방식으로 fade 구간 판정
        const noteTime = calculateNoteTime(index);
        const prevTime = calculateNoteTime(prevIndex);
        const nextTime = calculateNoteTime(nextIndex);
        const fadeStartTime = prevTime;
        const fadeEndTime = nextTime;

        if (noteTime >= fadeStartTime && noteTime <= fadeEndTime) {
            return {
                inFade: true,
                fadeStartTime: fadeStartTime,
                fadeEndTime: fadeEndTime,
                startBpm: prevBpm,
                endBpm: nextBpm,
                subdivisions: nextSubdivisions
            };
        }
    }

    return { inFade: false };
}

// Tab 노트의 정확한 시간을 계산 (모든 이전 노트의 BPM/fade 고려)
function calculateNoteTime(targetIndex) {
    const globalBpm = parseFloat(document.getElementById("bpm").value || 120);
    const globalSubdivisions = parseInt(document.getElementById("subdivisions").value || 16);

    const targetNote = notes[targetIndex];

    // fade 구간의 tab/longtab 노트이고 직접 시간값이 있으면 그것을 사용
    if ((targetNote.type === "tab" || targetNote.type === "longtab") &&
        targetNote.hasOwnProperty('fadeDirectTime')) {
        const preDelaySeconds = getPreDelaySeconds();
        return targetNote.fadeDirectTime - preDelaySeconds;
    }

    const targetBeat = targetNote.beat;

    // BPM 변경 지점들을 수집
    const bpmChanges = [];
    let currentBpm = globalBpm;
    let currentSubdivisions = globalSubdivisions;
    let prevBeat = 0;

    for (let i = 0; i <= targetIndex; i++) {
        const note = notes[i];
        const canEdit = ["direction", "longdirection", "both", "longboth", "node"].includes(note.type);

        if (canEdit && note.beat <= targetBeat) {
            bpmChanges.push({
                beat: note.beat,
                bpm: note.bpm || globalBpm,
                subdivisions: note.subdivisions || globalSubdivisions,
                fade: note.fade || false,
                prevBpm: currentBpm,
                prevSubdivisions: currentSubdivisions
            });
            currentBpm = note.bpm || globalBpm;
            currentSubdivisions = note.subdivisions || globalSubdivisions;
        }
    }

    // 시간 누적 계산
    let accumulatedTime = 0;
    let lastBeat = 0;
    let lastBpm = globalBpm;
    let lastSubdivisions = globalSubdivisions;

    for (let i = 0; i < bpmChanges.length; i++) {
        const change = bpmChanges[i];

        // 이전 구간의 시간 계산
        if (change.beat > lastBeat) {
            const beatDiff = change.beat - lastBeat;
            const time = beatToTime(beatDiff, lastBpm, lastSubdivisions);
            accumulatedTime += time;
        }

        lastBeat = change.beat;
        lastBpm = change.bpm;
        lastSubdivisions = change.subdivisions;
    }

    // 마지막 구간 (마지막 BPM 변경 지점부터 타겟까지)
    if (targetBeat > lastBeat) {
        const beatDiff = targetBeat - lastBeat;
        const time = beatToTime(beatDiff, lastBpm, lastSubdivisions);
        accumulatedTime += time;
    }

    return accumulatedTime;
}

// fade 구간에서 특정 시간의 BPM을 보간으로 계산
function calculateBpmAtTime(targetTime, fadeStartTime, fadeEndTime, startBpm, endBpm) {
    if (targetTime <= fadeStartTime) {
        return startBpm;
    } else if (targetTime >= fadeEndTime) {
        return endBpm;
    } else {
        // 선형 보간
        const fadeDuration = fadeEndTime - fadeStartTime;
        const timeInFade = targetTime - fadeStartTime;
        const fadeProgress = timeInFade / fadeDuration;
        return startBpm + (endBpm - startBpm) * fadeProgress;
    }
}

// fade 구간의 tab/longtab 노트의 beat, bpm, subdivision을 시간값에 기반하여 업데이트
function updateFadeNoteParameters(note, index, targetFinalTime, fadeInfo) {
    const preDelaySeconds = getPreDelaySeconds();
    const targetOriginalTime = targetFinalTime - preDelaySeconds;

    // fade 구간에서 해당 시간의 BPM 계산
    const interpolatedBpm = calculateBpmAtTime(
        targetOriginalTime,
        fadeInfo.fadeStartTime,
        fadeInfo.fadeEndTime,
        fadeInfo.startBpm,
        fadeInfo.endBpm
    );

    // fade 구간을 만든 노트의 subdivision 사용
    const targetSubdivisions = fadeInfo.subdivisions;

    // 해당 BPM과 subdivision으로 목표 시간이 나오게 하는 beat 값 역산
    const targetBeat = timeToBeat(targetOriginalTime, interpolatedBpm, targetSubdivisions);

    // float 정밀도로 반올림 (소수점 6자리까지)
    const roundedBeat = Math.round(targetBeat * 1000000) / 1000000;
    const roundedBpm = Math.round(interpolatedBpm * 1000000) / 1000000;

    // 노트 파라미터 업데이트
    note.beat = roundedBeat;
    note.bpm = roundedBpm;
    note.subdivisions = targetSubdivisions;
    note.fadeDirectTime = targetFinalTime;

    console.log(`Updated fade note: time=${targetFinalTime.toFixed(3)}s, beat=${roundedBeat}, bpm=${roundedBpm.toFixed(2)}, subdivisions=${targetSubdivisions}`);
}

// fade 구간에서 벗어난 노트들의 fadeDirectTime 제거
function cleanupFadeDirectTimes() {
    notes.forEach((note, index) => {
        if ((note.type === "tab" || note.type === "longtab") &&
            note.hasOwnProperty('fadeDirectTime')) {

            // 임시로 fadeDirectTime을 제거해서 원래 방식으로 fade 구간 판정
            const tempFadeDirectTime = note.fadeDirectTime;
            delete note.fadeDirectTime;

            const fadeInfo = getTabNoteFadeInfo(note, index);

            if (fadeInfo.inFade) {
                // 여전히 fade 구간에 있으면 fadeDirectTime 복원
                note.fadeDirectTime = tempFadeDirectTime;
            }
            // fade 구간에서 벗어났으면 fadeDirectTime은 제거된 상태로 유지
        }
    });
}

// Tab 노트들의 BPM/Subdivisions 값을 다음 편집 가능 노트에서 상속받도록 업데이트
function updateTabNotesInheritance() {
    const globalBpm = parseFloat(document.getElementById("bpm").value || 120);
    const globalSubdivisions = parseInt(document.getElementById("subdivisions").value || 16);

    notes.forEach((note, index) => {
        // Tab 계열 노트만 처리 (fade 구간의 직접 시간값이 있는 노트는 제외)
        if ((note.type === "tab" || note.type === "longtab") &&
            !note.hasOwnProperty('fadeDirectTime')) {
            // 이전 편집 가능 노트 찾기
            let prevBpm = globalBpm;
            let prevSubdivisions = globalSubdivisions;
            let prevIndex = -1;

            for (let i = index - 1; i >= 0; i--) {
                const prevNote = notes[i];
                const canEdit = ["direction", "longdirection", "both", "longboth", "node"].includes(prevNote.type);
                if (canEdit) {
                    prevBpm = prevNote.bpm || globalBpm;
                    prevSubdivisions = prevNote.subdivisions || globalSubdivisions;
                    prevIndex = i;
                    break;
                }
            }

            // 다음 편집 가능 노트 찾기
            let nextBpm = globalBpm;
            let nextSubdivisions = globalSubdivisions;
            let nextFade = false;
            let nextIndex = -1;

            for (let i = index + 1; i < notes.length; i++) {
                const nextNote = notes[i];
                const canEdit = ["direction", "longdirection", "both", "longboth", "node"].includes(nextNote.type);
                if (canEdit) {
                    nextBpm = nextNote.bpm || globalBpm;
                    nextSubdivisions = nextNote.subdivisions || globalSubdivisions;
                    nextFade = nextNote.fade || false;
                    nextIndex = i;
                    break;
                }
            }

            // Tab 노트의 정확한 시간 계산
            const noteTime = calculateNoteTime(index);

            let inheritedBpm = nextBpm;
            let inheritedSubdivisions = nextSubdivisions;

            // fade가 있고 BPM이 다르면 보간 계산
            if (nextFade && Math.abs(prevBpm - nextBpm) > 0.01 && nextIndex !== -1 && prevIndex !== -1) {
                const prevTime = calculateNoteTime(prevIndex);
                const nextTime = calculateNoteTime(nextIndex);
                const fadeStartTime = prevTime;
                const fadeEndTime = nextTime;
                const fadeDuration = fadeEndTime - fadeStartTime;

                if (noteTime >= fadeStartTime && noteTime <= fadeEndTime) {
                    // Tab 노트가 fade 구간 안에 있음 - BPM 보간
                    const fadeProgress = (noteTime - fadeStartTime) / fadeDuration;
                    inheritedBpm = prevBpm + (nextBpm - prevBpm) * fadeProgress;
                } else if (noteTime < fadeStartTime) {
                    // fade 시작 전 - 이전 BPM 사용
                    inheritedBpm = prevBpm;
                    inheritedSubdivisions = prevSubdivisions;
                }
                // noteTime > fadeEndTime인 경우는 이미 nextBpm 사용
            }

            // Tab 노트에 상속받은 값 설정
            note.bpm = inheritedBpm;
            note.subdivisions = inheritedSubdivisions;
        }
    });
}

// 최적화된 렌더링 스케줄러 (디바운싱)
// 성능 최적화된 렌더링 스케줄러
function scheduleRender(flags = {}) {
    // 플래그 업데이트
    if (flags.noteList) pendingRenderFlags.noteList = true;
    if (flags.eventList) pendingRenderFlags.eventList = true;
    if (flags.canvas) pendingRenderFlags.canvas = true;

    if (renderScheduled) return;

    renderScheduled = true;

    // Idle 상태에서 렌더링 수행 (성능 향상)
    const performRender = () => {
        const startTime = performance.now();

        try {
            // 우선순위가 높은 렌더링부터 처리
            if (pendingRenderFlags.canvas) {
                drawPath();
            }

            // DOM 업데이트는 배치로 처리
            const domUpdates = [];

            if (pendingRenderFlags.noteList) {
                domUpdates.push(() => renderNoteListImmediate());
            }

            if (pendingRenderFlags.eventList) {
                domUpdates.push(() => renderEventListImmediate());
            }

            // DOM 업데이트 배치 실행
            if (domUpdates.length > 0) {
                // 레이아웃 스래싱 방지를 위한 읽기/쓰기 분리
                domUpdates.forEach(update => update());
            }


            const endTime = performance.now();
            const renderTime = endTime - startTime;

            // 성능 모니터링 (개발 모드에서만)
            if (renderTime > 16) { // 16ms 이상이면 경고
                console.warn(`Render time exceeded 16ms: ${renderTime.toFixed(2)}ms`);
            }

        } catch (error) {
            console.error('Render error:', error);
        } finally {
            // 플래그 초기화
            pendingRenderFlags = {
                noteList: false,
                eventList: false,
                canvas: false,
            };
            renderScheduled = false;
        }
    };

    // 브라우저가 한가할 때 렌더링 수행
    if (window.requestIdleCallback) {
        window.requestIdleCallback(performRender, { timeout: 16 });
    } else {
        // requestIdleCallback을 지원하지 않는 브라우저는 requestAnimationFrame 사용
        requestAnimationFrame(performRender);
    }
}

// 중복 검사 최적화 함수 (O(n²) → O(n))
// 같은 구간(sectionIndex)에서 beat-bpm-subdivisions가 모두 같을 때만 중복으로 판단
// 구간이 다르거나(beatReset 전후) bpm/subdivisions가 다르면 중복이 아님
function findDuplicateNoteIndices(notes, bpm, subdivisions) {
    const duplicateIndices = new Set();
    const noteMap = new Map(); // key: "sectionIndex-beat-bpm-subdivisions", value: [indices]

    notes.forEach((note, index) => {
        const noteBpm = note.bpm || bpm;
        const noteSubdivisions = note.subdivisions || subdivisions;
        const sectionIdx = note.sectionIndex !== undefined ? note.sectionIndex : 0;
        const key = `${sectionIdx}-${note.beat}-${noteBpm}-${noteSubdivisions}`;

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
    // 시간 입력 직후가 아닐 때만 cleanup 실행
    if (!window.skipNextCleanup) {
        // fade 구간에서 벗어난 노트들의 fadeDirectTime 제거
        cleanupFadeDirectTimes();
    }

    // Tab 노트들의 상속 값을 먼저 업데이트
    updateTabNotesInheritance();

    const tbody = document.getElementById("note-list");
    tbody.innerHTML = "";

    const bpm = parseFloat(document.getElementById("bpm").value || 120);
    const subdivisions = parseInt(document.getElementById("subdivisions").value || 16);
    const preDelaySeconds = getPreDelaySeconds();
    const allSectionOffsets = getOrComputeSectionOffsets();

    // 중복 검사 최적화 적용
    const duplicateNoteIndices = findDuplicateNoteIndices(notes, bpm, subdivisions);

    // Virtual Scrolling: 렌더링할 범위 계산
    const totalNotes = notes.length;
    const noteState = virtualScrollState.note;
    const startIndex = Math.max(0, Math.floor(noteState.scrollTop / noteState.itemHeight) - noteState.bufferCount);
    const endIndex = Math.min(totalNotes, startIndex + noteState.visibleCount + noteState.bufferCount * 2);

    // 상단 스페이서 (스크롤 위치 유지용)
    if (startIndex > 0) {
        const offsetY = startIndex * noteState.itemHeight;
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

        // beatReset 노드는 구간 경계 시각화
        if (note.beatReset) {
            tr.classList.add("beat-reset-node");
        }

        const tdIndex = document.createElement("td");
        const sIdx = note.sectionIndex !== undefined ? note.sectionIndex : '?';
        tdIndex.textContent = index;
        tdIndex.title = `구간 ${sIdx}`;

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
                // beatReset 속성 처리 (모든 타입)
                if (!n.hasOwnProperty("beatReset")) {
                    n.beatReset = false;
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
             });

        tdType.appendChild(typeSelect);

        // Tab 노트가 fade 구간에 있는지 확인 (한 번만 계산)
        const isTabNote = note.type === "tab" || note.type === "longtab";
        const fadeInfo = isTabNote ? getTabNoteFadeInfo(note, index) : { inFade: false };

        const tdBeat = document.createElement("td");
        const inputBeat = document.createElement("input");
        inputBeat.type = "number";
        inputBeat.step = "1";
        inputBeat.value = note.beat;

        // fade 구간의 tab/longtab 노트는 beat 입력 비활성화
        if (fadeInfo.inFade) {
            inputBeat.disabled = true;
            inputBeat.style.backgroundColor = "#f5f5f5";
            inputBeat.style.color = "#999";
            inputBeat.title = "Fade 구간에서는 시간값으로 beat가 자동 계산됩니다";
        }
        inputBeat.addEventListener("change", () => {
            // 변경 전 상태를 히스토리에 저장
            saveState();

            const oldBeat = note.beat;
            const newBeat = parseFloat(inputBeat.value);
            const diff = newBeat - oldBeat;

            if (isBatchEditEnabled) {
                // 현재 노트는 입력된 값으로 직접 설정
                note.beat = newBeat;
                if (note.hasOwnProperty('fadeDirectTime')) {
                    delete note.fadeDirectTime;
                }
                // 이후 노트들은 차이값만큼 조정
                notes.forEach((n, i) => {
                    if (i > index) {
                        n.beat += diff;
                        // beat가 변경된 노트들의 fadeDirectTime도 제거
                        if (n.hasOwnProperty('fadeDirectTime')) {
                            delete n.fadeDirectTime;
                        }
                    }
                });
            } else if (selectedNoteIndices.has(index) && selectedNoteIndices.size > 1) {
                // 다중 선택된 노트들의 beat 일괄 조정
                selectedNoteIndices.forEach(idx => {
                    if (idx < notes.length) {
                        notes[idx].beat += diff;
                        // beat가 변경된 노트들의 fadeDirectTime 제거
                        if (notes[idx].hasOwnProperty('fadeDirectTime')) {
                            delete notes[idx].fadeDirectTime;
                        }
                    }
                });
            } else {
                note.beat = newBeat;
                // beat 값이 변경되면 fade 구간의 직접 시간값 제거
                if (note.hasOwnProperty('fadeDirectTime')) {
                    delete note.fadeDirectTime;
                }
            }

            saveToStorage();
            drawPath();
            renderNoteList();
                        });
        tdBeat.appendChild(inputBeat);

        const tdTime = document.createElement("td");

        // 각 노트의 BPM/subdivision 사용 (구간 오프셋 포함)
        const noteBpm = note.bpm || bpm;
        const noteSubdivisions = note.subdivisions || subdivisions;
        const sectionOffset = allSectionOffsets[index] || 0;
        const originalTime = sectionOffset + beatToTime(note.beat, noteBpm, noteSubdivisions);

        if (note.beat === 0 && note.type === "direction" && sectionOffset === 0) {
            tdTime.textContent = `${originalTime.toFixed(3)}s`;
            tdTime.style.color = '#666';
            tdTime.title = '게임 시작점';
        } else if (fadeInfo.inFade) {
            // Tab 노트가 fade 구간에 있으면 자유로운 시간 입력 필드 표시
            let finalTime;
            if (note.hasOwnProperty('fadeDirectTime')) {
                // 이미 저장된 직접 시간값이 있으면 그것을 사용
                finalTime = note.fadeDirectTime;
            } else {
                // 처음이면 계산된 시간값을 저장
                finalTime = originalTime + preDelaySeconds;
                note.fadeDirectTime = finalTime;
            }

            const inputTime = document.createElement("input");
            inputTime.type = "number";
            inputTime.step = "0.001";
            // fade 구간 노트는 시간 제한 없이 자유롭게 입력 가능
            inputTime.value = finalTime.toFixed(3);
            inputTime.style.width = "80px";
            inputTime.style.fontSize = "11px";
            inputTime.style.color = "#FF9800";
            inputTime.title = "Fade 구간 내 자유 시간 입력 (제한 없음)";

            inputTime.addEventListener("change", () => {
                saveState();

                const targetFinalTime = parseFloat(inputTime.value);

                // fade 구간의 tab/longtab 노트의 모든 파라미터를 시간값에 기반하여 업데이트
                updateFadeNoteParameters(note, index, targetFinalTime, fadeInfo);

                saveToStorage();
                drawPath();

                // 시간 입력 직후에는 cleanup을 건너뛰도록 플래그 설정
                window.skipNextCleanup = true;
                renderNoteList();

                // 다음 렌더링에서는 cleanup 실행
                setTimeout(() => {
                    window.skipNextCleanup = false;
                }, 100);
             });

            tdTime.appendChild(inputTime);

            const hintDiv = document.createElement("div");
            hintDiv.style.fontSize = "10px";
            hintDiv.style.color = "#999";
            hintDiv.textContent = `(fade: ${fadeInfo.startBpm.toFixed(0)}→${fadeInfo.endBpm.toFixed(0)} BPM)`;
            tdTime.appendChild(hintDiv);
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
                const minBpm = parseFloat(document.getElementById("min-bpm").value || 1);
                const maxBpm = parseFloat(document.getElementById("max-bpm").value || 999);
                if (newBpm >= minBpm && newBpm <= maxBpm) {
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
             });
            tdSubdivisions.appendChild(selectSubdivisions);
        } else {
            // Tab 계열 노트는 이미 상속받은 Subdivisions 값을 표시
            tdSubdivisions.textContent = `${note.subdivisions || subdivisions}분박`;
            tdSubdivisions.style.color = "#999";
            tdSubdivisions.style.fontStyle = "italic";
            tdSubdivisions.title = "Tab 노트는 다음 Subdivisions 편집 가능 노트의 값을 추종합니다";
        }

        // Fade 컬럼 추가 (Direction, Both, Node 계열 노트에서만 editable)
        const tdFade = document.createElement("td");
        const canEditFade = ["direction", "longdirection", "both", "longboth", "node"].includes(note.type);

        if (canEditFade) {
            const fadeCheckbox = document.createElement("input");
            fadeCheckbox.type = "checkbox";
            fadeCheckbox.checked = note.fade || false;
            fadeCheckbox.title = "BPM 페이드 활성화 (이전 노트부터 현재 노트까지 점진적 변경)";
            fadeCheckbox.addEventListener("change", () => {
                // 변경 전 상태를 히스토리에 저장
                saveState();

                const newFade = fadeCheckbox.checked;

                // 다중 선택된 노트 중 Fade 변경이 가능한 노트만 변경
                if (selectedNoteIndices.has(index) && selectedNoteIndices.size > 1) {
                    selectedNoteIndices.forEach(idx => {
                        if (idx < notes.length) {
                            const n = notes[idx];
                            // Fade를 가질 수 있는 타입인지 확인
                            if (["direction", "longdirection", "both", "longboth", "node"].includes(n.type)) {
                                n.fade = newFade;
                            }
                        }
                    });
                } else {
                    note.fade = newFade;
                }

                saveToStorage();
                drawPath();
                renderNoteList();
             });
            tdFade.appendChild(fadeCheckbox);
        } else {
            tdFade.textContent = "-";
            tdFade.style.color = "#999";
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

        // Reset 컬럼 추가 (모든 타입)
        const tdReset = document.createElement("td");
        const resetCheckbox = document.createElement("input");
        resetCheckbox.type = "checkbox";
        resetCheckbox.checked = note.beatReset || false;
        resetCheckbox.title = "이 노트 이후 beat를 0부터 재시작";
        resetCheckbox.addEventListener("change", () => {
            saveState();
            note.beatReset = resetCheckbox.checked;
            invalidatePathCache();
            saveToStorage();
            drawPath();
            renderNoteList();
        });
        tdReset.appendChild(resetCheckbox);

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
                        });
        tdDelete.appendChild(btn);

        tr.append(tdIndex, tdType, tdBeat, tdTime, tdLong, tdDir, tdBpm, tdSubdivisions, tdFade, tdWait, tdReset, tdDelete);
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
        const remainingHeight = (totalNotes - endIndex) * noteState.itemHeight;
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

    const offsets = getOrComputeSectionOffsets();
    const noteWithOffset = { ...note, _sectionOffset: offsets[index] || 0 };
    const pathBeat = calculatePathBeat(noteWithOffset, preDelaySeconds, bpm, subdivisions);

    const directionNotes = getDirectionNotesWithOffsets(bpm, subdivisions);

    const pathDirectionNotes = directionNotes.map((n, i) => {
        const pBeat = calculatePathBeat(n, preDelaySeconds, bpm, subdivisions);
        let finalTime;
        const sectionOffset = n._sectionOffset || 0;
        if (n.beat === 0 && n.type === "direction" && sectionOffset === 0) {
            finalTime = 0;
        } else {
            const noteBpm = n.bpm || bpm;
            const noteSubdivisions = n.subdivisions || subdivisions;
            const originalTime = sectionOffset + beatToTime(n.beat, noteBpm, noteSubdivisions);
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

    let noteFinalTime;
    const noteSectionOffset = offsets[index] || 0;
    if (note.beat === 0 && note.type === "direction" && noteSectionOffset === 0) {
        noteFinalTime = preDelaySeconds;
    } else if ((note.type === "tab" || note.type === "longtab") &&
               note.hasOwnProperty('fadeDirectTime')) {
        noteFinalTime = note.fadeDirectTime;
    } else {
        const noteBpm = note.bpm || bpm;
        const noteSubdivisions = note.subdivisions || subdivisions;
        noteFinalTime = noteSectionOffset + beatToTime(note.beat, noteBpm, noteSubdivisions) + preDelaySeconds;
    }
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

    const directionNotes = getDirectionNotesWithOffsets(bpm, subdivisions);

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



function setupToggleFeatures() {
    const sidebar = document.getElementById('sidebar');
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const controlBar = document.getElementById('control-bar');
    const controlBarToggle = document.getElementById('control-bar-toggle');
    const main = document.getElementById('main');

    sidebarToggle.addEventListener('click', () => {
        const isHidden = sidebar.classList.contains('hidden');

        if (isHidden) {
            sidebar.classList.remove('hidden');
            sidebarToggle.classList.remove('hidden');
            main.classList.remove('sidebar-hidden');
            sidebarToggle.textContent = '◀';
        } else {
            sidebar.classList.add('hidden');
            sidebarToggle.classList.add('hidden');
            main.classList.add('sidebar-hidden');
            sidebarToggle.textContent = '▶';
        }

        setTimeout(() => {
            resizeCanvas();
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

function setupResizerFeatures() {
    const sidebar = document.getElementById('sidebar');
    const sidebarResizer = document.getElementById('sidebar-resizer');
    const sidebarToggle = document.querySelector('.sidebar-toggle');
    const main = document.getElementById('main');

    const controlBar = document.getElementById('control-bar');
    const controlBarResizer = document.getElementById('control-bar-resizer');

    let isResizing = false;
    let activeResizer = null; // 어떤 리사이저가 활성화된지 추적
    let startX = 0;
    let startWidth = 0;

    // 사이드바 리사이저
    sidebarResizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        activeResizer = 'sidebar';
        startX = e.clientX;
        startWidth = parseInt(getComputedStyle(sidebar).width);
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        e.preventDefault();
        e.stopPropagation();
    });

    // 컨트롤바 리사이저
    controlBarResizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        activeResizer = 'controlbar';
        startX = e.clientX;
        startWidth = parseInt(getComputedStyle(controlBar).width);
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        e.preventDefault();
        e.stopPropagation();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing || !activeResizer) return;

        const deltaX = e.clientX - startX;

        // 사이드바 리사이저
        if (activeResizer === 'sidebar') {
            const newWidth = Math.max(300, Math.min(800, startWidth + deltaX));

            sidebar.style.width = newWidth + 'px';
            sidebarResizer.style.left = (newWidth - 2) + 'px';
            sidebarToggle.style.left = newWidth + 'px';
            main.style.marginLeft = newWidth + 'px';

            // CSS 변수로 사이드바 너비 업데이트
            document.documentElement.style.setProperty('--sidebar-width', newWidth + 'px');
        }

        // 컨트롤바 리사이저
        if (activeResizer === 'controlbar') {
            const newWidth = Math.max(200, Math.min(500, startWidth - deltaX));
            controlBar.style.width = newWidth + 'px';
        }

        e.preventDefault();
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            activeResizer = null;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';

            // 캔버스와 웨이브폼 다시 그리기
            setTimeout(() => {
                resizeCanvas();
 {
                                        }
                drawPath();
            }, 50);
        }
    });

    // 마우스가 페이지를 벗어났을 때도 리사이징 중지
    document.addEventListener('mouseleave', () => {
        if (isResizing) {
            isResizing = false;
            activeResizer = null;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }
    });
}

function setupNoteButtons() {
    // 노트 버튼들은 이벤트 델리게이션으로 처리됨
    // 기존 개별 addEventListener 제거하여 중복 실행 방지
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
    try {
        const subdivisions = parseInt(document.getElementById("subdivisions").value || 16);
        let newBeat;
        let insertionIndex;


        if (selectedNoteIndex !== null && selectedNoteIndex < notes.length) {
            const selectedNote = notes[selectedNoteIndex];

            // 선택된 노트와 직전 노트의 간격을 계산
            let interval;
            if (selectedNoteIndex > 0) {
                const previousNote = notes[selectedNoteIndex - 1];
                const addOffsets = getOrComputeSectionOffsets();
                const selectedOffset = addOffsets[selectedNoteIndex] || 0;
                const previousOffset = addOffsets[selectedNoteIndex - 1] || 0;
                if (selectedOffset === previousOffset) {
                    // 같은 구간 — beat 차이를 간격으로 사용
                    interval = selectedNote.beat - previousNote.beat;
                } else {
                    // 다른 구간 — 기본 간격 사용
                    interval = subdivisions;
                }
            } else {
                // 첫 번째 노트라면 기본 간격 사용
                interval = subdivisions;
            }

            // 간격이 0 이하라면 기본 간격 사용
            if (interval <= 0) {
                interval = subdivisions;
            }

            // 선택된 노트 + 간격으로 새 노트 beat 설정
            newBeat = selectedNote.beat + interval;

            // 선택된 노트 바로 다음 위치에 삽입
            insertionIndex = selectedNoteIndex + 1;
        } else {
            // 현재 BPM/Subdivisions 가져오기 (maxBeat 계산에 필요)
            const bpm = parseFloat(document.getElementById("bpm").value || 120);
            // subdivisions는 이미 함수 상단에서 선언됨

            insertionIndex = notes.length;

            // 마지막 구간의 노트들만 기준으로 maxBeat 계산
            const addOffsets = getOrComputeSectionOffsets();
            const lastSectionOffset = addOffsets.length > 0 ? addOffsets[addOffsets.length - 1] : 0;
            const lastSectionNotes = notes.filter((n, i) => (addOffsets[i] || 0) === lastSectionOffset);
            const maxBeat = Math.max(0, ...lastSectionNotes.map(n => {
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

        // BPM/Subdivisions 상속 로직
        let inheritedBpm, inheritedSubdivisions;
        if (selectedNoteIndex !== null && selectedNoteIndex !== -1 && notes[selectedNoteIndex]) {
            // 선택된 노트가 있으면 그 노트의 BPM/subdivision을 상속
            const selectedNote = notes[selectedNoteIndex];
            inheritedBpm = selectedNote.bpm || parseFloat(document.getElementById("bpm").value || 120);
            inheritedSubdivisions = selectedNote.subdivisions || parseInt(document.getElementById("subdivisions").value || 16);
        } else {
            // 선택된 노트가 없으면 현재 전역 값 사용
            inheritedBpm = parseFloat(document.getElementById("bpm").value || 120);
            inheritedSubdivisions = parseInt(document.getElementById("subdivisions").value || 16);
        }

        const newNote = {
            ...noteProps,
            beat: newBeat,
            bpm: inheritedBpm,          // 상속받은 BPM 저장
            subdivisions: inheritedSubdivisions  // 상속받은 subdivision 저장
        };

        if (newNote.type === "direction" || newNote.type === "longdirection" || newNote.type === "both" || newNote.type === "longboth") {
            const addBpm = parseFloat(document.getElementById("bpm").value || 120);
            const addDirOffsets = getOrComputeSectionOffsets();
            const precedingDirectionNotes = notes
                .slice(0, insertionIndex)
                .filter(n => n.type === "direction" || n.type === "longdirection" || n.type === "both" || n.type === "longboth")
                .sort((a, b) => {
                    const idxA = notes.indexOf(a);
                    const idxB = notes.indexOf(b);
                    const tA = (addDirOffsets[idxA] || 0) + beatToTime(a.beat, a.bpm || addBpm, a.subdivisions || subdivisions);
                    const tB = (addDirOffsets[idxB] || 0) + beatToTime(b.beat, b.bpm || addBpm, b.subdivisions || subdivisions);
                    return tA - tB;
                });

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
 
        focusNoteAtIndex(insertionIndex);
    } catch (error) {
        console.error('Error in addNote:', error);
        console.error('noteProps:', noteProps);
        console.error('selectedNoteIndex:', selectedNoteIndex);
        console.error('notes.length:', notes.length);
    }
}

// BPM/Subdivisions 변경 시 시간 기반으로 노트 업데이트
function updateNotesForTimeBasedChange(oldBpm, oldSubdivisions, newBpm, newSubdivisions) {
    console.log(`Updating notes from BPM ${oldBpm}/${oldSubdivisions} to ${newBpm}/${newSubdivisions}`);

    notes.forEach(note => {
        // fade 구간의 직접 시간값이 있는 노트는 beat 업데이트를 건너뜀
        if ((note.type === "tab" || note.type === "longtab") &&
            note.hasOwnProperty('fadeDirectTime')) {
            console.log(`Skipping beat update for fade note with fadeDirectTime: ${note.fadeDirectTime}`);
            return;
        }

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

// BPM 제약 조건 업데이트 함수
function updateBpmConstraints() {
    const minBpm = parseFloat(document.getElementById("min-bpm").value || 1);
    const maxBpm = parseFloat(document.getElementById("max-bpm").value || 999);
    const bpmField = document.getElementById("bpm");

    if (bpmField) {
        bpmField.min = minBpm;
        bpmField.max = maxBpm;
    }

    console.log(`BPM constraints updated: ${minBpm} - ${maxBpm}`);
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
        }

// Pre-delay 변경 핸들러
function handlePreDelayChange() {
    const preDelayField = document.getElementById("pre-delay");
    const newPreDelayMs = parseInt(preDelayField.value || 0);
    const oldPreDelayMs = parseInt(preDelayField.dataset.previousValue || 0);
    const preDelayDiffMs = newPreDelayMs - oldPreDelayMs;

    console.log(`Pre-delay changed from ${oldPreDelayMs}ms to ${newPreDelayMs}ms (diff: ${preDelayDiffMs}ms)`);

    // 모든 이벤트의 시간을 pre-delay 변경량만큼 조정
    if (preDelayDiffMs !== 0) {
        const preDelayDiffSeconds = preDelayDiffMs / 1000;
        const allEvents = getAllEvents();

        allEvents.forEach(event => {
            if (event && typeof event.eventTime === 'number') {
                event.eventTime += preDelayDiffSeconds;
            }
        });

        console.log(`Updated ${allEvents.length} events by ${preDelayDiffSeconds}s`);
    }

    // 현재 값을 이전 값으로 업데이트
    preDelayField.dataset.previousValue = newPreDelayMs;

    saveToStorage();
    renderNoteList();
    renderEventList();
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
    const directionNotes = getDirectionNotesWithOffsets(bpm, subdivisions);

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
    const directionNotes = getDirectionNotesWithOffsets(bpm, subdivisions);

    if (directionNotes.length === 0) return null;

    const pathDirectionNotes = calculatePathDirectionNotes(directionNotes, bpm, subdivisions, preDelaySeconds);
    const timing = getNoteTimingParams(note, bpm, subdivisions);
    const noteIndex = notes.indexOf(note);
    const noteSectionOffset = (noteIndex >= 0) ? (getOrComputeSectionOffsets()[noteIndex] || 0) : 0;
    const noteTime = noteSectionOffset + beatToTime(note.beat, timing.bpm, timing.subdivisions) + preDelaySeconds;

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

// 접기 상태를 메모리에 저장 (DOM 순회 제거)
const collapseStatesMemoryCache = {
    params: new Map(), // eventIndex -> boolean
    dialog: new Map()  // eventIndex -> boolean
};

// 옵션 요소 캐싱 (중복 생성 방지)
const optionElementCache = {
    eventTypes: null,
    dialogItemTypes: null
};

// EventType 옵션 캐시 생성
function getCachedEventTypeOptions() {
    if (!optionElementCache.eventTypes) {
        const eventTypes = getEventTypes();
        const fragment = document.createDocumentFragment();

        eventTypes.forEach(type => {
            const option = document.createElement("option");
            option.value = type;
            option.textContent = type;
            const description = getEventTypeDescription(type);
            if (description) {
                option.title = description;
            }
            fragment.appendChild(option);
        });

        optionElementCache.eventTypes = fragment;
    }

    // cloneNode로 재사용
    return optionElementCache.eventTypes.cloneNode(true);
}


// DialogItemType 옵션 캐시 생성
function getCachedDialogItemTypeOptions() {
    if (!optionElementCache.dialogItemTypes) {
        const itemTypes = getDialogItemTypes();
        const fragment = document.createDocumentFragment();

        itemTypes.forEach(type => {
            const option = document.createElement("option");
            option.value = type.type;
            option.textContent = type.type;
            fragment.appendChild(option);
        });

        optionElementCache.dialogItemTypes = fragment;
    }

    return optionElementCache.dialogItemTypes.cloneNode(true);
}

// 실제 렌더링 함수 (즉시 실행)
function renderEventListImmediate() {
    const startTime = performance.now();
    const events = getAllEvents();
    const state = virtualScrollState.event;

    // 100개 이하면 전체 렌더링, 100개 초과면 가상 스크롤링
    let result;
    if (state.enabled && events.length > 100) {
        result = renderEventListVirtualized();
    } else {
        result = renderEventListImmediate_Original();
    }

    const endTime = performance.now();
    const renderTime = endTime - startTime;

    // 성능 로그 (100개 이상일 때만 출력)
    if (events.length > 100) {
        console.log(`[EventList 렌더링] ${events.length}개 이벤트, ${renderTime.toFixed(2)}ms, 방식: ${state.enabled ? '가상스크롤링' : '전체렌더링'}`);
    }

    return result;
}

// 가상 스크롤링 렌더링 함수
function renderEventListVirtualized() {
    const container = document.getElementById("event-list");
    if (!container) return;

    const events = getAllEvents();
    const eventTypes = getEventTypes();
    const state = virtualScrollState.event;

    // 컨테이너 높이 업데이트
    state.containerHeight = container.clientHeight;

    // 현재 스크롤 위치에서 보이는 범위 계산
    const scrollTop = container.scrollTop;
    state.scrollTop = scrollTop;

    // 평균 아이템 높이 계산 (캐시된 높이 기반)
    if (state.itemHeights.size > 0) {
        const heights = Array.from(state.itemHeights.values());
        const avgHeight = heights.reduce((a, b) => a + b, 0) / heights.length;
        state.itemHeight = avgHeight;
    }

    const itemHeight = state.itemHeight;
    const overscan = state.overscan;

    // 보이는 범위의 시작과 끝 인덱스 계산
    const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const endIndex = Math.min(
        events.length - 1,
        Math.ceil((scrollTop + state.containerHeight) / itemHeight) + overscan
    );

    state.renderedRange = { start: startIndex, end: endIndex };

    // 전체 높이를 유지하기 위한 spacer 계산
    const totalHeight = events.length * itemHeight;
    const topSpacerHeight = startIndex * itemHeight;

    // 기존 렌더링된 아이템들의 인덱스 확인
    const existingItems = new Map();
    container.querySelectorAll('.event-item').forEach(item => {
        const index = parseInt(item.getAttribute('data-event-index'));
        if (!isNaN(index)) {
            existingItems.set(index, item);
        }
    });

    // DocumentFragment 사용하여 배치 DOM 업데이트
    const fragment = document.createDocumentFragment();

    // Top spacer
    let topSpacer = container.querySelector('.virtual-scroll-top-spacer');
    if (!topSpacer) {
        topSpacer = document.createElement('div');
        topSpacer.className = 'virtual-scroll-top-spacer';
    }
    topSpacer.style.height = `${topSpacerHeight}px`;

    // 렌더링할 아이템들
    const itemsToRender = [];
    for (let i = startIndex; i <= endIndex; i++) {
        if (existingItems.has(i)) {
            // 이미 렌더링된 아이템 재사용
            itemsToRender.push(existingItems.get(i));
            existingItems.delete(i);
        } else {
            // 새 아이템 생성
            const event = events[i];
            const eventDiv = createEventElement(event, i);
            itemsToRender.push(eventDiv);
        }
    }

    // Bottom spacer
    let bottomSpacer = container.querySelector('.virtual-scroll-bottom-spacer');
    if (!bottomSpacer) {
        bottomSpacer = document.createElement('div');
        bottomSpacer.className = 'virtual-scroll-bottom-spacer';
    }
    const bottomSpacerHeight = Math.max(0, totalHeight - topSpacerHeight - (endIndex - startIndex + 1) * itemHeight);
    bottomSpacer.style.height = `${bottomSpacerHeight}px`;

    // DOM 업데이트 (한 번에)
    container.innerHTML = '';
    container.appendChild(topSpacer);
    itemsToRender.forEach(item => container.appendChild(item));
    container.appendChild(bottomSpacer);

    // 아이템 높이 측정 및 캐싱 (다음 렌더링에 사용)
    requestAnimationFrame(() => {
        container.querySelectorAll('.event-item').forEach(item => {
            const index = parseInt(item.getAttribute('data-event-index'));
            if (!isNaN(index)) {
                const height = item.offsetHeight;
                if (height > 0) {
                    state.itemHeights.set(index, height);
                }
            }
        });
    });

    // 접기 상태 복원 (메모리 캐시 사용)
    restoreCollapseStatesFromMemory();
}

// 메모리 캐시에서 접기 상태 저장
function saveCollapseStatesToMemory() {
    // Parameters 접기 상태 저장
    document.querySelectorAll('.params-container').forEach(container => {
        const eventIndex = container.closest('.event-item')?.dataset.eventIndex;
        if (eventIndex !== undefined) {
            collapseStatesMemoryCache.params.set(
                parseInt(eventIndex),
                container.classList.contains('collapsed')
            );
        }
    });

    // Dialog 접기 상태 저장
    document.querySelectorAll('.dialog-content').forEach(content => {
        const eventIndex = content.closest('.event-item')?.dataset.eventIndex;
        if (eventIndex !== undefined) {
            collapseStatesMemoryCache.dialog.set(
                parseInt(eventIndex),
                content.classList.contains('collapsed')
            );
        }
    });
}

// 메모리 캐시에서 접기 상태 복원
function restoreCollapseStatesFromMemory() {
    // Parameters 접기 상태 복원
    document.querySelectorAll('.params-container').forEach(container => {
        const eventIndex = container.closest('.event-item')?.dataset.eventIndex;
        if (eventIndex !== undefined) {
            const isCollapsed = collapseStatesMemoryCache.params.get(parseInt(eventIndex));
            if (isCollapsed !== undefined) {
                const toggle = container.querySelector('.params-toggle');
                if (isCollapsed) {
                    container.classList.add('collapsed');
                    if (toggle) toggle.textContent = "▶";
                } else {
                    container.classList.remove('collapsed');
                    if (toggle) toggle.textContent = "▼";
                }
            }
        }
    });

    // Dialog 접기 상태 복원
    document.querySelectorAll('.dialog-content').forEach(content => {
        const eventIndex = content.closest('.event-item')?.dataset.eventIndex;
        if (eventIndex !== undefined) {
            const isCollapsed = collapseStatesMemoryCache.dialog.get(parseInt(eventIndex));
            if (isCollapsed !== undefined) {
                const toggle = content.parentElement?.querySelector('.dialog-toggle');
                if (isCollapsed) {
                    content.classList.add('collapsed');
                    if (toggle) toggle.textContent = "▶";
                } else {
                    content.classList.remove('collapsed');
                    if (toggle) toggle.textContent = "▼";
                }
            }
        }
    });
}

// 새로운 이벤트 하나만 리스트에 추가하는 최적화된 함수
function appendSingleEventToList(eventIndex) {
    const container = document.getElementById("event-list");
    const events = getAllEvents();
    const event = events[eventIndex];

    if (!event) return;

    const eventDiv = createEventElement(event, eventIndex);
    container.appendChild(eventDiv);

    // 새로 추가된 이벤트로 스크롤
    eventDiv.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

// 이벤트 요소 생성 함수 (재사용 가능)
function createEventElement(event, eventIndex) {
    const eventTypes = getEventTypes();

    const eventDiv = document.createElement("div");
    eventDiv.className = "event-item";

    // 선택된 이벤트 표시
    if (selectedEventIndices.has(eventIndex)) {
        eventDiv.classList.add("selected");
    }

    // 이벤트 아이템 클릭 리스너 (한 번만 등록)
    attachEventClickListener(eventDiv, eventIndex);

    const eventHeader = document.createElement("div");
    eventHeader.className = "event-header";

    // 배치 DOM 조작을 위한 document fragment 사용
    const fragment = document.createDocumentFragment();

    // Event Type 드롭다운 생성
    const typeElements = createEventTypeElements(event, eventTypes);
    fragment.appendChild(typeElements.typeLabel);

    // Event ID 입력 요소 생성
    const idElements = createEventIdElements(event, eventIndex);
    fragment.appendChild(idElements.idLabel);

    // Event Time 입력 요소 생성
    const timeElements = createEventTimeElements(event, eventIndex);
    fragment.appendChild(timeElements.timeLabel);

    // 버튼들 생성
    const buttonElements = createEventButtonElements(event, eventIndex);
    fragment.appendChild(buttonElements.predefinedParamsBtn);
    fragment.appendChild(buttonElements.deleteBtn);

    eventHeader.appendChild(fragment);
    eventDiv.appendChild(eventHeader);

    // 파라미터 섹션 생성
    const paramsSection = createEventParamsSection(event, eventIndex);
    eventDiv.appendChild(paramsSection);

    return eventDiv;
}

// 이벤트 클릭 리스너는 이제 이벤트 델리게이션으로 처리됨 (성능 최적화)
function attachEventClickListener(eventDiv, eventIndex) {
    // 이벤트 델리게이션으로 처리되므로 개별 리스너 불필요
    // eventDiv에 data 속성으로 인덱스 저장
    eventDiv.setAttribute('data-event-index', eventIndex);
}

// 이벤트 클릭 처리 로직 분리
function handleEventClick(e, eventIndex) {
    const container = document.getElementById("event-list");

    if (e.shiftKey && lastClickedEventIndex !== null) {
        const start = Math.min(lastClickedEventIndex, eventIndex);
        const end = Math.max(lastClickedEventIndex, eventIndex);

        // DOM만 업데이트 (전체 리렌더링 방지)
        for (let i = start; i <= end; i++) {
            selectedEventIndices.add(i);
            const eventItem = container.querySelector(`[data-event-index="${i}"]`);
            if (eventItem) {
                eventItem.classList.add("selected");
            }
        }
        lastClickedEventIndex = eventIndex;
    } else if (e.ctrlKey || e.metaKey) {
        // DOM만 업데이트 (전체 리렌더링 방지)
        if (selectedEventIndices.has(eventIndex)) {
            selectedEventIndices.delete(eventIndex);
            const eventItem = container.querySelector(`[data-event-index="${eventIndex}"]`);
            if (eventItem) {
                eventItem.classList.remove("selected");
            }
        } else {
            selectedEventIndices.add(eventIndex);
            const eventItem = container.querySelector(`[data-event-index="${eventIndex}"]`);
            if (eventItem) {
                eventItem.classList.add("selected");
            }
        }
        lastClickedEventIndex = eventIndex;
    } else {
        // 단순 클릭: 선택 상태 초기화 후 해당 이벤트만 선택
        // DOM만 업데이트 (전체 리렌더링 방지)
        const allItems = container.querySelectorAll('.event-item');
        allItems.forEach(item => item.classList.remove("selected"));

        selectedEventIndices.clear();
        selectedEventIndices.add(eventIndex);

        const eventItem = container.querySelector(`[data-event-index="${eventIndex}"]`);
        if (eventItem) {
            eventItem.classList.add("selected");
        }

        lastClickedEventIndex = eventIndex;
        focusEventAtIndex(eventIndex);
    }
}

// Event Type 요소들 생성
function createEventTypeElements(event, eventTypes) {
    const typeLabel = document.createElement("label");
    typeLabel.textContent = "Type: ";
    const typeSelect = document.createElement("select");
    typeSelect.className = "event-type-select";

    // 옵션들을 배치로 추가
    const fragment = document.createDocumentFragment();
    eventTypes.forEach(type => {
        const option = document.createElement("option");
        option.value = type;
        option.textContent = type;
        option.selected = type === event.eventType;

        const description = getEventTypeDescription(type);
        if (description) {
            option.title = description;
        }
        fragment.appendChild(option);
    });
    typeSelect.appendChild(fragment);

    const currentDescription = getEventTypeDescription(event.eventType);
    if (currentDescription) {
        typeSelect.title = currentDescription;
    }

    // 이벤트 델리게이션으로 처리되므로 개별 리스너 불필요
    typeLabel.appendChild(typeSelect);

    return { typeLabel, typeSelect };
}

// Type 변경 처리 함수
function handleTypeChange(e, event) {
    event.eventType = e.target.value;
    const newDescription = getEventTypeDescription(e.target.value);
    e.target.title = newDescription || '';

    event.eventId = '';
    saveToStorage();

    // 전체 리렌더링 대신 해당 이벤트만 업데이트
    requestAnimationFrame(() => renderEventList());
}

// Event ID 요소들 생성
function createEventIdElements(event, eventIndex) {
    const idLabel = document.createElement("label");
    idLabel.textContent = "ID: ";

    const idInput = createEventIdInputElement(event);
    idLabel.appendChild(idInput);

    return { idLabel, idInput };
}

// Event ID 입력 요소 생성 (독립된 함수)
function createEventIdInputElement(event) {
    const isCustom = isCustomEventType(event.eventType);
    let idInput;

    if (isCustom) {
        // custom 타입이면 텍스트 입력
        idInput = document.createElement("input");
        idInput.type = "text";
        idInput.className = "event-id-input";
        idInput.value = event.eventId;

        // 이벤트 델리게이션으로 처리됨
    } else {
        // 사전 정의된 타입이면 드롭다운
        idInput = document.createElement("select");
        idInput.className = "event-id-select";

        const eventIds = getEventIdsByType(event.eventType);

        // Document fragment를 사용한 배치 추가
        const fragment = document.createDocumentFragment();

        // 빈 옵션 추가 (선택 안함)
        const emptyOption = document.createElement("option");
        emptyOption.value = "";
        emptyOption.textContent = "-- 선택 --";
        fragment.appendChild(emptyOption);

        // 사전 정의된 EventId 옵션들 추가
        eventIds.forEach(id => {
            const option = document.createElement("option");
            option.value = id;
            option.textContent = id;
            option.selected = id === event.eventId;
            fragment.appendChild(option);
        });

        // 현재 값이 목록에 없으면 "기타" 옵션으로 추가
        if (event.eventId && !eventIds.includes(event.eventId)) {
            const customOption = document.createElement("option");
            customOption.value = event.eventId;
            customOption.textContent = `${event.eventId} (사용자 정의)`;
            customOption.selected = true;
            fragment.appendChild(customOption);
        }

        idInput.appendChild(fragment);

        // 이벤트 델리게이션으로 처리됨
    }

    return idInput;
}

// Event Time 요소들 생성
function createEventTimeElements(event, eventIndex) {
    const timeLabel = document.createElement("label");
    timeLabel.textContent = "Time: ";
    const timeInput = document.createElement("input");
    timeInput.type = "number";
    timeInput.step = "0.001";
    timeInput.value = event.eventTime;
    timeInput.className = "event-time-input";

    // 이벤트 델리게이션으로 처리됨

    timeLabel.appendChild(timeInput);
    return { timeLabel, timeInput };
}

// Event 버튼들 생성
function createEventButtonElements(event, eventIndex) {
    const predefinedParamsBtn = document.createElement("button");
    predefinedParamsBtn.textContent = "기본 파라미터";
    predefinedParamsBtn.className = "predefined-params-btn";
    // 이벤트 델리게이션으로 처리됨

    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "삭제";
    deleteBtn.className = "delete-event-btn";
    // 이벤트 델리게이션으로 처리됨

    return { predefinedParamsBtn, deleteBtn };
}

// Event 파라미터 섹션 생성
function createEventParamsSection(event, eventIndex) {
    const paramsContainer = document.createElement("div");
    paramsContainer.className = "params-container";

    const isDialog = isDialogEvent(event);

    // Dialog 이벤트인 경우 특별한 UI 생성
    if (isDialog) {
        return createDialogItemsSection(event, eventIndex);
    }

    const paramsLabel = document.createElement("div");
    paramsLabel.className = "params-label";
    paramsLabel.innerHTML = '<span class="params-toggle">▼</span> Parameters';

    // 토글 기능은 이벤트 델리게이션으로 처리됨

    const paramsContent = document.createElement("div");
    paramsContent.className = "params-content";

    const paramsList = document.createElement("div");
    paramsList.className = "params-list";

    // 파라미터들 렌더링
    event.eventParams.forEach((param, paramIndex) => {
        const paramDiv = createEventParamElement(event, eventIndex, param, paramIndex);
        paramsList.appendChild(paramDiv);
    });

    const addParamBtn = document.createElement("button");
    addParamBtn.textContent = "파라미터 추가";
    addParamBtn.className = "add-param-btn";
    // 이벤트 델리게이션으로 처리됨

    paramsContent.appendChild(paramsList);
    paramsContent.appendChild(addParamBtn);
    paramsContainer.appendChild(paramsLabel);
    paramsContainer.appendChild(paramsContent);

    return paramsContainer;
}

// Event 파라미터 요소 생성
function createEventParamElement(event, eventIndex, param, paramIndex) {
    const paramDiv = document.createElement("div");
    paramDiv.className = "param-item";

    const paramNameInput = document.createElement("input");
    paramNameInput.type = "text";
    paramNameInput.placeholder = "파라미터 이름";
    paramNameInput.value = param.paramName;
    paramNameInput.className = "param-name-input";

    const paramValueInput = document.createElement("input");
    paramValueInput.type = "text";
    paramValueInput.placeholder = "파라미터 값";
    paramValueInput.value = param.paramValue;
    paramValueInput.className = "param-value-input";

    const deleteParamBtn = document.createElement("button");
    deleteParamBtn.textContent = "삭제";
    deleteParamBtn.className = "delete-param-btn";

    // 이벤트 델리게이션으로 처리됨

    paramDiv.appendChild(paramNameInput);
    paramDiv.appendChild(paramValueInput);
    paramDiv.appendChild(deleteParamBtn);

    return paramDiv;
}

// 메모리 누수 방지를 위한 이벤트 리스너 정리
function cleanupEventListeners(container) {
    if (!container) return;

    const elements = container.querySelectorAll('input, select, button');
    elements.forEach(element => {
        if (element.parentNode) {
            // Clone하여 모든 이벤트 리스너 제거
            const clone = element.cloneNode(true);
            element.parentNode.replaceChild(clone, element);
        }
    });
}

// 접기 상태 저장/복원 함수들
function saveCollapseStates() {
    const states = new Map();

    // Parameters 접기 상태 저장
    document.querySelectorAll('.params-container').forEach((container, index) => {
        const eventIndex = container.closest('.event-item')?.dataset.eventIndex;
        if (eventIndex !== undefined) {
            states.set(`params-${eventIndex}`, container.classList.contains('collapsed'));
        }
    });

    // Dialog 접기 상태 저장
    document.querySelectorAll('.dialog-content').forEach((content, index) => {
        const eventIndex = content.closest('.event-item')?.dataset.eventIndex;
        if (eventIndex !== undefined) {
            states.set(`dialog-${eventIndex}`, content.classList.contains('collapsed'));
        }
    });

    return states;
}

function restoreCollapseStates(states) {
    if (!states) return;

    // Parameters 접기 상태 복원
    document.querySelectorAll('.params-container').forEach(container => {
        const eventIndex = container.closest('.event-item')?.dataset.eventIndex;
        if (eventIndex !== undefined) {
            const isCollapsed = states.get(`params-${eventIndex}`);
            if (isCollapsed !== undefined) {
                const toggle = container.querySelector('.params-toggle');
                if (isCollapsed) {
                    container.classList.add('collapsed');
                    if (toggle) toggle.textContent = "▶";
                } else {
                    container.classList.remove('collapsed');
                    if (toggle) toggle.textContent = "▼";
                }
            }
        }
    });

    // Dialog 접기 상태 복원
    document.querySelectorAll('.dialog-content').forEach(content => {
        const eventIndex = content.closest('.event-item')?.dataset.eventIndex;
        if (eventIndex !== undefined) {
            const isCollapsed = states.get(`dialog-${eventIndex}`);
            if (isCollapsed !== undefined) {
                const toggle = content.parentElement?.querySelector('.dialog-toggle');
                if (isCollapsed) {
                    content.classList.add('collapsed');
                    if (toggle) toggle.textContent = "▶";
                } else {
                    content.classList.remove('collapsed');
                    if (toggle) toggle.textContent = "▼";
                }
            }
        }
    });
}

// 기존 이벤트 렌더링 로직 (가상 스크롤링 비활성화)
function renderEventListImmediate_Original() {
    const container = document.getElementById("event-list");
    if (!container) {
        return;
    }

    // 접기 상태 저장
    const collapseStates = saveCollapseStates();

    // 기존 요소들 제거 (이벤트 위임을 사용하므로 개별 리스너 정리 불필요)
    container.innerHTML = "";

    const events = getAllEvents();
    const eventTypes = getEventTypes();

    // DocumentFragment 생성 (배치 DOM 업데이트)
    const fragment = document.createDocumentFragment();

    events.forEach((event, eventIndex) => {
        const eventDiv = document.createElement("div");
        eventDiv.className = "event-item";
        // data-event-index 속성 추가하여 이벤트 위임에서 사용
        eventDiv.setAttribute('data-event-index', eventIndex);

        // 선택된 이벤트 표시
        if (selectedEventIndices.has(eventIndex)) {
            eventDiv.classList.add("selected");
        }

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

        // 이벤트 위임으로 처리되므로 개별 리스너 불필요
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
                // 이벤트 위임으로 처리되므로 개별 리스너 불필요
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

                // 이벤트 위임으로 처리되므로 개별 리스너 불필요
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
            // DOM 재렌더링을 지연시켜 이벤트 처리가 완료된 후 실행
            requestAnimationFrame(() => {
                scheduleRender({ eventList: true });
            });
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

        // 기본 파라미터 버튼 이벤트는 handleEventListClick에서 위임으로 처리

        // 삭제 버튼
        const deleteBtn = document.createElement("button");
        deleteBtn.textContent = "Delete";
        deleteBtn.className = "delete-event-btn";
        // 삭제 버튼 이벤트는 handleEventListClick에서 위임으로 처리

        eventHeader.appendChild(typeLabel);
        eventHeader.appendChild(idLabel);
        eventHeader.appendChild(timeLabel);
        eventHeader.appendChild(predefinedParamsBtn);
        eventHeader.appendChild(deleteBtn);

        // Parameters 섹션 생성 (dialog 지원)
        const paramsContainer = createEventParamsSection(event, eventIndex);

        eventDiv.appendChild(eventHeader);
        eventDiv.appendChild(paramsContainer);

        // DocumentFragment에 추가 (DOM 조작 최소화)
        fragment.appendChild(eventDiv);
    });

    // DocumentFragment를 한 번에 컨테이너에 추가 (단일 reflow)
    container.appendChild(fragment);

    // 접기 상태 복원 (다음 프레임에서 실행하여 DOM이 완전히 업데이트된 후 실행)
    requestAnimationFrame(() => {
        restoreCollapseStates(collapseStates);
    });
}

// 탭 전환 함수
function switchTab(tabName) {
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');

    tabButtons.forEach(btn => btn.classList.remove('active'));
    tabContents.forEach(content => content.classList.remove('active'));

    const tabButton = document.querySelector(`[data-tab="${tabName}"]`);
    const tabContent = document.getElementById(`${tabName}-tab`);

    if (tabButton) tabButton.classList.add('active');
    if (tabContent) tabContent.classList.add('active');

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
// 이벤트 델리게이션 시스템 (성능 최적화)
function setupEventDelegation() {
    // 이벤트 리스트 컨테이너에 대한 단일 이벤트 리스너
    const eventListContainer = document.getElementById("event-list");
    if (eventListContainer) {
        eventListContainer.addEventListener("click", handleEventListClick);
        eventListContainer.addEventListener("change", handleEventListChange);

        // 드래그 앤 드롭 이벤트 추가
        eventListContainer.addEventListener("dragstart", handleDialogItemDragStart);
        eventListContainer.addEventListener("dragover", handleDialogItemDragOver);
        eventListContainer.addEventListener("drop", handleDialogItemDrop);
        eventListContainer.addEventListener("dragend", handleDialogItemDragEnd);

        // 가상 스크롤링을 위한 스크롤 이벤트 리스너 (스로틀링 적용)
        let scrollTimeout = null;
        eventListContainer.addEventListener("scroll", () => {
            // 접기 상태를 메모리에 저장 (스크롤 전에)
            saveCollapseStatesToMemory();

            // 스로틀링: 스크롤 중에는 너무 자주 렌더링하지 않음
            if (scrollTimeout) return;

            scrollTimeout = setTimeout(() => {
                const events = getAllEvents();
                const state = virtualScrollState.event;

                // 가상 스크롤링이 활성화되고 이벤트가 100개 초과일 때만
                if (state.enabled && events.length > 100) {
                    renderEventListVirtualized();
                }

                scrollTimeout = null;
            }, 50); // 50ms 디바운스
        });
    }

    // 사이드바 이벤트 델리게이션
    const sidebar = document.getElementById("sidebar");
    if (sidebar) {
        sidebar.addEventListener("click", handleSidebarClick);
        sidebar.addEventListener("change", handleSidebarChange);
    } else {
        console.error('Sidebar element not found!');
    }

    // 컨트롤 바 이벤트 델리게이션 (노트 버튼들이 여기에 있음)
    const controlBar = document.getElementById("control-bar");
    if (controlBar) {
        controlBar.addEventListener("click", handleSidebarClick);
    } else {
        console.error('Control-bar element not found!');
    }

    // 메인 영역 이벤트 델리게이션
    const main = document.getElementById("main");
    if (main) {
        main.addEventListener("click", handleMainClick);
    }
}

// 이벤트 리스트 클릭 처리
function handleEventListClick(e) {
    const target = e.target;
    const eventItem = target.closest('.event-item');

    if (!eventItem) return;

    const eventIndex = parseInt(eventItem.getAttribute('data-event-index')) ||
        (eventItem.parentNode ? Array.from(eventItem.parentNode.children).indexOf(eventItem) : -1);

    if (eventIndex < 0) return;

    // 삭제 버튼
    if (target.classList.contains('delete-event-btn')) {
        if (confirm("이벤트를 삭제하시겠습니까?")) {
            if (removeEvent(eventIndex)) {
                scheduleRender({ eventList: true });
                saveToStorage();
            }
        }
        return;
    }

    // 기본 파라미터 버튼
    if (target.classList.contains('predefined-params-btn') || target.classList.contains('add-predefined-params-btn')) {
        applyPredefinedParams(eventIndex);
        scheduleRender({ eventList: true });
        saveToStorage();
        return;
    }

    // 파라미터 추가 버튼
    if (target.classList.contains('add-param-btn')) {
        addEventParam(eventIndex);
        scheduleRender({ eventList: true });
        saveToStorage();
        return;
    }

    // 파라미터 삭제 버튼
    if (target.classList.contains('delete-param-btn')) {
        const paramItem = target.closest('.param-item');
        if (paramItem) {
            const paramIndex = parseInt(paramItem.getAttribute('data-param-index')) ||
                (paramItem.parentNode ? Array.from(paramItem.parentNode.children).indexOf(paramItem) : -1);
            removeEventParam(eventIndex, paramIndex);
            scheduleRender({ eventList: true });
            saveToStorage();
        }
        return;
    }

    // 파라미터 토글
    if (target.classList.contains('params-toggle') || target.closest('.params-label')) {
        const paramsContainer = eventItem.querySelector('.params-container');
        if (!paramsContainer) return;

        const toggle = paramsContainer.querySelector('.params-toggle');

        // CSS와 일치하도록 paramsContainer에 collapsed 클래스 토글
        paramsContainer.classList.toggle("collapsed");

        // 토글 아이콘 업데이트
        if (paramsContainer.classList.contains("collapsed")) {
            toggle.textContent = "▶";
        } else {
            toggle.textContent = "▼";
        }

        // 메모리 캐시에 상태 저장 (증분 업데이트)
        collapseStatesMemoryCache.params.set(
            eventIndex,
            paramsContainer.classList.contains("collapsed")
        );
        return;
    }

    // Dialog 토글
    if (target.classList.contains('dialog-toggle') || target.closest('.dialog-label')) {
        const dialogContainer = eventItem.querySelector('.dialog-container');
        if (!dialogContainer) return;

        const content = dialogContainer.querySelector('.dialog-content');
        const toggle = dialogContainer.querySelector('.dialog-toggle');

        // content에 collapsed 클래스 토글 (dialog는 기존 방식 유지)
        content.classList.toggle("collapsed");

        // 토글 아이콘 업데이트
        if (content.classList.contains("collapsed")) {
            toggle.textContent = "▶";
        } else {
            toggle.textContent = "▼";
        }

        // 메모리 캐시에 상태 저장 (증분 업데이트)
        collapseStatesMemoryCache.dialog.set(
            eventIndex,
            content.classList.contains("collapsed")
        );
        return;
    }

    // Dialog 아이템 추가 버튼
    if (target.classList.contains('add-dialog-item-btn')) {
        const itemType = 'text'; // 기본 타입
        addDialogItem(eventIndex, itemType);
        scheduleRender({ eventList: true });
        saveToStorage();
        return;
    }

    // Dialog 아이템 삭제 버튼
    if (target.classList.contains('delete-dialog-item-btn')) {
        const itemIndex = parseInt(target.dataset.itemIndex);
        if (confirm("Dialog 아이템을 삭제하시겠습니까?")) {
            if (removeDialogItem(eventIndex, itemIndex)) {
                scheduleRender({ eventList: true });
                saveToStorage();
            }
        }
        return;
    }

    // 이벤트 아이템 선택
    if (!["INPUT", "SELECT", "BUTTON"].includes(target.tagName)) {
        handleEventClick(e, eventIndex);
    }
}

// 이벤트 리스트 변경 처리 (디바운싱 적용)
const eventChangeTimeouts = new Map();

function handleEventListChange(e) {
    const target = e.target;
    const eventItem = target.closest('.event-item');

    if (!eventItem) return;

    const eventIndex = parseInt(eventItem.getAttribute('data-event-index')) ||
        (eventItem.parentNode ? Array.from(eventItem.parentNode.children).indexOf(eventItem) : -1);

    if (eventIndex < 0) return;

    const events = getAllEvents();
    const event = events[eventIndex];

    if (!event) return;

    // 기존 타이머 클리어
    if (eventChangeTimeouts.has(target)) {
        clearTimeout(eventChangeTimeouts.get(target));
    }

    // 디바운싱된 처리
    const timeoutId = setTimeout(() => {
        if (target.classList.contains('event-type-select')) {
            event.eventType = target.value;
            const newDescription = getEventTypeDescription(target.value);
            target.title = newDescription || '';
            event.eventId = '';
            saveToStorage();
            requestAnimationFrame(() => renderEventList());
        } else if (target.classList.contains('event-id-input')) {
            event.eventId = target.value;
            saveToStorage();
        } else if (target.classList.contains('event-id-select')) {
            event.eventId = target.value;
            // 사전 정의된 파라미터 자동 추가
            applyPredefinedParams(eventIndex);
            saveToStorage();
            scheduleRender({ eventList: true }); // UI 새로고침으로 새로 추가된 파라미터들 표시
        } else if (target.classList.contains('event-time-input')) {
            const newTime = parseFloat(target.value) || 0;
            const oldTime = event.eventTime;
            const timeDiff = newTime - oldTime;

            // 여러 이벤트가 선택되어 있고, 현재 이벤트가 선택된 이벤트 중 하나일 때
            if (selectedEventIndices.has(eventIndex) && selectedEventIndices.size > 1) {
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
                event.eventTime = newTime;
            }
            saveToStorage();
        } else if (target.classList.contains('param-name-input')) {
            const paramItem = target.closest('.param-item');
            if (paramItem) {
                const paramIndex = paramItem.parentNode ? Array.from(paramItem.parentNode.children).indexOf(paramItem) : -1;
                if (event.eventParams[paramIndex]) {
                    event.eventParams[paramIndex].paramName = target.value;
                }
            }
            saveToStorage();
        } else if (target.classList.contains('param-value-input')) {
            const paramItem = target.closest('.param-item');
            if (paramItem) {
                const paramIndex = paramItem.parentNode ? Array.from(paramItem.parentNode.children).indexOf(paramItem) : -1;
                if (event.eventParams[paramIndex]) {
                    event.eventParams[paramIndex].paramValue = target.value;
                }
            }
            saveToStorage();
        } else if (target.classList.contains('dialog-item-type-select')) {
            const itemIndex = parseInt(target.dataset.itemIndex);
            const newType = target.value;

            if (event.dialogItems && event.dialogItems[itemIndex]) {
                // 새로운 타입의 아이템으로 교체
                const newItem = createDialogItem(newType);
                newItem.index = itemIndex;
                event.dialogItems[itemIndex] = newItem;
                saveToStorage();
                scheduleRender({ eventList: true });
            }
        } else if (target.classList.contains('dialog-item-field-input')) {
            const itemIndex = parseInt(target.dataset.itemIndex);
            const fieldName = target.dataset.fieldName;

            if (event.dialogItems && event.dialogItems[itemIndex]) {
                let value = target.value;

                // 타입에 따른 값 변환
                const field = getDialogItemFields(event.dialogItems[itemIndex].type)
                    .find(f => f.fieldName === fieldName);
                if (field && field.fieldType === 'float') {
                    value = parseFloat(value) || 0.0;
                }

                event.dialogItems[itemIndex][fieldName] = value;
                saveToStorage();
            }
        }

        eventChangeTimeouts.delete(target);
    }, 300);

    eventChangeTimeouts.set(target, timeoutId);
}

// 사이드바 클릭 처리
function handleSidebarClick(e) {
    const target = e.target;

    // Note 버튼들
    if (target.id === 'add-tab') {
        e.preventDefault();
        e.stopPropagation();
        addNote({ type: "tab", isLong: false, longTime: 0 });
        return;
    }
    if (target.id === 'add-dir') {
        e.preventDefault();
        e.stopPropagation();
        addNote({ type: "direction", isLong: false, longTime: 0 });
        return;
    }
    if (target.id === 'add-both') {
        e.preventDefault();
        e.stopPropagation();
        addNote({ type: "both", isLong: false, longTime: 0 });
        return;
    }
    if (target.id === 'add-node') {
        e.preventDefault();
        e.stopPropagation();
        addNote({ type: "node", isLong: false, longTime: 0 });
        return;
    }
    if (target.id === 'add-long-tab') {
        e.preventDefault();
        e.stopPropagation();
        addNote({ type: "longtab", isLong: true });
        return;
    }
    if (target.id === 'add-long-dir') {
        e.preventDefault();
        e.stopPropagation();
        addNote({ type: "longdirection", isLong: true });
        return;
    }
    if (target.id === 'add-long-both') {
        e.preventDefault();
        e.stopPropagation();
        addNote({ type: "longboth", isLong: true });
        return;
    }

    // Event 버튼들
    if (target.id === 'add-event') {
        const eventIndex = addEvent();
        appendSingleEventToList(eventIndex);
        saveToStorage();
        return;
    }
    if (target.id === 'duplicate-events') {
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
        return;
    }
    if (target.id === 'clear-event-selection') {
        selectedEventIndices.clear();
        lastClickedEventIndex = null;
        renderEventList();
        return;
    }

    // 기타 버튼들...
}

// 사이드바 변경 처리
function handleSidebarChange(e) {
    const target = e.target;

    if (target.id === 'bpm') {
        bpm = parseFloat(target.value) || 120;
        saveToStorage();
        drawPath();
         return;
    }
    if (target.id === 'subdivisions') {
        subdivisions = parseInt(target.value) || 16;
        saveToStorage();
        drawPath();
         return;
    }
    if (target.id === 'pre-delay') {
        handlePreDelayChange();
        return;
    }
    if (target.id === 'speed-multiplier') {
        speedMultiplier = parseFloat(target.value) || 1.0;
        saveToStorage();
        return;
    }
}

// 메인 영역 클릭 처리
function handleMainClick(e) {
    const target = e.target;

    // Canvas 관련 처리는 기존 방식 유지
    if (target.tagName === 'CANVAS') {
        return;
    }

    // 기타 메인 영역 클릭 처리...
}

document.addEventListener("DOMContentLoaded", async () => {


    // 이벤트 델리게이션 시스템 설정 (성능 최적화)
    setupEventDelegation();

    // Undo/Redo 시스템 초기화
    initializeUndoRedo();

    try {
        await initDB();
    } catch (err) {
        console.warn('IndexedDB initialization failed:', err);
    }

    setupSubdivisionsOptions();

    viewOffset = {
        x: canvas.clientWidth / 2,
        y: canvas.clientHeight / 2
    };


    // Virtual Scrolling 초기화
    const noteListContainer = document.querySelector("#notes-tab table");
    if (noteListContainer) {
        const scrollContainer = noteListContainer.closest(".tab-content");
        if (scrollContainer) {
            // 스크롤 이벤트 리스너 추가
            scrollContainer.addEventListener("scroll", () => {
                virtualScrollState.note.scrollTop = scrollContainer.scrollTop;
                scheduleRender({ noteList: true });
            });

            // 화면 크기에 따른 visibleCount 계산
            const updateVisibleCount = () => {
                const containerHeight = scrollContainer.clientHeight;
                virtualScrollState.note.visibleCount = Math.ceil(containerHeight / virtualScrollState.note.itemHeight) + 10;
            };
            updateVisibleCount();
            window.addEventListener('resize', updateVisibleCount);
        }
    }

    hasAudioFile = false;
    audioBuffer = null;
    
    const bpmField = document.getElementById("bpm");
    const subdivisionsField = document.getElementById("subdivisions");
    const preDelayField = document.getElementById("pre-delay");

    if (bpmField) {
        bpmField.dataset.previousValue = bpmField.value || "120";
    }
    if (subdivisionsField) {
        subdivisionsField.dataset.previousValue = subdivisionsField.value || "16";
    }
    if (preDelayField) {
        preDelayField.dataset.previousValue = preDelayField.value || "0";
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

    // Min BPM 변경 이벤트 리스너
    const minBpmField = document.getElementById("min-bpm");
    if (minBpmField) {
        minBpmField.addEventListener("change", (e) => {
            updateBpmConstraints();
            saveToStorage();
        });
    }

    // Max BPM 변경 이벤트 리스너
    const maxBpmField = document.getElementById("max-bpm");
    if (maxBpmField) {
        maxBpmField.addEventListener("change", (e) => {
            updateBpmConstraints();
            saveToStorage();
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

    // Add Event 버튼은 이벤트 델리게이션으로 처리됨

    // 복제 및 선택 해제 버튼들은 이벤트 델리게이션으로 처리됨

    // Go to URL 버튼 이벤트 리스너
    document.getElementById("go-to-url").addEventListener("click", () => {
        const url = "https://www.notion.so/ilsang93/TrackEvent-278b81f1cb6580f595a3c31abe3a2187?source=copy_link#278b81f1cb65808cb523ea007e49dcc4";
        if (url && url.trim() !== "" && url.trim() !== "https://") {
            window.open(url.trim(), '_blank');
        }
    });

    // 모두 접기 버튼 이벤트 리스너
    document.getElementById("collapse-all").addEventListener("click", () => {
        const paramsContainers = document.querySelectorAll(".params-container");
        const dialogContents = document.querySelectorAll(".dialog-content");

        paramsContainers.forEach(container => {
            container.classList.add("collapsed");
            const toggle = container.querySelector('.params-toggle');
            if (toggle) toggle.textContent = "▶";
        });

        dialogContents.forEach(content => {
            content.classList.add("collapsed");
            const toggle = content.parentElement.querySelector('.dialog-toggle');
            if (toggle) toggle.textContent = "▶";
        });
    });

    // 모두 펼치기 버튼 이벤트 리스너
    document.getElementById("expand-all").addEventListener("click", () => {
        const paramsContainers = document.querySelectorAll(".params-container");
        const dialogContents = document.querySelectorAll(".dialog-content");

        paramsContainers.forEach(container => {
            container.classList.remove("collapsed");
            const toggle = container.querySelector('.params-toggle');
            if (toggle) toggle.textContent = "▼";
        });

        dialogContents.forEach(content => {
            content.classList.remove("collapsed");
            const toggle = content.parentElement.querySelector('.dialog-toggle');
            if (toggle) toggle.textContent = "▼";
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
                ...(note.wait !== undefined && { wait: note.wait }),
                ...(note.beatReset !== undefined && { beatReset: note.beatReset })
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

        const bpm = parseFloat(document.getElementById("bpm").value || 120);
        const subdivisions = parseInt(document.getElementById("subdivisions").value || 16);

        // 구간 번호(sectionIndex) 1차, 구간 내 상대 시간 2차로 정렬
        const sorted = sortNotesByTime(notes, bpm, subdivisions);
        notes.splice(0, notes.length, ...sorted);

        // 이벤트도 시간 기준으로 정렬
        sortEventsByTime();

        // 캐시 무효화 (내부에서 sectionIndex 재계산 포함)
        invalidatePathCache();

        saveToStorage();
        drawPath();
        renderNoteList();
        renderEventList();
    });

    document.getElementById("export-image").addEventListener("click", () => {
        const bpm = parseFloat(document.getElementById("bpm").value) || 120;
        const subdivisions = parseInt(document.getElementById("subdivisions").value) || 16;
        const preDelaySeconds = (parseInt(document.getElementById("pre-delay").value) || 0) / 1000;
        exportChartSVG({
            notes,
            events: getAllEvents(),
            bpm,
            subdivisions,
            preDelaySeconds,
            speedMultiplier
        });
    });

    document.getElementById("save-json").addEventListener("click", () => {
        const bpm = parseFloat(document.getElementById("bpm").value || 120);
        const subdivisions = parseInt(document.getElementById("subdivisions").value || 16);
        const preDelayValue = parseInt(document.getElementById("pre-delay").value || 0);
        const preDelaySeconds = preDelayValue / 1000;

        // 마지막 Direction Type None 노트 확인 및 추가
        ensureFinalDirectionNote(notes, bpm, subdivisions);

        // JSON 저장 전에 시간순으로 정렬 (무작위 순서 방지)
        const sortedNotes = sortNotesByTime(notes, bpm, subdivisions);
        notes.splice(0, notes.length, ...sortedNotes);

        // 정렬 후 sectionIndex 재계산 및 캐시 무효화
        invalidatePathCache();

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
        const validatedSectionOffsets = validationResult.sectionOffsets;

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
            noteList: validatedNotes.map((n, i) => {
                // noteToJsonFormat 함수를 사용하여 fadeDirectTime 및 sectionOffset 지원
                const sectionOffset = validatedSectionOffsets ? (validatedSectionOffsets[i] || 0) : 0;
                return noteToJsonFormat(n, bpm, subdivisions, preDelaySeconds, sectionOffset);
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
                        preDelayMs = json.preDelay;
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
                            subdivisions: n.subdivisions || subdivisions, // 노트별 subdivision 로드 (없으면 전역 값 사용)
                            fade: typeof n.fade === 'boolean' ? n.fade : (typeof n.fade === 'number' ? n.fade > 0 : false) // fade를 boolean으로 변환 (하위 호환성)
                        };

                        // Node 타입 노트의 경우 wait 필드 추가
                        if (type === "node") {
                            noteData.wait = n.isWait || false;
                        }
                        // beatReset 필드 추가 (모든 타입)
                        noteData.beatReset = n.isBeatReset || false;

                        // JSON에 절대시간 정보가 있으면 정렬용으로 임시 저장
                        // originalTime과 finalTime 중 사용 가능한 것을 우선 사용
                        if (n.originalTime !== undefined) {
                            noteData._sortTime = n.originalTime;
                        } else if (n.finalTime !== undefined) {
                            noteData._sortTime = n.finalTime;
                        } else if (n.time !== undefined) {
                            noteData._sortTime = n.time;
                        }

                        notes.push(noteData);
                    });

                    // JSON 데이터가 무작위 순서로 들어있을 수 있으므로 절대시간 기준으로 먼저 정렬
                    // 이를 통해 beatReset 노트가 올바른 위치에 배치되도록 보장
                    if (notes.length > 0 && notes[0]._sortTime !== undefined) {
                        // 절대시간 정보가 있는 경우: 절대시간 기준 정렬
                        notes.sort((a, b) => {
                            const timeA = a._sortTime !== undefined ? a._sortTime : 0;
                            const timeB = b._sortTime !== undefined ? b._sortTime : 0;
                            return timeA - timeB;
                        });
                    } else {
                        // 절대시간 정보가 없는 경우 (구버전 JSON): beat 기준으로 정렬 (최선의 노력)
                        notes.sort((a, b) => a.beat - b.beat);
                    }

                    // 정렬용 임시 필드 제거
                    notes.forEach(n => {
                        delete n._sortTime;
                    });

                    document.getElementById("bpm").value = bpm;
                    document.getElementById("subdivisions").value = subdivisions;
                    document.getElementById("pre-delay").value = preDelayMs;

                    // previousValue도 업데이트하여 로드 후 변경 감지가 올바르게 작동하도록 함
                    const preDelayField = document.getElementById("pre-delay");
                    if (preDelayField) {
                        preDelayField.dataset.previousValue = preDelayMs;
                    }

                    // Level 값 설정 (없으면 기본값 10)
                    const levelValue = json.level || 10;
                    document.getElementById("level").value = levelValue;
                    document.getElementById("level-display").textContent = levelValue;

                    // Min/Max BPM 값 설정 (없으면 기본값 사용)
                    const minBpm = json.minbpm || 60;
                    const maxBpm = json.maxbpm || 300;
                    document.getElementById("min-bpm").value = minBpm;
                    document.getElementById("max-bpm").value = maxBpm;

                    // BPM 제약 조건 업데이트
                    updateBpmConstraints();

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

                    // sectionIndex 재계산 후 캐시 무효화
                    invalidatePathCache();

                    saveToStorage();
                    drawPath();
                    renderNoteList();
                    scheduleRender({ eventList: true });
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
                        savedAudioFile = null;
            if (audioFileURL)
                URL.revokeObjectURL(audioFileURL);
            audioFileURL = null;
            demoAudio.src = '';
            
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

        // 파일 이름 표시 제거
        // const container = inputAudio.parentElement;
        // let indicator = container.querySelector('.file-indicator');
        // if (!indicator) {
        //     indicator = document.createElement('div');
        //     indicator.className = 'file-indicator';
        //     indicator.style.cssText = 'margin-top: 5px; font-size: 12px; color: #4CAF50; font-weight: bold;';
        //     container.appendChild(indicator);
        // }
        // indicator.textContent = `선택된 파일: ${file.name}`;

        processAudioFile(file);
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
        if (e.button === 0 || e.button === 1) {
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
        if (e.button === 0 || e.button === 1) {
            isPanning = false;
        }
    });

    canvas.addEventListener("click", (e) => {
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        const clickBpm = parseFloat(document.getElementById("bpm").value || 120);
        const clickSubs = parseInt(document.getElementById("subdivisions").value || 16);
        const clickPreDelay = getPreDelaySeconds();
        const clickDirNotes = getDirectionNotesWithOffsets(clickBpm, clickSubs);
        const clickPathNotes = calculatePathDirectionNotes(clickDirNotes, clickBpm, clickSubs, clickPreDelay);
        const clickPathData = calculateNodePositions(clickPathNotes, clickBpm, clickSubs);
        const clickNodePositions = clickPathData.nodePositions;
        const clickOffsets = getOrComputeSectionOffsets();

        for (let i = 0; i < notes.length; i++) {
            const note = notes[i];
            const sectionOffset = clickOffsets[i] || 0;
            let noteFinalTime;
            if (note.beat === 0 && note.type === "direction" && sectionOffset === 0) {
                noteFinalTime = 0;
            } else if ((note.type === "tab" || note.type === "longtab") &&
                       note.hasOwnProperty('fadeDirectTime')) {
                noteFinalTime = note.fadeDirectTime;
            } else {
                const noteBpm = note.bpm || clickBpm;
                const noteSubs = note.subdivisions || clickSubs;
                noteFinalTime = sectionOffset + beatToTime(note.beat, noteBpm, noteSubs) + clickPreDelay;
            }
            const pos = getNotePositionFromPathData(noteFinalTime, clickPathNotes, clickNodePositions);
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
        // Canvas resize handling if needed
    });

    setupVolumeControls();
    setupToggleFeatures();
    setupResizerFeatures();
    setupNoteButtons();

    ensureInitialDirectionNote(notes);
    loadFromStorage();

    // 기존 노트들에 개별 BPM/subdivision이 없으면 현재 설정값으로 초기화
    initializeNoteBpmSubdivisions();

    // BPM 제약 조건 초기화
    updateBpmConstraints();

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
            case 'r':
                addNote({ type: "node", isLong: false, longTime: 0 });
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
    // 다중 선택이 없으면 단일 선택(포커스)된 노트를 대상으로 함
    if (selectedNoteIndices.size === 0 && selectedNoteIndex !== null) {
        selectedNoteIndices.add(selectedNoteIndex);
    }

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
 {
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
            const copyOffsets = getOrComputeSectionOffsets();
            for (const index of noteIndices) {
                if (index >= 0 && index < notes.length) {
                    const note = notes[index];
                    // 출력 형태의 JSON으로 변환 (sectionOffset 포함)
                    const sectionOffset = copyOffsets[index] || 0;
                    const jsonNote = noteToJsonFormat(note, currentBpm, currentSubdivisions, currentPreDelaySeconds, sectionOffset);
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
                            paramName: param.paramName || '',
                            paramValue: param.paramValue || ''
                        })) : []
                };


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

                // beatReset 필드 추가 (모든 타입)
                newNote.beatReset = noteData.isBeatReset || false;

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

// Dialog 아이템 섹션 생성
function createDialogItemsSection(event, eventIndex) {
    const dialogContainer = document.createElement("div");
    dialogContainer.className = "dialog-container";

    // 기본 Parameters 섹션 (접혀있는 상태)
    const paramsSection = createCollapsibleParamsSection(event, eventIndex);
    dialogContainer.appendChild(paramsSection);

    // Dialog Items 섹션
    const dialogLabel = document.createElement("div");
    dialogLabel.className = "dialog-label";
    dialogLabel.innerHTML = '<span class="dialog-toggle">▼</span> Dialog Items';

    const dialogContent = document.createElement("div");
    dialogContent.className = "dialog-content";

    const dialogItemsList = document.createElement("div");
    dialogItemsList.className = "dialog-items-list";
    dialogItemsList.dataset.eventIndex = eventIndex;

    // dialogItems가 없으면 초기화
    if (!event.dialogItems) {
        event.dialogItems = [];
    }

    // Dialog 아이템들 렌더링
    event.dialogItems.forEach((item, itemIndex) => {
        const itemDiv = createDialogItemElement(event, eventIndex, item, itemIndex);
        dialogItemsList.appendChild(itemDiv);
    });

    // Add Dialog Item 버튼
    const addItemBtn = document.createElement("button");
    addItemBtn.textContent = "+ Dialog Item 추가";
    addItemBtn.className = "add-dialog-item-btn";
    addItemBtn.dataset.eventIndex = eventIndex;

    dialogContent.appendChild(dialogItemsList);
    dialogContent.appendChild(addItemBtn);
    dialogContainer.appendChild(dialogLabel);
    dialogContainer.appendChild(dialogContent);

    return dialogContainer;
}

// 접을 수 있는 기본 Parameters 섹션 생성
function createCollapsibleParamsSection(event, eventIndex) {
    const paramsContainer = document.createElement("div");
    paramsContainer.className = "params-container collapsed";

    const paramsLabel = document.createElement("div");
    paramsLabel.className = "params-label";
    paramsLabel.innerHTML = '<span class="params-toggle">▶</span> Parameters';

    const paramsContent = document.createElement("div");
    paramsContent.className = "params-content";
    paramsContent.style.display = "none";

    const paramsList = document.createElement("div");
    paramsList.className = "params-list";

    // 파라미터들 렌더링
    event.eventParams.forEach((param, paramIndex) => {
        const paramDiv = createEventParamElement(event, eventIndex, param, paramIndex);
        paramsList.appendChild(paramDiv);
    });

    const addParamBtn = document.createElement("button");
    addParamBtn.textContent = "파라미터 추가";
    addParamBtn.className = "add-param-btn";

    paramsContent.appendChild(paramsList);
    paramsContent.appendChild(addParamBtn);
    paramsContainer.appendChild(paramsLabel);
    paramsContainer.appendChild(paramsContent);

    return paramsContainer;
}

// Dialog 아이템 요소 생성
function createDialogItemElement(event, eventIndex, item, itemIndex) {
    const itemDiv = document.createElement("div");
    itemDiv.className = "dialog-item";
    itemDiv.dataset.itemIndex = itemIndex;
    // itemDiv.draggable = true; // 제거: 전체 아이템이 아닌 드래그 핸들만 드래그 가능하게

    // 드래그 핸들
    const dragHandle = document.createElement("div");
    dragHandle.className = "drag-handle";
    dragHandle.innerHTML = "⋮⋮";
    dragHandle.title = "드래그하여 순서 변경";
    dragHandle.draggable = true; // 드래그 핸들만 드래그 가능하게

    // 인덱스 표시
    const indexSpan = document.createElement("span");
    indexSpan.className = "item-index";
    indexSpan.textContent = `${itemIndex}:`;

    // 아이템 타입 선택
    const typeSelect = document.createElement("select");
    typeSelect.className = "dialog-item-type-select";
    typeSelect.dataset.eventIndex = eventIndex;
    typeSelect.dataset.itemIndex = itemIndex;

    const itemTypes = getDialogItemTypes();
    itemTypes.forEach(type => {
        const option = document.createElement("option");
        option.value = type;
        option.textContent = type;
        option.selected = type === item.type;
        typeSelect.appendChild(option);
    });

    // 아이템 필드들 생성
    const fieldsContainer = document.createElement("div");
    fieldsContainer.className = "dialog-item-fields";

    const fields = getDialogItemFields(item.type);
    fields.forEach(field => {
        const fieldDiv = document.createElement("div");
        fieldDiv.className = "dialog-item-field";

        const fieldLabel = document.createElement("label");
        fieldLabel.textContent = `${field.fieldName}: `;

        const fieldInput = document.createElement("input");
        fieldInput.type = field.fieldType === 'float' ? 'number' : 'text';
        if (field.fieldType === 'float') {
            fieldInput.step = "0.01";
        }
        fieldInput.value = item[field.fieldName] || '';
        fieldInput.placeholder = field.placeholder || '';
        fieldInput.className = "dialog-item-field-input";
        fieldInput.dataset.eventIndex = eventIndex;
        fieldInput.dataset.itemIndex = itemIndex;
        fieldInput.dataset.fieldName = field.fieldName;

        fieldLabel.appendChild(fieldInput);
        fieldDiv.appendChild(fieldLabel);
        fieldsContainer.appendChild(fieldDiv);
    });

    // 삭제 버튼
    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "×";
    deleteBtn.className = "delete-dialog-item-btn";
    deleteBtn.dataset.eventIndex = eventIndex;
    deleteBtn.dataset.itemIndex = itemIndex;
    deleteBtn.title = "아이템 삭제";

    // 요소들 조합
    const headerDiv = document.createElement("div");
    headerDiv.className = "dialog-item-header";
    headerDiv.appendChild(dragHandle);
    headerDiv.appendChild(indexSpan);
    headerDiv.appendChild(typeSelect);
    headerDiv.appendChild(deleteBtn);

    itemDiv.appendChild(headerDiv);
    itemDiv.appendChild(fieldsContainer);

    return itemDiv;
}

// 드래그 앤 드롭 관련 변수들
let draggedItem = null;
let draggedEventIndex = null;
let draggedItemIndex = null;

// Dialog 아이템 드래그 시작
function handleDialogItemDragStart(e) {

    // 드래그 핸들인지 확인
    if (!e.target.classList.contains('drag-handle')) {
        e.preventDefault();
        return;
    }

    const dialogItem = e.target.closest('.dialog-item');
    if (!dialogItem) {
        e.preventDefault();
        return;
    }

    draggedItem = dialogItem;
    draggedEventIndex = parseInt(dialogItem.closest('.event-item').dataset.eventIndex);
    draggedItemIndex = parseInt(dialogItem.dataset.itemIndex);


    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', dialogItem.outerHTML);

    // 드래그 중인 아이템 스타일 변경
    setTimeout(() => {
        dialogItem.style.opacity = '0.5';
    }, 0);
}

// Dialog 아이템 드래그 오버
function handleDialogItemDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const dialogItem = e.target.closest('.dialog-item');
    if (!dialogItem || !draggedItem || dialogItem === draggedItem) {
        return;
    }

    // 같은 이벤트 내의 아이템만 허용
    const targetEventIndex = parseInt(dialogItem.closest('.event-item').dataset.eventIndex);
    if (targetEventIndex !== draggedEventIndex) {
        return;
    }


    // 드롭 위치 표시를 위한 스타일 추가
    const rect = dialogItem.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;

    // 기존 drop-indicator 제거
    document.querySelectorAll('.drop-indicator').forEach(el => el.remove());

    if (e.clientY < midY) {
        // 위에 드롭
        dialogItem.style.borderTop = '2px solid #007cba';
    } else {
        // 아래에 드롭
        dialogItem.style.borderBottom = '2px solid #007cba';
    }
}

// Dialog 아이템 드롭
function handleDialogItemDrop(e) {
    e.preventDefault();

    if (!draggedItem) {
        return;
    }

    const targetItem = e.target.closest('.dialog-item');
    if (!targetItem || targetItem === draggedItem) {
        return;
    }

    // 같은 이벤트 내의 아이템만 허용
    const targetEventIndex = parseInt(targetItem.closest('.event-item').dataset.eventIndex);
    if (targetEventIndex !== draggedEventIndex) {
        return;
    }

    const targetItemIndex = parseInt(targetItem.dataset.itemIndex);

    // 드롭 위치 계산
    const rect = targetItem.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    let newIndex = targetItemIndex;

    if (e.clientY >= midY) {
        newIndex = targetItemIndex + 1;
    }

    // 드래그된 아이템이 뒤에 있을 때 인덱스 조정
    if (draggedItemIndex < newIndex) {
        newIndex--;
    }


    // 같은 위치로 드롭하면 무시
    if (newIndex === draggedItemIndex) {
        return;
    }

    // 아이템 이동
    if (moveDialogItem(draggedEventIndex, draggedItemIndex, newIndex)) {
        scheduleRender({ eventList: true });
        saveToStorage();
    }
}

// Dialog 아이템 드래그 종료
function handleDialogItemDragEnd(e) {
    // 스타일 초기화
    if (draggedItem) {
        draggedItem.style.opacity = '';
    }

    // border 스타일 제거
    document.querySelectorAll('.dialog-item').forEach(item => {
        item.style.borderTop = '';
        item.style.borderBottom = '';
    });

    // drop-indicator 제거
    document.querySelectorAll('.drop-indicator').forEach(el => el.remove());

    // 변수 초기화
    draggedItem = null;
    draggedEventIndex = null;
}

// 개발자 도구용: 가상 스크롤링 토글 함수
window.toggleEventListVirtualScrolling = function (enabled) {
    virtualScrollState.event.enabled = enabled;
    console.log(`가상 스크롤링: ${enabled ? '활성화' : '비활성화'}`);
    renderEventList();
};

// 개발자 도구용: 대량 테스트 이벤트 생성
window.generateTestEvents = function (count = 1000) {
    const startTime = performance.now();

    clearAllEvents();

    for (let i = 0; i < count; i++) {
        addEvent();
        const event = getEventAtIndex(i);
        if (event) {
            event.eventType = i % 2 === 0 ? 'player' : 'camera';
            event.eventId = 'test';
            event.eventTime = i * 0.1;
        }
    }

    const endTime = performance.now();
    console.log(`${count}개 테스트 이벤트 생성 완료 (${(endTime - startTime).toFixed(2)}ms)`);
    renderEventList();
};