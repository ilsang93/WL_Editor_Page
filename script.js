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
let selectedNoteIndex = null; // 현재 선택된 노트의 인덱스

let globalAnimationFrameId = null;
let isDrawLoopRunning = false;
let isBatchEditEnabled = false;

let musicVolume = 0.5; // 0.0 ~ 1.0
let sfxVolume = 1.0; // 0.0 ~ 1.0

const demoPlayer = {
    x: 0,
    y: 0
};

const notes = [];

let audioBuffer = null;
let waveformData = null;
let waveformZoom = 1;
let waveformOffset = 0;
let pathHighlightTimer = 0;
let hasAudioFile = false; // 오디오 파일 로드 상태 추가

let tabSoundPool = []; // Tab 사운드 풀
let directionSoundPool = []; // Direction 사운드 풀
let playedNotes = new Set(); // 이미 재생된 노트들을 추적
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


// 유틸리티 함수들
function lerp(start, end, amt) {
    return (1 - amt) * start + amt * end;
}

function getPreDelaySeconds() {
    const preDelayMs = parseInt(document.getElementById("pre-delay").value || 0);
    return preDelayMs / 1000;
}

function beatToTime(beat, bpm, subdivisions) {
    return (beat * 60) / (bpm * subdivisions);
}

function timeToBeat(time, bpm, subdivisions) {
    return Math.round((time * bpm * subdivisions) / 60);
}

function directionToVector(dir) {
    const map = {
        none: [0, 0],
        up: [0, -1],
        down: [0, 1],
        left: [-1, 0],
        right: [1, 0],
        upleft: [-1, -1],
        upright: [1, -1],
        downleft: [-1, 1],
        downright: [1, 1]
    };
    return map[dir] || [0, 0];
}

function formatTime(sec) {
    const min = Math.floor(sec / 60);
    const secRemain = Math.floor(sec % 60);
    const ms = Math.floor((sec * 1000) % 1000 / 10);
    return `${String(min).padStart(2, '0')}:${String(secRemain).padStart(2, '0')}:${String(ms).padStart(2, '0')}`;
}

// 캔버스 관련 함수들
function resizeCanvas() {
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
}

function drawGrid() {
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
    resizeCanvas();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ensureInitialDirectionNote();

    const bpm = parseFloat(document.getElementById("bpm").value || 120);
    const subdivisions = parseInt(document.getElementById("subdivisions").value || 16);
    const preDelaySeconds = getPreDelaySeconds();

    drawGrid();

    const directionNotes = notes.filter(n =>
        n.type === "direction" ||
        n.type === "both" ||
        n.type === "longdirection" ||
        n.type === "longboth"
    ).sort((a, b) => a.beat - b.beat);
    const pathDirectionNotes = directionNotes.map((note, index) => {
        let pathBeat;
        if (note.beat === 0 && note.type === "direction") {
            pathBeat = 0;
        } else {
            const originalTime = beatToTime(note.beat, bpm, subdivisions);
            const adjustedTime = originalTime + preDelaySeconds;
            pathBeat = timeToBeat(adjustedTime, bpm, subdivisions);
        }
        return {
            ...note,
            pathBeat: pathBeat
        };
    }).sort((a, b) => a.pathBeat - b.pathBeat);

    const nodePositions = [];
    let pos = {
        x: 0,
        y: 0
    };
    nodePositions.push(pos);
    const segmentBeats = [];

    ctx.beginPath();
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
        segmentBeats.push({
            start: a.pathBeat,
            end: b.pathBeat,
            from: {
                ...pos
            },
            to: {
                ...next
            }
        });
        pos = next;
        nodePositions.push(pos);
    }
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 2;
    ctx.stroke();

    const totalPathBeats = pathDirectionNotes[pathDirectionNotes.length - 1]?.pathBeat || 0;
    for (let beat = subdivisions; beat < totalPathBeats; beat += subdivisions) {
        for (let s of segmentBeats) {
            if (s.start <= beat && beat <= s.end) {
                const interp = (beat - s.start) / (s.end - s.start);
                const x = s.from.x + (s.to.x - s.from.x) * interp;
                const y = s.from.y + (s.to.y - s.from.y) * interp;
                ctx.beginPath();
                ctx.arc(x * zoom + viewOffset.x, y * zoom + viewOffset.y, 4, 0, 2 * Math.PI);
                ctx.fillStyle = "rgba(128,128,128,0.4)";
                ctx.fill();
                break;
            }
        }
    }

    notes.forEach((note, index) => {
        if (!note)
            return;
        if (note.beat === 0 && !(index === 0 && note.type === "direction"))
            return;

        let pathBeat;
        if (note.beat === 0 && note.type === "direction") {
            pathBeat = 0;
        } else {
            const originalTime = beatToTime(note.beat, bpm, subdivisions);
            const adjustedTime = originalTime + preDelaySeconds;
            pathBeat = timeToBeat(adjustedTime, bpm, subdivisions);
        }

        let i = 0;
        for (; i < pathDirectionNotes.length - 1; i++) {
            if (pathDirectionNotes[i].pathBeat <= pathBeat && pathBeat <= pathDirectionNotes[i + 1].pathBeat)
                break;
        }
        const a = pathDirectionNotes[i];
        const b = pathDirectionNotes[i + 1];
        const pa = nodePositions[i];
        const pb = nodePositions[i + 1];
        if (!a || !b || !pa || !pb || b.pathBeat === a.pathBeat)
            return;

        const interp = (pathBeat - a.pathBeat) / (b.pathBeat - a.pathBeat);
        const x = pa.x + (pb.x - pa.x) * interp;
        const y = pa.y + (pb.y - pa.y) * interp;
        const screenX = x * zoom + viewOffset.x;
        const screenY = y * zoom + viewOffset.y;

        if (note.type === "tab") {
            ctx.beginPath();
            ctx.arc(screenX, screenY, 5, 0, 2 * Math.PI);

            if (note.beat === 0 && note.type === "direction") {
                ctx.fillStyle = "red";
            } else {
                ctx.fillStyle = "#FF6B6B";
            }
            ctx.fill();

            if (!(note.beat === 0 && note.type === "direction")) {
                ctx.strokeStyle = "#4CAF50";
                ctx.lineWidth = 2;
                ctx.stroke();
            }
        }

        if (note.type === "direction") {
            const [dx, dy] = directionToVector(note.direction);
            const mag = Math.hypot(dx, dy) || 1;
            const ux = (dx / mag) * 16;
            const uy = (dy / mag) * 16;
            const endX = screenX + ux;
            const endY = screenY + uy;

            ctx.beginPath();
            ctx.moveTo(screenX, screenY);
            ctx.lineTo(endX, endY);

            if (note.beat === 0) {
                ctx.strokeStyle = "#f00";
            } else {
                ctx.strokeStyle = "#4CAF50";
            }
            ctx.lineWidth = 2;
            ctx.stroke();

            const perpX = -uy * 0.5;
            const perpY = ux * 0.5;
            ctx.beginPath();
            ctx.moveTo(endX, endY);
            ctx.lineTo(endX - ux * 0.4 + perpX, endY - uy * 0.4 + perpY);
            ctx.lineTo(endX - ux * 0.4 - perpX, endY - uy * 0.4 - perpY);
            ctx.closePath();

            if (note.beat === 0) {
                ctx.fillStyle = "#f00";
            } else {
                ctx.fillStyle = "#4CAF50";
            }
            ctx.fill();
        }

        if (note.type === "both") {
            ctx.beginPath();
            ctx.arc(screenX, screenY, 5, 0, 2 * Math.PI);
            ctx.fillStyle = "#9C27B0";
            ctx.fill();
            ctx.strokeStyle = "#4A148C";
            ctx.lineWidth = 2;
            ctx.stroke();

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
            ctx.lineWidth = 2;
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
        }

        if (note.type === "longtab") {
            ctx.beginPath();
            ctx.arc(screenX, screenY, 7, 0, 2 * Math.PI);
            ctx.fillStyle = "#FF5722";
            ctx.fill();
            ctx.strokeStyle = "#BF360C";
            ctx.lineWidth = 3;
            ctx.stroke();

            ctx.fillStyle = "white";
            ctx.font = "bold 8px Arial";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("L", screenX, screenY);

            if (note.longTime > 0) {
                // longTime(ms)을 비트 단위로 변환
                const bpm = parseFloat(document.getElementById("bpm").value || 120);
                const subdivisions = parseInt(document.getElementById("subdivisions").value || 16);
                const longTimeSeconds = note.longTime / 1000;
                const longTimeBeat = (longTimeSeconds * bpm * subdivisions) / 60;
                const endPathBeat = pathBeat + longTimeBeat;

                drawLongNoteBar(pathBeat, endPathBeat, pathDirectionNotes, nodePositions, "#FF5722", 8);

                let endPos = null;
                for (let i = 0; i < pathDirectionNotes.length - 1; i++) {
                    const a = pathDirectionNotes[i];
                    const b = pathDirectionNotes[i + 1];
                    if (a.pathBeat <= endPathBeat && endPathBeat <= b.pathBeat) {
                        const interp = (endPathBeat - a.pathBeat) / (b.pathBeat - a.pathBeat);
                        const pa = nodePositions[i];
                        const pb = nodePositions[i + 1];
                        endPos = {
                            x: pa.x + (pb.x - pa.x) * interp,
                            y: pa.y + (pb.y - pa.y) * interp
                        };
                        break;
                    }
                }

                if (endPos) {
                    const endScreenX = endPos.x * zoom + viewOffset.x;
                    const endScreenY = endPos.y * zoom + viewOffset.y;

                    ctx.beginPath();
                    ctx.arc(endScreenX, endScreenY, 6, 0, 2 * Math.PI);
                    ctx.fillStyle = "#BF360C";
                    ctx.fill();
                    ctx.strokeStyle = "white";
                    ctx.lineWidth = 2;
                    ctx.stroke();
                }
            }
        }

        if (note.type === "longdirection") {
            const [dx, dy] = directionToVector(note.direction);
            const mag = Math.hypot(dx, dy) || 1;
            const ux = (dx / mag) * 18;
            const uy = (dy / mag) * 18;
            const endX = screenX + ux;
            const endY = screenY + uy;

            ctx.beginPath();
            ctx.moveTo(screenX, screenY);
            ctx.lineTo(endX, endY);
            ctx.strokeStyle = "#03A9F4";
            ctx.lineWidth = 4;
            ctx.stroke();

            const perpX = -uy * 0.5;
            const perpY = ux * 0.5;
            ctx.beginPath();
            ctx.moveTo(endX, endY);
            ctx.lineTo(endX - ux * 0.4 + perpX, endY - uy * 0.4 + perpY);
            ctx.lineTo(endX - ux * 0.4 - perpX, endY - uy * 0.4 - perpY);
            ctx.closePath();
            ctx.fillStyle = "#03A9F4";
            ctx.fill();

            ctx.fillStyle = "white";
            ctx.font = "bold 8px Arial";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("L", screenX + ux * 0.3, screenY + uy * 0.3);

            if (note.longTime > 0) {
                // longTime(ms)을 비트 단위로 변환
                const bpm = parseFloat(document.getElementById("bpm").value || 120);
                const subdivisions = parseInt(document.getElementById("subdivisions").value || 16);
                const longTimeSeconds = note.longTime / 1000;
                const longTimeBeat = (longTimeSeconds * bpm * subdivisions) / 60;
                const endPathBeat = pathBeat + longTimeBeat;

                drawLongNoteBar(pathBeat, endPathBeat, pathDirectionNotes, nodePositions, "#03A9F4", 8);

                let endPos = null;
                for (let i = 0; i < pathDirectionNotes.length - 1; i++) {
                    const a = pathDirectionNotes[i];
                    const b = pathDirectionNotes[i + 1];
                    if (a.pathBeat <= endPathBeat && endPathBeat <= b.pathBeat) {
                        const interp = (endPathBeat - a.pathBeat) / (b.pathBeat - a.pathBeat);
                        const pa = nodePositions[i];
                        const pb = nodePositions[i + 1];
                        endPos = {
                            x: pa.x + (pb.x - pa.x) * interp,
                            y: pa.y + (pb.y - pa.y) * interp
                        };
                        break;
                    }
                }

                if (endPos) {
                    const endScreenX = endPos.x * zoom + viewOffset.x;
                    const endScreenY = endPos.y * zoom + viewOffset.y;

                    ctx.beginPath();
                    ctx.arc(endScreenX, endScreenY, 6, 0, 2 * Math.PI);
                    ctx.fillStyle = "#0277BD";
                    ctx.fill();
                    ctx.strokeStyle = "white";
                    ctx.lineWidth = 2;
                    ctx.stroke();
                }
            }
        }

        if (note.type === "longboth") {
            ctx.beginPath();
            ctx.arc(screenX, screenY, 7, 0, 2 * Math.PI);
            ctx.fillStyle = "#E91E63";
            ctx.fill();
            ctx.strokeStyle = "#880E4F";
            ctx.lineWidth = 3;
            ctx.stroke();

            const [dx, dy] = directionToVector(note.direction);
            const mag = Math.hypot(dx, dy) || 1;
            const ux = (dx / mag) * 18;
            const uy = (dy / mag) * 18;
            const endX = screenX + ux;
            const endY = screenY + uy;

            ctx.beginPath();
            ctx.moveTo(screenX, screenY);
            ctx.lineTo(endX, endY);
            ctx.strokeStyle = "#E91E63";
            ctx.lineWidth = 4;
            ctx.stroke();

            const perpX = -uy * 0.5;
            const perpY = ux * 0.5;
            ctx.beginPath();
            ctx.moveTo(endX, endY);
            ctx.lineTo(endX - ux * 0.4 + perpX, endY - uy * 0.4 + perpY);
            ctx.lineTo(endX - ux * 0.4 - perpX, endY - uy * 0.4 - perpY);
            ctx.closePath();
            ctx.fillStyle = "#E91E63";
            ctx.fill();

            ctx.fillStyle = "white";
            ctx.font = "bold 8px Arial";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("L", screenX, screenY);

            if (note.longTime > 0) {
                // longTime(ms)을 비트 단위로 변환
                const bpm = parseFloat(document.getElementById("bpm").value || 120);
                const subdivisions = parseInt(document.getElementById("subdivisions").value || 16);
                const longTimeSeconds = note.longTime / 1000;
                const longTimeBeat = (longTimeSeconds * bpm * subdivisions) / 60;
                const endPathBeat = pathBeat + longTimeBeat;

                drawLongNoteBar(pathBeat, endPathBeat, pathDirectionNotes, nodePositions, "#E91E63", 8);

                let endPos = null;
                for (let i = 0; i < pathDirectionNotes.length - 1; i++) {
                    const a = pathDirectionNotes[i];
                    const b = pathDirectionNotes[i + 1];
                    if (a.pathBeat <= endPathBeat && endPathBeat <= b.pathBeat) {
                        const interp = (endPathBeat - a.pathBeat) / (b.pathBeat - a.pathBeat);
                        const pa = nodePositions[i];
                        const pb = nodePositions[i + 1];
                        endPos = {
                            x: pa.x + (pb.x - pa.x) * interp,
                            y: pa.y + (pb.y - pa.y) * interp
                        };
                        break;
                    }
                }

                if (endPos) {
                    const endScreenX = endPos.x * zoom + viewOffset.x;
                    const endScreenY = endPos.y * zoom + viewOffset.y;

                    ctx.beginPath();
                    ctx.arc(endScreenX, endScreenY, 6, 0, 2 * Math.PI);
                    ctx.fillStyle = "#C2185B";
                    ctx.fill();
                    ctx.strokeStyle = "white";
                    ctx.lineWidth = 2;
                    ctx.stroke();
                }
            }
        }
    });

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
        let pathBeat;
        if (note.beat === 0 && note.type === "direction") {
            pathBeat = 0;
        } else {
            const originalTime = beatToTime(note.beat, bpm, subdivisions);
            const adjustedTime = originalTime + preDelaySeconds;
            pathBeat = timeToBeat(adjustedTime, bpm, subdivisions);
        }

        const pos = getNotePositionFromPathData(pathBeat, pathDirectionNotes, nodePositions);
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
        let pathBeat;
        if (note.beat === 0 && note.type === "direction") {
            pathBeat = 0;
        } else {
            const originalTime = beatToTime(note.beat, bpm, subdivisions);
            const adjustedTime = originalTime + preDelaySeconds;
            pathBeat = timeToBeat(adjustedTime, bpm, subdivisions);
        }

        const pos = getNotePositionFromPathData(pathBeat, pathDirectionNotes, nodePositions);
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
}

function ensureInitialDirectionNote() {
    if (!notes.find(n => n.beat === 0 && n.type === "direction")) {
        notes.unshift({
            type: "direction",
            beat: 0,
            direction: "none",
            isLong: false,
            longTime: 0
        });
    }
}

function drawLongNoteBar(startPathBeat, endPathBeat, pathDirectionNotes, nodePositions, color, lineWidth) {
    const subdivisions = parseInt(document.getElementById("subdivisions").value || 16);
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

function drawWaveform() {
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

    waveformCtx.fillStyle = '#4CAF50';
    const musicAreaWidth = width * (audioBuffer.duration / totalDuration);
    for (let i = 0; i < waveformData.length; i++) {
        const x = musicStartX + (i * musicAreaWidth / waveformData.length);
        const minHeight = waveformData[i].min * centerY;
        const maxHeight = waveformData[i].max * centerY;

        if (x >= musicStartX && x < width) {
            waveformCtx.fillRect(x, centerY - maxHeight, Math.max(1, musicAreaWidth / waveformData.length - 1), maxHeight);
            waveformCtx.fillRect(x, centerY, Math.max(1, musicAreaWidth / waveformData.length - 1), -minHeight);
        }
    }

    drawRuler();
}

function drawRuler() {
    if (!audioBuffer || !hasAudioFile)
        return;

    const width = rulerCanvas.width;
    const height = rulerCanvas.height;
    const preDelaySeconds = getPreDelaySeconds();
    const duration = MUSIC_START_TIME + audioBuffer.duration + preDelaySeconds;

    rulerCtx.clearRect(0, 0, width, height);

    rulerCtx.strokeStyle = '#666';
    rulerCtx.fillStyle = '#ccc';
    rulerCtx.font = '9px Arial';

    const pixelsPerSecond = width / duration;
    let timeInterval = 1;

    if (pixelsPerSecond < 30)
        timeInterval = 10;
    else if (pixelsPerSecond < 60)
        timeInterval = 5;
    else if (pixelsPerSecond < 120)
        timeInterval = 2;
    else if (pixelsPerSecond > 500)
        timeInterval = 0.1;
    else if (pixelsPerSecond > 250)
        timeInterval = 0.5;

    for (let time = 0; time <= duration; time += timeInterval) {
        const x = (time / duration) * width;
        const isSecond = time % 1 === 0;

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
    rulerCtx.lineTo(startX, height);
    rulerCtx.stroke();

    rulerCtx.fillStyle = '#ff4444';
    rulerCtx.font = 'bold 10px Arial';
    rulerCtx.fillText('음악 시작', startX + 2, 12);
    rulerCtx.font = '8px Arial';
    rulerCtx.fillText('(3초)', startX + 2, 22);
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
                    generateWaveformData(buffer);
                    drawWaveform();
                    saveToStorage();
                    
                    // 타임라인 새로고침
                    if (timelineManager && timelineManager.refresh) {
                        timelineManager.refresh();
                    }
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
        drawWaveform();
        saveToStorage();
        
        // 타임라인 새로고침
        if (timelineManager && timelineManager.refresh) {
            timelineManager.refresh();
        }
        
        URL.revokeObjectURL(url);
    });

    audio.addEventListener('error', () => {
        console.error('Audio element failed');
        hasAudioFile = false;
        savedAudioFile = null;
        audioBuffer = null;
        waveformData = null;
        drawWaveform();
        URL.revokeObjectURL(url);
    });

    setTimeout(() => {
        if (!audioBuffer || audioBuffer.duration === undefined) {
            console.warn('Audio loading timeout, clearing waveform');
            hasAudioFile = false;
            savedAudioFile = null;
            audioBuffer = null;
            waveformData = null;
            drawWaveform();
        }
    }, 5000);
}

function generateWaveformData(buffer) {
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

    const currentBeat = timeToBeat(elapsedTime, bpm, subdivisions);

    checkNoteHits(elapsedTime);

    if (!isNaN(demoAudio.duration)) {
        const totalTime = demoAudio.duration + getPreDelaySeconds();
        spanDemoTime.textContent = `${formatTime(elapsedTime)} / ${formatTime(totalTime)}`;
        seekbar.max = Math.round(totalTime * 1000);
        seekbar.value = Math.round(elapsedTime * 1000);
    }

    if (elapsedTime >= MUSIC_START_TIME) {
        demoAudio.play();
    }

    updateDemoPlayerPosition(currentBeat);

    if (isCameraTracking) {
        const targetX = canvas.width / 2 - demoPlayer.x * zoom;
        const targetY = canvas.height / 2 - demoPlayer.y * zoom;
        viewOffset.x = lerp(viewOffset.x, targetX, 0.1);
        viewOffset.y = lerp(viewOffset.y, targetY, 0.1);
    }

    drawPath();
    updateWaveformProgress();

    // 타임라인 재생 헤드 업데이트
    if (timelineManager && timelineManager.updatePlayhead) {
        timelineManager.updatePlayhead();
    }

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
    const bpm = parseFloat(document.getElementById("bpm").value || 120);
    const subdivisions = parseInt(document.getElementById("subdivisions").value || 16);
    const preDelaySeconds = getPreDelaySeconds();

    const tolerance = 0.05;

    notes.forEach((note, index) => {
        const noteId = `${note.type}-${note.beat}-${index}`;

        if (playedNotes.has(noteId))
            return;

        let targetTime;
        if (note.beat === 0 && note.type === "direction") {
            targetTime = 0;
            if (currentTime >= targetTime - tolerance && currentTime <= targetTime + tolerance) {
                playedNotes.add(noteId);
                highlightNoteHit(index);
                console.log(`0번 노트 통과 (효과음 없음): beat ${note.beat}, time ${currentTime.toFixed(3)}s`);
            }
            return;
        } else {
            const originalTime = beatToTime(note.beat, bpm, subdivisions);
            targetTime = originalTime + preDelaySeconds;
        }

        if (currentTime >= targetTime - tolerance &&
            currentTime <= targetTime + tolerance) {

            playNoteSound(note.type);
            playedNotes.add(noteId);
            highlightNoteHit(index);

            console.log(`Note hit: ${note.type} at beat ${note.beat}, time ${targetTime.toFixed(3)}s`);
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

function updateDemoPlayerPosition(currentBeat) {
    const bpm = parseFloat(document.getElementById("bpm").value || 120);
    const subdivisions = parseInt(document.getElementById("subdivisions").value || 16);
    const preDelaySeconds = getPreDelaySeconds();

    const directionNotes = notes.filter(n =>
        n.type === "direction" ||
        n.type === "both" ||
        n.type === "longdirection" ||
        n.type === "longboth"
    ).sort((a, b) => a.beat - b.beat);

    const pathDirectionNotes = directionNotes.map((note, index) => {
        let pathBeat;
        if (note.beat === 0 && note.type === "direction") {
            pathBeat = 0;
        } else {
            const originalTime = beatToTime(note.beat, bpm, subdivisions);
            const adjustedTime = originalTime + preDelaySeconds;
            pathBeat = timeToBeat(adjustedTime, bpm, subdivisions);
        }
        return {
            ...note,
            pathBeat: pathBeat
        };
    }).sort((a, b) => a.pathBeat - b.pathBeat);

    const nodePositions = [];
    let pos = {
        x: 0,
        y: 0
    };
    nodePositions.push(pos);
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
        pos = next;
        nodePositions.push(pos);
    }

    if (pathDirectionNotes.length >= 2) {
        for (let i = 1; i < pathDirectionNotes.length; i++) {
            const a = pathDirectionNotes[i - 1];
            const b = pathDirectionNotes[i];
            const pa = nodePositions[i - 1];
            const pb = nodePositions[i];

            if (currentBeat >= a.pathBeat && currentBeat <= b.pathBeat) {
                const t = (currentBeat - a.pathBeat) / (b.pathBeat - a.pathBeat);
                demoPlayer.x = pa.x + (pb.x - pa.x) * t;
                demoPlayer.y = pa.y + (pb.y - pa.y) * t;
                break;
            }
        }
    }
}

function getNotePositionFromPathData(pathBeat, pathDirectionNotes, nodePositions) {
    const subdivisions = parseInt(document.getElementById("subdivisions").value || 16);

    for (let i = 0; i < pathDirectionNotes.length - 1; i++) {
        const a = pathDirectionNotes[i];
        const b = pathDirectionNotes[i + 1];
        const pa = nodePositions[i];
        const pb = nodePositions[i + 1];

        if (a.pathBeat <= pathBeat && pathBeat <= b.pathBeat) {
            const interp = (pathBeat - a.pathBeat) / (b.pathBeat - a.pathBeat);
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

async function loadAudioFile() {
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

    const saveData = {
        notes: notes,
        bpm: bpmValue,
        subdivisions: subdivisionsValue,
        audioFileName: savedAudioFile ? savedAudioFile.name : null,
        audioFileSize: savedAudioFile ? savedAudioFile.size : null,
        audioFileType: savedAudioFile ? savedAudioFile.type : null,
        preDelay: preDelayValue
    };
    localStorage.setItem("autosave_notes", JSON.stringify(saveData));
}

function loadFromStorage() {
    const saved = localStorage.getItem("autosave_notes");
    if (saved) {
        try {
            const parsed = JSON.parse(saved);

            if (Array.isArray(parsed)) {
                notes.splice(0, notes.length, ...parsed);
                notes.forEach(note => {
                    if (note.isLong === undefined) note.isLong = false;
                    if (note.longTime === undefined) note.longTime = 0;
                });
            } else if (parsed.notes && Array.isArray(parsed.notes)) {
                notes.splice(0, notes.length, ...parsed.notes);
                notes.forEach(note => {
                    if (note.isLong === undefined) note.isLong = false;
                    if (note.longTime === undefined) note.longTime = 0;
                });

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

                loadAudioFile().then(audioFile => {
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

function validateChart(notes, bpm, subdivisions, preDelaySeconds) {
    const errors = [];
    const warnings = [];
    let validatedNotes = [...notes];

    validatedNotes.sort((a, b) => a.beat - b.beat);

    const beatCounts = {};
    validatedNotes.forEach(note => {
        beatCounts[note.beat] = (beatCounts[note.beat] || 0) + 1;
        if (beatCounts[note.beat] > 1) {
            errors.push(`비트 ${note.beat}에 중복된 노트가 있습니다.`);
        }
    });

    for (let i = 0; i < validatedNotes.length - 1; i++) {
        const currentNote = validatedNotes[i];
        const nextNote = validatedNotes[i + 1];

        const currentTime = beatToTime(currentNote.beat, bpm, subdivisions);
        const nextTime = beatToTime(nextNote.beat, bpm, subdivisions);
        const timeDiff = nextTime - currentTime;

        if (timeDiff < 0.08) {
            errors.push(`노트 ${i}번과 ${i + 1}번 사이 간격이 너무 짧습니다. (${timeDiff.toFixed(3)}초 < 0.08초)`);
        }
    }

    const longNoteRanges = [];
    validatedNotes.forEach((note, index) => {
        if (note.isLong && note.longTime > 0) {
            const startBeat = note.beat;
            const endBeat = note.beat + note.longTime;
            const noteType = note.type;

            longNoteRanges.push({
                index,
                startBeat,
                endBeat,
                type: noteType,
                note
            });
        }
    });

    for (let i = 0; i < longNoteRanges.length; i++) {
        const range1 = longNoteRanges[i];

        for (let j = i + 1; j < longNoteRanges.length; j++) {
            const range2 = longNoteRanges[j];

            const overlap = !(range1.endBeat <= range2.startBeat || range2.endBeat <= range1.startBeat);

            if (overlap) {
                if (range1.type === "longtab" && range2.type === "longtab") {
                    errors.push(`LongTab 노트끼리 겹칩니다. (${range1.startBeat}-${range1.endBeat} 비트와 ${range2.startBeat}-${range2.endBeat} 비트)`);
                }
                if (range1.type === "longdirection" && range2.type === "longdirection") {
                    errors.push(`LongDirection 노트끼리 겹칩니다. (${range1.startBeat}-${range1.endBeat} 비트와 ${range2.startBeat}-${range2.endBeat} 비트)`);
                }
                if (range1.type === "longboth" && (range2.type === "longdirection" || range2.type === "longtab" || range2.type === "longboth")) {
                    errors.push(`LongBoth 노트 구간에 다른 롱노트가 겹칩니다. (${range1.startBeat}-${range1.endBeat} 비트와 ${range2.startBeat}-${range2.endBeat} 비트)`);
                }
                if (range2.type === "longboth" && (range1.type === "longdirection" || range1.type === "longtab" || range1.type === "longboth")) {
                    errors.push(`LongBoth 노트 구간에 다른 롱노트가 겹칩니다. (${range2.startBeat}-${range2.endBeat} 비트와 ${range1.startBeat}-${range1.endBeat} 비트)`);
                }
            }
        }
    }

    longNoteRanges.forEach(longRange => {
        validatedNotes.forEach((note, index) => {
            if (!note.isLong && note.beat > longRange.startBeat && note.beat < longRange.endBeat) {
                if (longRange.type === "longboth" && note.type !== "tab") {
                    errors.push(`LongBoth 노트 구간(${longRange.startBeat}-${longRange.endBeat} 비트)에는 Tab 노트만 허용됩니다. ${note.beat} 비트의 ${note.type} 노트를 제거해주세요.`);
                }
            }
        });
    });

    if (validatedNotes.length > 0) {
        const lastNote = validatedNotes[validatedNotes.length - 1];
        const lastNoteBeat = lastNote.beat + (lastNote.isLong ? lastNote.longTime : 0);
        const lastNoteTime = beatToTime(lastNoteBeat, bpm, subdivisions);
        const endTime = lastNoteTime + 3.0;
        const endBeat = timeToBeat(endTime, bpm, subdivisions);

        const needsEndNote = !(lastNote.type === "direction" && lastNote.direction === "none");

        if (needsEndNote) {
            validatedNotes.push({
                type: "direction",
                beat: endBeat,
                direction: "none",
                isLong: false,
                longTime: 0
            });
            warnings.push(`마지막 노트 이후 3초 지점에 Direction/none 노트를 자동 추가했습니다. (${endBeat} 비트)`);
        }
    }

    const isValid = errors.length === 0;

    if (warnings.length > 0) {
        console.log('차트 검증 경고:', warnings);
    }

    return {
        isValid,
        errors,
        warnings,
        notes: validatedNotes
    };
}

// UI 관련 함수들
function renderNoteList() {
    const tbody = document.getElementById("note-list");
    tbody.innerHTML = "";

    const bpm = parseFloat(document.getElementById("bpm").value || 120);
    const subdivisions = parseInt(document.getElementById("subdivisions").value || 16);
    const preDelaySeconds = getPreDelaySeconds();

    // 중복 beat 값 감지
    const beatCounts = {};
    const duplicateBeats = new Set();
    notes.forEach(note => {
        beatCounts[note.beat] = (beatCounts[note.beat] || 0) + 1;
        if (beatCounts[note.beat] > 1) {
            duplicateBeats.add(note.beat);
        }
    });

    notes.forEach((note, index) => {
        const tr = document.createElement("tr");
        let className = "tab-note";
        if (note.type === "direction" || note.type === "longdirection") {
            className = "dir-note";
        } else if (note.type === "both" || note.type === "longboth") {
            className = "both-note";
        } else if (note.type === "longtab") {
            className = "long-tab-note";
        }
        tr.className = className;
        if (index === selectedNoteIndex) {
            tr.classList.add("highlight");
        }
        
        // 중복 beat 값인 경우 빨간색으로 표시
        if (duplicateBeats.has(note.beat)) {
            tr.classList.add("duplicate-beat");
        }

        const tdIndex = document.createElement("td");
        tdIndex.textContent = index;

        const tdType = document.createElement("td");
        let typeDisplay = note.type;
        switch (note.type) {
            case "longtab": typeDisplay = "LTab"; break;
            case "longdirection": typeDisplay = "LDir"; break;
            case "longboth": typeDisplay = "LBoth"; break;
        }
        tdType.textContent = typeDisplay;

        const tdBeat = document.createElement("td");
        const inputBeat = document.createElement("input");
        inputBeat.type = "number";
        inputBeat.step = "1";
        inputBeat.value = note.beat;
        inputBeat.addEventListener("change", () => {
            const oldBeat = note.beat;
            const newBeat = parseInt(inputBeat.value);
            const diff = newBeat - oldBeat;

            if (isBatchEditEnabled) {
                notes.forEach((n, i) => {
                    if (i > index) {
                        n.beat += diff;
                    }
                });
            }
            note.beat = newBeat;

            saveToStorage();
            drawPath();
            renderNoteList();
            if (waveformData)
                drawWaveform();
        });
        tdBeat.appendChild(inputBeat);

        const tdTime = document.createElement("td");
        const originalTime = beatToTime(note.beat, bpm, subdivisions);

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
                note.longTime = parseInt(inputLongTime.value) || subdivisions;
                saveToStorage();
                drawPath();
                if (waveformData)
                    drawWaveform();
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
                note.direction = select.value;
                saveToStorage();
                drawPath();
                if (waveformData)
                    drawWaveform();
            });
            tdDir.appendChild(select);
        } else {
            tdDir.textContent = "-";
        }

        const tdDelete = document.createElement("td");
        const btn = document.createElement("button");
        btn.textContent = "삭제";
        btn.disabled = (note.beat === 0 && note.type === "direction" && index === 0);
        btn.addEventListener("click", () => {
            notes.splice(index, 1);
            saveToStorage();
            drawPath();
            renderNoteList();
            if (waveformData)
                drawWaveform();
        });
        tdDelete.appendChild(btn);

        tr.append(tdIndex, tdType, tdBeat, tdTime, tdLong, tdDir, tdDelete);
        tr.addEventListener("click", (e) => {
            if (["INPUT", "SELECT", "BUTTON"].includes(e.target.tagName))
                return;
            focusNoteAtIndex(index);
        });
        tbody.appendChild(tr);
    });
}

function focusNoteAtIndex(index) {
    if (index < 0 || index >= notes.length) {
        selectedNoteIndex = null;
        drawPath();
        renderNoteList();
        return;
    }

    // 타임라인 매니저가 아직 초기화되지 않은 경우에 대한 안전 장치
    if (!timelineManager || !timelineManager.track) {
        console.warn('타임라인 매니저가 아직 초기화되지 않았습니다.');
        selectedNoteIndex = index;
        drawPath();
        return;
    }

    selectedNoteIndex = index;
    console.log('focusNoteAtIndex - selectedNoteIndex set to:', selectedNoteIndex);
    const note = notes[index];

    const bpm = parseFloat(document.getElementById("bpm").value || 120);
    const subdivisions = parseInt(document.getElementById("subdivisions").value || 16);
    const preDelaySeconds = getPreDelaySeconds();

    let pathBeat;
    if (note.beat === 0 && note.type === "direction") {
        pathBeat = 0;
    } else {
        const originalTime = beatToTime(note.beat, bpm, subdivisions);
        const adjustedTime = originalTime + preDelaySeconds;
        pathBeat = timeToBeat(adjustedTime, bpm, subdivisions);
    }

    const directionNotes = notes.filter(n =>
        n.type === "direction" ||
        n.type === "both" ||
        n.type === "longdirection" ||
        n.type === "longboth"
    ).sort((a, b) => a.beat - b.beat);

    const pathDirectionNotes = directionNotes.map((n, i) => {
        let pBeat;
        if (n.beat === 0 && n.type === "direction") {
            pBeat = 0;
        } else {
            const originalTime = beatToTime(n.beat, bpm, subdivisions);
            const adjustedTime = originalTime + preDelaySeconds;
            pBeat = timeToBeat(adjustedTime, bpm, subdivisions);
        }
        return { ...n, pathBeat: pBeat };
    }).sort((a, b) => a.pathBeat - b.pathBeat);

    const nodePositions = [];
    let pos = { x: 0, y: 0 };
    nodePositions.push(pos);
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
        pos = next;
        nodePositions.push(pos);
    }

    const noteCanvasPos = getNotePositionFromPathData(pathBeat, pathDirectionNotes, nodePositions);

    if (noteCanvasPos) {
        viewOffset.x = canvas.width / 2 - noteCanvasPos.x * zoom;
        viewOffset.y = canvas.height / 2 - noteCanvasPos.y * zoom;
    }

    // 타임라인 노트 하이라이트 업데이트
    if (timelineManager && timelineManager.track) {
        const timelineNotes = timelineManager.track.querySelectorAll('.timeline-note');
        timelineNotes.forEach((noteElement, i) => {
            const noteIndex = parseInt(noteElement.dataset.noteIndex);
            if (noteIndex === index) {
                noteElement.classList.add("selected");
                timelineManager.selectedNoteElement = noteElement;
                
                // 타임라인에서 해당 노트 위치로 스크롤
                const noteLeft = parseFloat(noteElement.style.left) || 0;
                const containerWidth = timelineManager.container.clientWidth;
                const targetScroll = Math.max(0, noteLeft + timelineManager.scrollOffset - containerWidth * 0.5);
                const maxScroll = Math.max(0, timelineManager.totalDuration * timelineManager.pixelsPerSecond - containerWidth);
                timelineManager.scrollOffset = Math.min(targetScroll, maxScroll);
                
                if (maxScroll > 0) {
                    timelineManager.scrollbar.value = (timelineManager.scrollOffset / maxScroll) * 100;
                }
                timelineManager.updateTimelineView();
            } else {
                noteElement.classList.remove("selected");
            }
        });
    }

    drawPath();
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
        drawWaveform();
        updateWaveformSlider();
    });

    zoomOutBtn.addEventListener('click', () => {
        waveformZoom = Math.max(waveformZoom / 2, 0.25);
        updateZoomLevel();
        drawWaveform();
        updateWaveformSlider();
    });

    resetBtn.addEventListener('click', () => {
        waveformZoom = 1;
        waveformOffset = 0;
        updateZoomLevel();
        drawWaveform();
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

            drawWaveform();
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
    const timelineContainer = document.getElementById('timeline-container');

    sidebarToggle.addEventListener('click', () => {
        const isHidden = sidebar.classList.contains('hidden');

        if (isHidden) {
            sidebar.classList.remove('hidden');
            sidebarToggle.classList.remove('hidden');
            main.classList.remove('sidebar-hidden');
            if (waveformContainer) waveformContainer.classList.remove('sidebar-hidden');
            if (waveformTriggerZone) waveformTriggerZone.classList.remove('sidebar-hidden');
            if (timelineContainer) timelineContainer.classList.remove('sidebar-hidden');
            sidebarToggle.textContent = '◀';
        } else {
            sidebar.classList.add('hidden');
            sidebarToggle.classList.add('hidden');
            main.classList.add('sidebar-hidden');
            if (waveformContainer) waveformContainer.classList.add('sidebar-hidden');
            if (waveformTriggerZone) waveformTriggerZone.classList.add('sidebar-hidden');
            if (timelineContainer) timelineContainer.classList.add('sidebar-hidden');
            sidebarToggle.textContent = '▶';
        }

        setTimeout(() => {
            resizeCanvas();
            if (waveformData) {
                resizeWaveformCanvas();
                drawWaveform();
            }
            drawPath();
            
            // 타임라인 새로고침
            if (timelineManager && timelineManager.refresh) {
                timelineManager.refresh();
            }
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
            const originalTime = beatToTime(note.beat, bpm, subdivisions);
            const adjustedTime = originalTime + preDelaySeconds;
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
    if (highlightedNoteTimer > 0) {
        highlightedNoteTimer -= 1 / 60;
        if (highlightedNoteTimer <= 0) {
            highlightedNoteIndex = null;
            highlightedNoteTimer = 0;
        }
        drawPath();
    }

    if (pathHighlightTimer > 0) {
        pathHighlightTimer -= 1 / 60;
        if (pathHighlightTimer <= 0) {
            pathHighlightTimer = 0;
        }
        drawPath();
    }

    if (highlightedNoteTimer > 0 || pathHighlightTimer > 0) {
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
        insertionIndex = notes.length;
        const maxBeat = Math.max(0, ...notes.map(n => n.beat + (n.isLong ? (n.longTime || 0) : 0)));
        newBeat = maxBeat + subdivisions;
    }

    const newNote = {
        ...noteProps,
        beat: newBeat,
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

    notes.splice(insertionIndex, 0, newNote);

    saveToStorage();
    drawPath();
    renderNoteList();
    if (waveformData) drawWaveform();
    
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

    ensureInitialDirectionNote();
}

// BPM 필드 변경 핸들러
function handleBpmChange(newBpm) {
    const oldBpm = parseFloat(document.getElementById("bpm").dataset.previousValue || 120);
    const subdivisions = parseInt(document.getElementById("subdivisions").value || 16);

    console.log(`BPM changed from ${oldBpm} to ${newBpm}`);

    if (oldBpm !== newBpm && notes.length > 0) {
        updateNotesForTimeBasedChange(oldBpm, subdivisions, newBpm, subdivisions);
    }

    document.getElementById("bpm").dataset.previousValue = newBpm;

    saveToStorage();
    drawPath();
    renderNoteList();
    if (waveformData)
        drawWaveform();
    
    // 타임라인 새로고침
    if (timelineManager && timelineManager.refresh) {
        timelineManager.refresh();
    }
}

// Subdivisions 필드 변경 핸들러
function handleSubdivisionsChange(newSubdivisions) {
    const bpm = parseFloat(document.getElementById("bpm").value || 120);
    const oldSubdivisions = parseInt(document.getElementById("subdivisions").dataset.previousValue || 16);

    console.log(`Subdivisions changed from ${oldSubdivisions} to ${newSubdivisions}`);

    if (oldSubdivisions !== newSubdivisions && notes.length > 0) {
        updateNotesForTimeBasedChange(bpm, oldSubdivisions, bpm, newSubdivisions);
    }

    document.getElementById("subdivisions").dataset.previousValue = newSubdivisions;

    saveToStorage();
    drawPath();
    renderNoteList();
    if (waveformData)
        drawWaveform();
    
    // 타임라인 새로고침
    if (timelineManager && timelineManager.refresh) {
        timelineManager.refresh();
    }
}

// Pre-delay 변경 핸들러
function handlePreDelayChange() {
    console.log(`Pre-delay changed to ${getPreDelaySeconds()}s`);

    saveToStorage();
    renderNoteList();
    if (waveformData)
        drawWaveform();
}

// 초기화
document.addEventListener("DOMContentLoaded", async () => {
    console.log('DOM loaded, initializing...');

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

    document.getElementById("clear-notes").addEventListener("click", () => {
        if (confirm("모든 데이터를 삭제하시겠습니까?")) {
            localStorage.removeItem("autosave_notes");
            notes.length = 0;
            ensureInitialDirectionNote();
            drawPath();
            renderNoteList();
        }
    });


    document.getElementById("sort-notes").addEventListener("click", () => {
        notes.sort((a, b) => a.beat - b.beat);
        saveToStorage();
        drawPath();
        renderNoteList();
    });

    document.getElementById("save-json").addEventListener("click", () => {
        const bpm = parseFloat(document.getElementById("bpm").value || 120);
        const subdivisions = parseInt(document.getElementById("subdivisions").value || 16);
        const preDelayValue = parseInt(document.getElementById("pre-delay").value || 0);
        const preDelaySeconds = preDelayValue / 1000;

        const validationResult = validateChart(notes, bpm, subdivisions, preDelaySeconds);
        if (!validationResult.isValid) {
            alert(`차트 검증 실패:\n\n${validationResult.errors.join('\n')}\n\n수정 후 다시 시도해주세요.`);
            return;
        }

        const validatedNotes = validationResult.notes;

        const exportData = {
            diffIndex: 5,
            level: 10,
            bpm: bpm,
            subdivisions: subdivisions,
            preDelay: preDelayValue,
            noteList: validatedNotes.map(n => {
                const originalTime = beatToTime(n.beat, bpm, subdivisions);

                let finalTime;
                if (n.beat === 0 && n.type === "direction") {
                    finalTime = originalTime;
                } else {
                    finalTime = originalTime + preDelaySeconds;
                }

                let noteType;
                switch (n.type) {
                    case "tab": noteType = "Tab"; break;
                    case "direction": noteType = "Direction"; break;
                    case "both": noteType = "Both"; break;
                    case "longtab": noteType = "LongTab"; break;
                    case "longdirection": noteType = "LongDirection"; break;
                    case "longboth": noteType = "LongBoth"; break;
                    default: noteType = "Tab"; break;
                }

                let longTimeInSeconds = 0;
                if (n.isLong && n.longTime > 0) {
                    longTimeInSeconds = beatToTime(n.longTime, bpm, subdivisions);
                }

                return {
                    beat: n.beat,
                    originalTime: originalTime,
                    musicTime: MUSIC_START_TIME + originalTime,
                    finalTime: finalTime,
                    isLong: n.isLong || false,
                    longTime: longTimeInSeconds,
                    longTimeBeat: n.longTime || 0,
                    noteType: noteType,
                    direction: n.direction || "none"
                };
            }),
            metadata: {
                description: "Music starts at 3 seconds, with pre-delay correction",
                timingExplanation: "finalTime = 3.0 + originalTime + preDelay (except for beat 0 direction note)",
                preDelayUnit: "milliseconds",
                longTimeUnit: "longTime values are in seconds, longTimeBeat values are in beats",
                validationApplied: "Chart validated and auto-corrected",
                exportedAt: new Date().toISOString()
            }
        };

        const blob = new Blob([JSON.stringify(exportData, null, 2)], {
            type: "application/json"
        });
        const url = URL.createObjectURL(blob);

        const a = document.createElement("a");
        a.href = url;
        a.download = "chart_3s_music_start.json";
        a.click();

        URL.revokeObjectURL(url);
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

                        let type;
                        switch (n.noteType) {
                            case "Tab": type = "tab"; break;
                            case "Direction": type = "direction"; break;
                            case "Both": type = "both"; break;
                            case "LongTab": type = "longtab"; break;
                            case "LongDirection": type = "longdirection"; break;
                            case "LongBoth": type = "longboth"; break;
                            default: type = "tab"; break;
                        }

                        let longTimeBeat = 0;
                        if (n.longTimeBeat !== undefined) {
                            longTimeBeat = n.longTimeBeat;
                        } else if (n.longTime !== undefined && n.longTime > 0) {
                            longTimeBeat = timeToBeat(n.longTime, bpm, subdivisions);
                        }

                        notes.push({
                            type: type,
                            beat: beat,
                            direction: n.direction || "none",
                            isLong: n.isLong || false,
                            longTime: longTimeBeat
                        });
                    });

                    document.getElementById("bpm").value = bpm;
                    document.getElementById("subdivisions").value = subdivisions;
                    document.getElementById("pre-delay").value = preDelayMs;

                    document.getElementById("bpm").dataset.previousValue = bpm;
                    document.getElementById("subdivisions").dataset.previousValue = subdivisions;

                    saveToStorage();
                    drawPath();
                    renderNoteList();
                    if (waveformData)
                        drawWaveform();
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
            drawWaveform();

            const container = inputAudio.parentElement;
            const indicator = container.querySelector('.file-indicator');
            if (indicator)
                indicator.remove();

            saveToStorage();
            
            // 타임라인 새로고침 (오디오 파일 제거 시)
            if (timelineManager && timelineManager.refresh) {
                timelineManager.refresh();
            }
            
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

        playedNotes.clear();

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
            drawWaveform();
        }
    });

    setupVolumeControls();
    setupToggleFeatures();
    setupNoteButtons();

    ensureInitialDirectionNote();
    loadFromStorage();

    loadNoteSounds();

    drawPath();
    renderNoteList();

    // 키보드 단축키
    document.addEventListener('keydown', (e) => {
        // 입력 필드나 버튼에 포커스가 있을 때는 단축키 작동 안 함
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'BUTTON') {
            return;
        }

        switch (e.key) {
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

    console.log('Initialization complete');
});

// =================================================================
// 타임라인 관리자
// =================================================================

let timelineManager = {
    container: null,
    track: null,
    ruler: null,
    scrollbar: null,
    playhead: null,
    waveformCanvas: null,
    waveformCtx: null,
    cursorNeedle: null,
    totalDuration: 0,
    pixelsPerSecond: 100,
    minPixelsPerSecond: 20,
    maxPixelsPerSecond: 500,
    scrollOffset: 0,
    draggedNote: null,
    dragOffset: { x: 0, y: 0 },
    selectedNoteElement: null,
    isDraggingTimeline: false,
    timelineDragStart: { x: 0, scrollOffset: 0 },

    init() {
        this.container = document.getElementById('timeline-container');
        this.track = document.getElementById('timeline-track');
        this.ruler = document.getElementById('timeline-ruler');
        this.scrollbar = document.getElementById('timeline-slider');
        this.waveformCanvas = document.getElementById('timeline-waveform-canvas');
        this.waveformCtx = this.waveformCanvas ? this.waveformCanvas.getContext('2d') : null;
        
        if (!this.container || !this.track || !this.ruler || !this.scrollbar) {
            console.error('타임라인 요소를 찾을 수 없습니다.');
            return;
        }

        this.setupEventListeners();
        this.updateTimelineDuration();
        this.renderTimeline();
        
        console.log('타임라인 초기화 완료');
    },

    setupEventListeners() {
        // 스크롤바 이벤트
        this.scrollbar.addEventListener('input', (e) => {
            this.scrollOffset = (parseFloat(e.target.value) / 100) * Math.max(0, this.totalDuration * this.pixelsPerSecond - this.container.clientWidth);
            this.updateTimelineView();
        });

        // 타임라인 클릭 이벤트
        this.track.addEventListener('click', (e) => {
            if (e.target === this.track) {
                this.deselectAllNotes();
            }
        });
        
        // 컨테이너 클릭시에도 선택 해제
        this.container.addEventListener('click', (e) => {
            if (e.target === this.container || e.target === this.ruler) {
                this.deselectAllNotes();
            }
        });

        // 키보드 이벤트
        document.addEventListener('keydown', (e) => {
            if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedNoteElement) {
                this.deleteSelectedNote();
                e.preventDefault();
            }
        });

        // 마우스 커서 바늘 이벤트
        this.container.addEventListener('mouseenter', () => {
            this.showCursorNeedle();
        });

        this.container.addEventListener('mouseleave', () => {
            this.hideCursorNeedle();
        });

        this.container.addEventListener('mousemove', (e) => {
            this.updateCursorNeedle(e);
        });

        // 마우스 휠 확대/축소 이벤트
        this.container.addEventListener('wheel', (e) => {
            e.preventDefault();
            this.handleZoom(e);
        });

        // 타임라인 패닝 이벤트 - ruler도 드래그 가능하도록 추가
        this.container.addEventListener('mousedown', (e) => {
            if (e.target === this.track || e.target === this.container || e.target === this.ruler) {
                this.startTimelineDrag(e);
            }
        });

        document.addEventListener('mousemove', (e) => {
            if (this.isDraggingTimeline) {
                this.updateTimelineDrag(e);
            }
        });

        document.addEventListener('mouseup', (e) => {
            if (this.isDraggingTimeline) {
                this.endTimelineDrag(e);
            }
        });
    },

    updateTimelineDuration() {
        const preDelaySeconds = getPreDelaySeconds ? getPreDelaySeconds() : 0;
        const audioDuration = audioBuffer && audioBuffer.duration ? audioBuffer.duration : 60;
        this.totalDuration = 3 + audioDuration + preDelaySeconds; // MUSIC_START_TIME + 오디오 길이 + pre-delay
        
        // 초기 픽셀 비율은 기본값 사용 (수동 줌 우선)
        if (this.pixelsPerSecond === 100) { // 초기값인 경우에만 자동 조정
            const containerWidth = this.container.clientWidth;
            this.pixelsPerSecond = Math.max(this.minPixelsPerSecond, 
                Math.min(this.maxPixelsPerSecond, containerWidth / this.totalDuration));
        }
    },

    renderTimeline() {
        this.renderWaveform();
        this.renderRuler();
        this.renderNotes();
        this.updatePlayhead();
    },

    renderRuler() {
        if (!this.ruler) return;
        
        this.ruler.innerHTML = '';
        
        // 컨테이너 너비와 총 길이 중 더 큰 값을 사용하여 항상 전체 영역 커버
        const calculatedWidth = this.totalDuration * this.pixelsPerSecond;
        const containerWidth = this.container.clientWidth;
        const rulerWidth = Math.max(calculatedWidth, containerWidth);
        this.ruler.style.width = rulerWidth + 'px';
        
        // 눈금 생성 - 더 촘촘하게, 비트값과 시간값 함께 표시
        let tickInterval = 0.25; // 기본 0.25초 간격 (매우 촘촘하게)
        let labelInterval = 1; // 1초마다 라벨
        
        if (this.pixelsPerSecond >= 300) {
            tickInterval = 0.1; // 0.1초 간격
            labelInterval = 0.5; // 0.5초마다 라벨
        } else if (this.pixelsPerSecond >= 200) {
            tickInterval = 0.25; // 0.25초 간격
            labelInterval = 1; // 1초마다 라벨
        } else if (this.pixelsPerSecond >= 100) {
            tickInterval = 0.5; // 0.5초 간격
            labelInterval = 2; // 2초마다 라벨
        } else if (this.pixelsPerSecond >= 50) {
            tickInterval = 1; // 1초 간격
            labelInterval = 5; // 5초마다 라벨
        } else {
            tickInterval = 2; // 2초 간격
            labelInterval = 10; // 10초마다 라벨
        }
        
        const bpm = parseInt(document.getElementById('bpm')?.value || 120);
        const subdivisions = parseInt(document.getElementById('subdivisions')?.value || 16);
        
        for (let time = 0; time <= this.totalDuration; time += tickInterval) {
            const x = time * this.pixelsPerSecond;
            
            const tick = document.createElement('div');
            tick.className = 'timeline-tick' + (time % (labelInterval * 4) === 0 ? ' major' : '');
            tick.style.left = x + 'px';
            this.ruler.appendChild(tick);
            
            if (time % labelInterval === 0) {
                const label = document.createElement('div');
                label.className = 'timeline-tick-label';
                label.style.left = x + 'px';
                
                // 비트값 계산 (pre-delay와 MUSIC_START_TIME 고려)
                const preDelaySeconds = getPreDelaySeconds ? getPreDelaySeconds() : 0;
                const adjustedTime = time - 3 - preDelaySeconds; // MUSIC_START_TIME과 pre-delay 제외
                const beat = Math.max(0, Math.round((adjustedTime * bpm * subdivisions) / 60));
                
                // 시간과 비트값을 함께 표시
                const timeStr = this.formatTime(time);
                label.innerHTML = `${timeStr}<br>B:${beat}`;
                label.style.lineHeight = '1.1';
                
                this.ruler.appendChild(label);
            }
        }
    },

    renderNotes() {
        if (!this.track) return;
        
        // 기존 노트 요소들 제거
        const existingNotes = this.track.querySelectorAll('.timeline-note');
        existingNotes.forEach(note => note.remove());
        
        // 노트들을 원본 인덱스와 함께 시간순으로 정렬
        const notesWithIndex = notes.map((note, originalIndex) => ({
            note: note,
            originalIndex: originalIndex,
            time: this.beatToTime(note.beat)
        }));
        
        notesWithIndex.sort((a, b) => a.time - b.time);
        
        notesWithIndex.forEach((item) => {
            const noteElement = this.createNoteElement(item.note, item.originalIndex);
            this.track.appendChild(noteElement);
        });
        
        // 트랙 너비도 ruler와 동일하게 설정
        const calculatedWidth = this.totalDuration * this.pixelsPerSecond;
        const containerWidth = this.container.clientWidth;
        const trackWidth = Math.max(calculatedWidth, containerWidth);
        this.track.style.width = trackWidth + 'px';
        
        this.updateTimelineView();
    },

    createNoteElement(note, index) {
        const noteElement = document.createElement('div');
        noteElement.className = `timeline-note ${note.type}`;
        noteElement.dataset.noteIndex = index;
        
        // 노트 객체 자체를 참조로 저장 (디버깅용)
        noteElement._noteRef = note;
        
        const time = this.beatToTime(note.beat);
        const x = time * this.pixelsPerSecond;
        noteElement.style.left = x + 'px';
        
        // 롱 노트의 경우 길이 설정
        if (note.isLong && note.longTime) {
            const longDuration = note.longTime / 1000; // ms를 s로 변환
            const width = Math.max(20, longDuration * this.pixelsPerSecond);
            noteElement.style.width = width + 'px';
        }
        
        // 툴팁 이벤트 설정 (body에 직접 추가하는 방식)
        let tooltip = null;
        
        noteElement.addEventListener('mouseenter', (e) => {
            // 기존 툴팁이 있으면 제거
            if (tooltip) {
                document.body.removeChild(tooltip);
            }
            
            // 새 툴팁 생성
            tooltip = document.createElement('div');
            tooltip.className = 'timeline-note-tooltip';
            tooltip.style.position = 'fixed';
            tooltip.style.zIndex = '99999';
            tooltip.style.opacity = '1';
            
            // 비트값과 시간값 표시
            if (note.isLong && note.longTime) {
                const startBeat = note.beat;
                const startTime = time;
                const endTime = startTime + (note.longTime / 1000);
                const endBeat = this.timeToBeat(endTime);
                
                tooltip.innerHTML = `Start: Beat ${startBeat}, ${this.formatTime(startTime)}<br>End: Beat ${endBeat}, ${this.formatTime(endTime)}<br>Duration: ${note.longTime}ms`;
            } else {
                const timeStr = this.formatTime(time);
                tooltip.innerHTML = `Beat: ${note.beat}<br>Time: ${timeStr}`;
            }
            
            // body에 추가
            document.body.appendChild(tooltip);
            
            // 위치 계산
            const rect = noteElement.getBoundingClientRect();
            const tooltipRect = tooltip.getBoundingClientRect();
            
            // 노트 위쪽에 표시
            const left = rect.left + rect.width / 2 - tooltipRect.width / 2;
            const top = rect.top - tooltipRect.height - 10;
            
            tooltip.style.left = Math.max(10, left) + 'px';
            tooltip.style.top = Math.max(10, top) + 'px';
        });
        
        noteElement.addEventListener('mouseleave', () => {
            // 드래그 중이 아닐 때만 툴팁 제거
            if (!noteElement.classList.contains('dragging')) {
                if (tooltip && document.body.contains(tooltip)) {
                    document.body.removeChild(tooltip);
                    tooltip = null;
                }
            }
        });
        
        // 툴팁 업데이트 함수
        const updateTooltip = () => {
            if (tooltip) {
                const currentTime = this.beatToTime(note.beat);
                const timeStr = this.formatTime(currentTime);
                
                if (note.isLong && note.longTime) {
                    const startBeat = note.beat;
                    const startTime = currentTime;
                    const endTime = startTime + (note.longTime / 1000);
                    const endBeat = this.timeToBeat(endTime);
                    
                    tooltip.innerHTML = `Start: Beat ${startBeat}, ${this.formatTime(startTime)}<br>End: Beat ${endBeat}, ${this.formatTime(endTime)}<br>Duration: ${note.longTime}ms`;
                } else {
                    tooltip.innerHTML = `Beat: ${note.beat}<br>Time: ${timeStr}`;
                }
            }
        };
        
        // 노트 참조에 업데이트 함수 저장
        noteElement._updateTooltip = updateTooltip;
        
        // 일반 노트는 내용 숨김 (세로선 형태이므로)
        if (!note.isLong) {
            // 일반 노트는 텍스트 표시하지 않음
        } else {
            // 롱 노트만 내용 표시
            const content = document.createElement('div');
            content.textContent = note.beat.toString();
            noteElement.appendChild(content);
        }
        
        // 드래그 이벤트 설정
        this.setupNoteDragEvents(noteElement);
        
        // 롱 노트인 경우 리사이즈 핸들 추가
        if (note.isLong) {
            this.setupLongNoteResize(noteElement, note);
        }
        
        return noteElement;
    },

    setupNoteDragEvents(noteElement) {
        let isDragging = false;
        let startX = 0;
        let startY = 0;
        let originalX = 0;
        
        noteElement.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            originalX = parseFloat(noteElement.style.left) || 0;
            
            noteElement.classList.add('dragging');
            this.selectNote(noteElement);
            
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
        
        const onMouseMove = (e) => {
            if (!isDragging) return;
            
            const deltaX = e.clientX - startX;
            let newX = Math.max(0, originalX + deltaX);
            const maxX = this.totalDuration * this.pixelsPerSecond - noteElement.offsetWidth;
            newX = Math.min(newX, maxX);
            
            // 스냅 기능: subdivision에 따라 그리드에 맞춤
            const subdivisions = parseInt(document.getElementById("subdivisions")?.value || 16);
            const bpm = parseFloat(document.getElementById("bpm")?.value || 120);
            const beatPixelWidth = (60 / (bpm * subdivisions)) * this.pixelsPerSecond;
            
            if (beatPixelWidth > 5) { // 충분히 큰 경우에만 스냅 적용
                const snapX = Math.round(newX / beatPixelWidth) * beatPixelWidth;
                newX = snapX;
            }
            
            noteElement.style.left = newX + 'px';
            
            // 실시간으로 beat 정보 표시 및 툴팁 업데이트
            const newTime = newX / this.pixelsPerSecond;
            const newBeat = this.timeToBeat(newTime);
            noteElement.title = `Beat: ${newBeat}, Time: ${this.formatTime(newTime)}`;
            
            // 드래그 중에도 노트 데이터 업데이트 (실시간)
            const noteRef = noteElement._noteRef;
            if (noteRef) {
                noteRef.beat = newBeat;
                // 툴팁 업데이트
                if (noteElement._updateTooltip) {
                    noteElement._updateTooltip();
                }
                // 선택된 노트인 경우 사이드바 정보 업데이트
                if (noteElement.classList.contains('selected')) {
                    const noteIndex = parseInt(noteElement.dataset.noteIndex);
                    this.updateSelectedNoteInfo(noteRef, noteIndex);
                }
            }
        };
        
        const onMouseUp = (e) => {
            if (!isDragging) return;
            
            isDragging = false;
            noteElement.classList.remove('dragging');
            
            // 최종 위치를 beat로 변환하여 노트 업데이트
            const finalX = parseFloat(noteElement.style.left);
            const finalTime = finalX / this.pixelsPerSecond;
            const finalBeat = this.timeToBeat(finalTime);
            
            // 노트 객체 직접 참조를 사용하여 beat 업데이트
            const noteRef = noteElement._noteRef;
            if (noteRef && finalBeat >= 0) {
                const originalBeat = noteRef.beat;
                noteRef.beat = finalBeat;
                
                console.log(`노트 이동: Beat ${originalBeat} → ${finalBeat}, Time: ${this.formatTime(finalTime)}`);
                
                this.renderNotes(); // 다시 렌더링하여 정렬 적용
                
                // 캔버스 업데이트 (기존 함수들 호출)
                if (typeof drawPath === 'function') drawPath();
                if (typeof saveToStorage === 'function') saveToStorage();
            } else {
                // 잘못된 위치면 원래 위치로 복원
                noteElement.style.left = originalX + 'px';
            }
            
            // 드래그 완료 후 툴팁 제거 (마우스가 노트 밖에 있는 경우)
            setTimeout(() => {
                const rect = noteElement.getBoundingClientRect();
                const mouseInside = e.clientX >= rect.left && e.clientX <= rect.right && 
                                  e.clientY >= rect.top && e.clientY <= rect.bottom;
                if (!mouseInside) {
                    const tooltips = document.querySelectorAll('.timeline-note-tooltip');
                    tooltips.forEach(tip => {
                        if (document.body.contains(tip)) {
                            document.body.removeChild(tip);
                        }
                    });
                }
            }, 100);
            
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };
        
        // 노트 선택 이벤트
        noteElement.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!isDragging) {
                this.selectNote(noteElement);
            }
        });
    },

    setupLongNoteResize(noteElement, note) {
        // 좌측 끝에 리사이즈 핸들 추가
        const leftResizeHandle = document.createElement('div');
        leftResizeHandle.className = 'long-note-resize-handle-left';
        leftResizeHandle.style.cssText = `
            position: absolute;
            left: -5px;
            top: 0;
            width: 10px;
            height: 100%;
            cursor: ew-resize;
            background: rgba(255, 255, 255, 0.3);
            opacity: 0;
            transition: opacity 0.2s;
        `;
        
        // 우측 끝에 리사이즈 핸들 추가
        const rightResizeHandle = document.createElement('div');
        rightResizeHandle.className = 'long-note-resize-handle-right';
        rightResizeHandle.style.cssText = `
            position: absolute;
            right: -5px;
            top: 0;
            width: 10px;
            height: 100%;
            cursor: ew-resize;
            background: rgba(255, 255, 255, 0.3);
            opacity: 0;
            transition: opacity 0.2s;
        `;
        
        noteElement.appendChild(leftResizeHandle);
        noteElement.appendChild(rightResizeHandle);
        
        // 마우스 오버시 핸들 표시
        noteElement.addEventListener('mouseenter', () => {
            leftResizeHandle.style.opacity = '1';
            rightResizeHandle.style.opacity = '1';
        });
        
        noteElement.addEventListener('mouseleave', () => {
            leftResizeHandle.style.opacity = '0';
            rightResizeHandle.style.opacity = '0';
        });
        
        // 우측 리사이즈 이벤트
        let isRightResizing = false;
        let rightStartX = 0;
        let rightOriginalWidth = 0;
        
        rightResizeHandle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            isRightResizing = true;
            rightStartX = e.clientX;
            rightOriginalWidth = noteElement.offsetWidth;
            
            document.addEventListener('mousemove', onRightResizeMove);
            document.addEventListener('mouseup', onRightResizeUp);
        });
        
        const onRightResizeMove = (e) => {
            if (!isRightResizing) return;
            
            const deltaX = e.clientX - rightStartX;
            const newWidth = Math.max(20, rightOriginalWidth + deltaX);
            
            noteElement.style.width = newWidth + 'px';
            
            // longTime 업데이트
            const newDuration = (newWidth / this.pixelsPerSecond) * 1000; // ms로 변환
            note.longTime = Math.round(newDuration);
            
            // 툴팁 업데이트
            if (noteElement._updateTooltip) {
                noteElement._updateTooltip();
            }
            
            // 선택된 노트인 경우 사이드바 정보 업데이트
            if (noteElement.classList.contains('selected')) {
                const noteIndex = parseInt(noteElement.dataset.noteIndex);
                this.updateSelectedNoteInfo(note, noteIndex);
            }
        };
        
        const onRightResizeUp = (e) => {
            if (!isRightResizing) return;
            
            isRightResizing = false;
            console.log(`롱노트 우측 크기 조정: ${note.longTime}ms`);
            
            document.removeEventListener('mousemove', onRightResizeMove);
            document.removeEventListener('mouseup', onRightResizeUp);
        };
        
        // 좌측 리사이즈 이벤트
        let isLeftResizing = false;
        let leftStartX = 0;
        let leftOriginalLeft = 0;
        let leftOriginalWidth = 0;
        
        leftResizeHandle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            isLeftResizing = true;
            leftStartX = e.clientX;
            leftOriginalLeft = parseFloat(noteElement.style.left) || 0;
            leftOriginalWidth = noteElement.offsetWidth;
            
            document.addEventListener('mousemove', onLeftResizeMove);
            document.addEventListener('mouseup', onLeftResizeUp);
        });
        
        const onLeftResizeMove = (e) => {
            if (!isLeftResizing) return;
            
            const deltaX = e.clientX - leftStartX;
            const newLeft = leftOriginalLeft + deltaX;
            const newWidth = Math.max(20, leftOriginalWidth - deltaX);
            
            // 최소 너비 보장
            if (newWidth >= 20) {
                noteElement.style.left = newLeft + 'px';
                noteElement.style.width = newWidth + 'px';
                
                // 노트 시작 위치와 길이 업데이트
                const newTime = newLeft / this.pixelsPerSecond;
                const newBeat = this.timeToBeat(newTime);
                
                // 노트 객체 업데이트
                note.beat = newBeat;
                const newDuration = (newWidth / this.pixelsPerSecond) * 1000; // ms로 변환
                note.longTime = Math.round(newDuration);
                
                // 툴팁 업데이트
                if (noteElement._updateTooltip) {
                    noteElement._updateTooltip();
                }
                
                // 선택된 노트인 경우 사이드바 정보 업데이트
                if (noteElement.classList.contains('selected')) {
                    const noteIndex = parseInt(noteElement.dataset.noteIndex);
                    this.updateSelectedNoteInfo(note, noteIndex);
                }
            }
        };
        
        const onLeftResizeUp = (e) => {
            if (!isLeftResizing) return;
            
            isLeftResizing = false;
            console.log(`롱노트 좌측 크기 조정: Beat ${note.beat}, Duration ${note.longTime}ms`);
            
            // 노트 재정렬 (시간 순서가 바뀔 수 있으므로)
            this.renderNotes();
            
            document.removeEventListener('mousemove', onLeftResizeMove);
            document.removeEventListener('mouseup', onLeftResizeUp);
        };
    },

    selectNote(noteElement) {
        this.deselectAllNotes();
        noteElement.classList.add('selected');
        this.selectedNoteElement = noteElement;
        
        // 기존 선택 로직과 연동
        const noteIndex = parseInt(noteElement.dataset.noteIndex);
        if (typeof focusNoteAtIndex === 'function') {
            selectedNoteIndex = noteIndex;
        }
        
        // 선택된 노트 정보를 사이드바에 표시
        this.updateSelectedNoteInfo(noteElement._noteRef, noteIndex);
    },

    deselectAllNotes() {
        const selectedNotes = this.track.querySelectorAll('.timeline-note.selected');
        selectedNotes.forEach(note => note.classList.remove('selected'));
        this.selectedNoteElement = null;
        
        // 사이드바 선택 정보 숨김
        this.hideSelectedNoteInfo();
    },

    updateSelectedNoteInfo(note, noteIndex) {
        const infoPanel = document.getElementById('selected-note-info');
        const noteDetails = document.getElementById('note-details');
        const directionSelector = document.getElementById('direction-selector');
        const noteDirectionSelect = document.getElementById('note-direction');
        
        if (!infoPanel || !noteDetails) return;
        
        // 노트 기본 정보 표시
        const time = this.beatToTime(note.beat);
        let infoHtml = `
            <div><strong>Index:</strong> ${noteIndex}</div>
            <div><strong>Type:</strong> ${note.type}</div>
            <div><strong>Beat:</strong> ${note.beat}</div>
            <div><strong>Time:</strong> ${this.formatTime(time)}</div>
        `;
        
        if (note.isLong && note.longTime) {
            const endTime = time + (note.longTime / 1000);
            const endBeat = this.timeToBeat(endTime);
            infoHtml += `
                <div><strong>Duration:</strong> ${note.longTime}ms</div>
                <div><strong>End Beat:</strong> ${endBeat}</div>
                <div><strong>End Time:</strong> ${this.formatTime(endTime)}</div>
            `;
        }
        
        if (note.direction && note.direction !== 'none') {
            infoHtml += `<div><strong>Direction:</strong> ${note.direction}</div>`;
        }
        
        noteDetails.innerHTML = infoHtml;
        
        // 방향 선택기 표시 여부 결정
        const hasDirection = note.type === 'direction' || note.type === 'both' || 
                           note.type === 'longdirection' || note.type === 'longboth';
        
        if (hasDirection) {
            directionSelector.style.display = 'block';
            noteDirectionSelect.value = note.direction || 'none';
            
            // 방향 변경 이벤트 리스너 (기존 리스너 제거 후 새로 추가)
            const newSelect = noteDirectionSelect.cloneNode(true);
            noteDirectionSelect.parentNode.replaceChild(newSelect, noteDirectionSelect);
            
            newSelect.addEventListener('change', (e) => {
                note.direction = e.target.value;
                // 정보 패널 업데이트
                this.updateSelectedNoteInfo(note, noteIndex);
                // 캔버스 업데이트
                if (typeof drawPath === 'function') drawPath();
                if (typeof saveToStorage === 'function') saveToStorage();
            });
        } else {
            directionSelector.style.display = 'none';
        }
        
        infoPanel.style.display = 'block';
    },

    hideSelectedNoteInfo() {
        const infoPanel = document.getElementById('selected-note-info');
        if (infoPanel) {
            infoPanel.style.display = 'none';
        }
    },

    deleteSelectedNote() {
        if (!this.selectedNoteElement) return;
        
        // 노트 객체 직접 참조를 사용하여 삭제
        const noteRef = this.selectedNoteElement._noteRef;
        if (noteRef) {
            const noteIndex = notes.indexOf(noteRef);
            if (noteIndex !== -1) {
                notes.splice(noteIndex, 1);
                this.renderNotes();
                
                // 캔버스 업데이트
                if (typeof drawPath === 'function') drawPath();
                if (typeof saveToStorage === 'function') saveToStorage();
            }
        }
        
        this.selectedNoteElement = null;
    },

    updateTimelineView() {
        if (!this.track || !this.ruler) return;
        
        this.track.style.transform = `translateX(-${this.scrollOffset}px)`;
        this.ruler.style.transform = `translateX(-${this.scrollOffset}px)`;
        
        // waveform도 다시 그리기 (스크롤 반영)
        this.renderWaveform();
    },

    updatePlayhead() {
        if (!isPlaying || !this.track) return;
        
        let playheadElement = this.track.querySelector('.timeline-playhead');
        if (!playheadElement) {
            playheadElement = document.createElement('div');
            playheadElement.className = 'timeline-playhead';
            this.track.appendChild(playheadElement);
        }
        
        // 타임라인의 노트들은 MUSIC_START_TIME(3초) + pre-delay 위치에 배치됨
        // 재생 헤드는 elapsedTime + MUSIC_START_TIME 위치에 있어야 노트와 일치
        const currentElapsedTime = elapsedTime || 0;
        const timelineTime = currentElapsedTime + 3; // MUSIC_START_TIME 추가
        
        const x = timelineTime * this.pixelsPerSecond;
        const displayX = x - this.scrollOffset;
        playheadElement.style.left = displayX + 'px';
        
        // 자동 스크롤
        const containerWidth = this.container.clientWidth;
        if (displayX > containerWidth * 0.8 || displayX < containerWidth * 0.2) {
            this.scrollOffset = Math.max(0, x - containerWidth * 0.5);
            const maxScroll = Math.max(0, this.totalDuration * this.pixelsPerSecond - containerWidth);
            this.scrollOffset = Math.min(this.scrollOffset, maxScroll);
            
            if (maxScroll > 0) {
                this.scrollbar.value = (this.scrollOffset / maxScroll) * 100;
            }
            this.updateTimelineView();
        }
    },

    beatToTime(beat) {
        const bpm = parseFloat(document.getElementById("bpm")?.value || 120);
        const subdivisions = parseInt(document.getElementById("subdivisions")?.value || 16);
        const preDelaySeconds = getPreDelaySeconds ? getPreDelaySeconds() : 0;
        
        // 기존 beatToTime 함수와 동일하게 계산 후 타임라인 오프셋 추가
        const beatTime = (beat * 60) / (bpm * subdivisions);
        return beatTime + 3 + preDelaySeconds; // MUSIC_START_TIME + pre-delay 포함
    },

    timeToBeat(time) {
        const bpm = parseFloat(document.getElementById("bpm")?.value || 120);
        const subdivisions = parseInt(document.getElementById("subdivisions")?.value || 16);
        const preDelaySeconds = getPreDelaySeconds ? getPreDelaySeconds() : 0;
        
        // 타임라인 오프셋을 제거한 실제 음악 시간으로 변환
        const adjustedTime = time - 3 - preDelaySeconds; // MUSIC_START_TIME과 pre-delay 제외
        const beat = (adjustedTime * bpm * subdivisions) / 60;
        return Math.max(0, Math.round(beat)); // 음수 방지
    },

    formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        const ms = Math.floor((seconds * 1000) % 1000);
        return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
    },

    renderWaveform() {
        if (!this.waveformCanvas || !this.waveformCtx) return;
        
        // 캔버스 크기 설정
        const rect = this.waveformCanvas.getBoundingClientRect();
        this.waveformCanvas.width = rect.width;
        this.waveformCanvas.height = rect.height;
        
        const ctx = this.waveformCtx;
        const width = this.waveformCanvas.width;
        const height = this.waveformCanvas.height;
        
        // 캔버스 초기화
        ctx.clearRect(0, 0, width, height);
        
        // waveformData가 없으면 간단한 그라데이션으로 대체
        if (!waveformData || !audioBuffer) {
            const gradient = ctx.createLinearGradient(0, 0, width, 0);
            gradient.addColorStop(0, 'rgba(76, 175, 80, 0.1)');
            gradient.addColorStop(0.5, 'rgba(76, 175, 80, 0.3)');
            gradient.addColorStop(1, 'rgba(76, 175, 80, 0.1)');
            
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, width, height);
            return;
        }
        
        // 실제 waveform 데이터 그리기
        const totalWidth = this.totalDuration * this.pixelsPerSecond;
        const preDelaySeconds = getPreDelaySeconds ? getPreDelaySeconds() : 0;
        const musicStartTime = 3 + preDelaySeconds; // MUSIC_START_TIME + pre-delay
        const musicStartX = (musicStartTime / this.totalDuration) * totalWidth;
        const musicWidth = (audioBuffer.duration / this.totalDuration) * totalWidth;
        
        // waveform 데이터를 타임라인 크기에 맞게 조정
        const samplesPerPixel = Math.max(1, Math.floor(waveformData.length / musicWidth));
        
        ctx.fillStyle = 'rgba(76, 175, 80, 0.6)';
        ctx.strokeStyle = 'rgba(76, 175, 80, 0.8)';
        ctx.lineWidth = 1;
        
        // 음악 영역만 그리기
        const visibleStartX = Math.max(0, this.scrollOffset);
        const visibleEndX = Math.min(totalWidth, this.scrollOffset + width);
        
        if (musicStartX < visibleEndX && (musicStartX + musicWidth) > visibleStartX) {
            ctx.beginPath();
            ctx.moveTo(Math.max(0, musicStartX - this.scrollOffset), height / 2);
            
            for (let x = Math.max(musicStartX, visibleStartX); x < Math.min(musicStartX + musicWidth, visibleEndX); x += 2) {
                const dataIndex = Math.floor(((x - musicStartX) / musicWidth) * waveformData.length);
                if (dataIndex >= 0 && dataIndex < waveformData.length) {
                    const amplitude = waveformData[dataIndex] || 0;
                    const y = height / 2 + (amplitude * height / 4);
                    ctx.lineTo(x - this.scrollOffset, y);
                }
            }
            
            ctx.lineTo(Math.min(musicStartX + musicWidth, visibleEndX) - this.scrollOffset, height / 2);
            ctx.stroke();
            
            // 채우기 효과
            ctx.lineTo(Math.min(musicStartX + musicWidth, visibleEndX) - this.scrollOffset, height);
            ctx.lineTo(Math.max(0, musicStartX - this.scrollOffset), height);
            ctx.closePath();
            ctx.fill();
        }
    },

    // 외부에서 호출할 수 있는 업데이트 함수들
    refresh() {
        this.updateTimelineDuration();
        this.renderTimeline();
    },

    addNote(noteProps) {
        // 기존 addNote 함수 호출 후 타임라인 업데이트
        this.renderNotes();
    },

    // 커서 바늘 관련 함수들
    showCursorNeedle() {
        if (!this.cursorNeedle) {
            this.cursorNeedle = document.createElement('div');
            this.cursorNeedle.className = 'timeline-cursor-needle';
            this.track.appendChild(this.cursorNeedle);
        }
        this.cursorNeedle.style.display = 'block';
    },

    hideCursorNeedle() {
        if (this.cursorNeedle) {
            this.cursorNeedle.style.display = 'none';
        }
    },

    updateCursorNeedle(e) {
        if (!this.cursorNeedle || this.isDraggingTimeline) return;

        const rect = this.container.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const timelineX = mouseX + this.scrollOffset;
        const time = timelineX / this.pixelsPerSecond;
        const beat = this.timeToBeat(time);

        // 바늘 위치 업데이트 (마우스 위치와 정확히 일치하도록 스크롤 오프셋 고려)
        this.cursorNeedle.style.left = timelineX + 'px';
        
        // 시간 정보 표시
        const timeText = `${this.formatTime(time)} (Beat: ${Math.max(0, beat)})`;
        this.cursorNeedle.setAttribute('data-time', timeText);
    },

    // 줌 핸들러
    handleZoom(e) {
        const rect = this.container.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseTimelineX = mouseX + this.scrollOffset;
        const mouseTime = mouseTimelineX / this.pixelsPerSecond;

        // 줌 팩터 계산
        const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
        const newPixelsPerSecond = Math.min(this.maxPixelsPerSecond, 
            Math.max(this.minPixelsPerSecond, this.pixelsPerSecond * zoomFactor));

        if (newPixelsPerSecond === this.pixelsPerSecond) return; // 변화 없음

        // 마우스 위치를 중심으로 줌
        const oldPixelsPerSecond = this.pixelsPerSecond;
        this.pixelsPerSecond = newPixelsPerSecond;

        // 스크롤 위치 조정 (마우스 위치 기준으로)
        const newMouseTimelineX = mouseTime * this.pixelsPerSecond;
        const newScrollOffset = newMouseTimelineX - mouseX;
        
        // 스크롤 범위 제한
        const maxScroll = Math.max(0, this.totalDuration * this.pixelsPerSecond - this.container.clientWidth);
        this.scrollOffset = Math.max(0, Math.min(newScrollOffset, maxScroll));

        // 스크롤바 업데이트
        if (maxScroll > 0) {
            this.scrollbar.value = (this.scrollOffset / maxScroll) * 100;
        } else {
            this.scrollbar.value = 0;
        }

        // 렌더링 업데이트
        this.renderTimeline();

        console.log(`줌: ${oldPixelsPerSecond.toFixed(1)} → ${this.pixelsPerSecond.toFixed(1)} px/s`);
    },

    // 타임라인 패닝 함수들
    startTimelineDrag(e) {
        this.isDraggingTimeline = true;
        this.timelineDragStart.x = e.clientX;
        this.timelineDragStart.scrollOffset = this.scrollOffset;
        this.container.style.cursor = 'grabbing';
        e.preventDefault();
    },

    updateTimelineDrag(e) {
        if (!this.isDraggingTimeline) return;

        const deltaX = e.clientX - this.timelineDragStart.x;
        const newScrollOffset = this.timelineDragStart.scrollOffset - deltaX;

        // 스크롤 범위 제한
        const maxScroll = Math.max(0, this.totalDuration * this.pixelsPerSecond - this.container.clientWidth);
        this.scrollOffset = Math.max(0, Math.min(newScrollOffset, maxScroll));

        // 스크롤바 업데이트
        if (maxScroll > 0) {
            this.scrollbar.value = (this.scrollOffset / maxScroll) * 100;
        } else {
            this.scrollbar.value = 0;
        }

        this.updateTimelineView();
    },

    endTimelineDrag(e) {
        this.isDraggingTimeline = false;
        this.container.style.cursor = 'default';
    }
};

// 기존 함수들과의 통합을 위한 래퍼 함수들
function renderNoteList() {
    // 기존 테이블 렌더링 대신 타임라인 렌더링
    if (timelineManager && timelineManager.renderNotes) {
        timelineManager.renderNotes();
    }
}

// 기존 addNote 함수를 확장
const originalAddNote = window.addNote;
if (originalAddNote) {
    window.addNote = function(noteProps) {
        const result = originalAddNote.call(this, noteProps);
        if (timelineManager) {
            timelineManager.addNote(noteProps);
        }
        return result;
    };
}

// 초기화
document.addEventListener('DOMContentLoaded', () => {
    // 기존 초기화 후에 타임라인 초기화
    setTimeout(() => {
        if (timelineManager) {
            timelineManager.init();
        }
    }, 100);
});

// 전역 접근을 위한 노출
window.timelineManager = timelineManager;