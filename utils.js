// 유틸리티 함수들

// 선형 보간
export function lerp(start, end, amt) {
    return (1 - amt) * start + amt * end;
}

// 노트의 BPM과 subdivision을 가져오는 함수
export function getNoteTimingParams(note, globalBpm = 120, globalSubdivisions = 16) {
    return {
        bpm: note.bpm || globalBpm,
        subdivisions: note.subdivisions || globalSubdivisions
    };
}

// 노트 타입을 외부 형식으로 변환
export function convertNoteTypeToExternal(type) {
    const typeMap = {
        "tab": "Tab",
        "direction": "Direction", 
        "both": "Both",
        "longtab": "LongTab",
        "longdirection": "LongDirection",
        "longboth": "LongBoth",
        "node": "Node"
    };
    return typeMap[type] || "Tab";
}

// 외부 형식을 노트 타입으로 변환
export function convertExternalToNoteType(external) {
    const typeMap = {
        "Tab": "tab",
        "Direction": "direction",
        "Both": "both", 
        "LongTab": "longtab",
        "LongDirection": "longdirection",
        "LongBoth": "longboth",
        "Node": "node"
    };
    return typeMap[external] || "tab";
}

// Long Note의 시간을 계산하는 함수
export function calculateLongNoteTime(note, globalBpm, globalSubdivisions) {
    if (!note.longTime || note.longTime <= 0) return 0;
    
    const timing = getNoteTimingParams(note, globalBpm, globalSubdivisions);
    return beatToTime(note.longTime, timing.bpm, timing.subdivisions);
}

// pathBeat 계산 함수
export function calculatePathBeat(note, preDelaySeconds, globalBpm, globalSubdivisions) {
    if (note.beat === 0 && note.type === "direction") {
        return 0;
    } else {
        const timing = getNoteTimingParams(note, globalBpm, globalSubdivisions);
        const originalTime = beatToTime(note.beat, timing.bpm, timing.subdivisions);
        const adjustedTime = originalTime + preDelaySeconds;
        return timeToBeat(adjustedTime, globalBpm, globalSubdivisions);
    }
}

// 시간을 비트로 변환
export function timeToBeat(time, bpm, subdivisions) {
    const beatDuration = 60 / bpm;
    const subdivisionDuration = beatDuration / subdivisions;
    return time / subdivisionDuration;
}

// 비트를 시간으로 변환
export function beatToTime(beat, bpm, subdivisions) {
    const beatDuration = 60 / bpm;
    const subdivisionDuration = beatDuration / subdivisions;
    return beat * subdivisionDuration;
}

// 방향을 벡터로 변환
export function directionToVector(direction) {
    const directions = {
        "up": [0, -1],
        "down": [0, 1],
        "left": [-1, 0],
        "right": [1, 0],
        "upleft": [-1, -1],
        "upright": [1, -1],
        "downleft": [-1, 1],
        "downright": [1, 1]
    };
    return directions[direction] || [0, 0];
}

// Pre-delay 초 단위로 가져오기
export function getPreDelaySeconds() {
    const preDelayMs = parseInt(document.getElementById("pre-delay").value || 0);
    return preDelayMs / 1000;
}

// Unity 게임 좌표계 변환 함수들
// Unity 공식: distance = deltaTime × multiplierConstant × bpm
// multiplierConstant = 8 × 배속 × 0.05 = 0.4 × 배속

// Unity에서 1비트 동안의 이동거리 계산 (정확한 공식)
export function calculateUnityMovementPerBeat(bpm, speedMultiplier = 1.0) {
    // 1비트 = 60초 / (BPM × subdivisions/4)
    // 기본 subdivisions = 16이므로 4분음표 기준
    const beatDuration = 60 / bpm; // 1beat의 시간 (초)
    const multiplierConstant = 0.4 * speedMultiplier; // 8 × 배속 × 0.05

    // Unity 공식: distance = deltaTime × multiplierConstant × bpm
    return beatDuration * multiplierConstant * bpm;
}

// Unity 월드 좌표에서 노드 간 거리 계산
export function calculateUnityNodeDistance(deltaTime, bpm, speedMultiplier = 1.0) {
    const multiplierConstant = 0.4 * speedMultiplier;
    return deltaTime * multiplierConstant * bpm;
}

// 에디터 좌표를 Unity 월드 좌표로 변환
export function convertEditorToUnityCoordinate(editorDistance, bpm, speedMultiplier = 1.0) {
    const unityMovementPerBeat = calculateUnityMovementPerBeat(bpm, speedMultiplier);
    const editorMovementPerBeat = 24 * speedMultiplier; // 에디터의 현재 공식

    // 변환 비율
    const ratio = unityMovementPerBeat / editorMovementPerBeat;
    return editorDistance * ratio;
}

// Unity 월드 좌표를 에디터 좌표로 변환
export function convertUnityToEditorCoordinate(unityDistance, bpm, speedMultiplier = 1.0) {
    const unityMovementPerBeat = calculateUnityMovementPerBeat(bpm, speedMultiplier);
    const editorMovementPerBeat = 24 * speedMultiplier; // 에디터의 현재 공식

    // 변환 비율
    const ratio = editorMovementPerBeat / unityMovementPerBeat;
    return unityDistance * ratio;
}

// Unity에서 노트의 정확한 위치 계산 (Lerp 방식)
export function calculateUnityNotePosition(noteTime, previousNodeTime, nextNodeTime,
    previousNodePosition, nextNodePosition) {

    if (nextNodeTime === previousNodeTime) {
        return { ...previousNodePosition };
    }

    const t = (noteTime - previousNodeTime) / (nextNodeTime - previousNodeTime);
    const clampedT = Math.max(0, Math.min(1, t));

    return {
        x: previousNodePosition.x + (nextNodePosition.x - previousNodePosition.x) * clampedT,
        y: previousNodePosition.y + (nextNodePosition.y - previousNodePosition.y) * clampedT
    };
}

// Unity 방향 벡터 정규화
export function normalizeDirection(direction) {
    const [dx, dy] = directionToVector(direction);
    const magnitude = Math.hypot(dx, dy);

    if (magnitude === 0) return [0, 0];

    return [dx / magnitude, dy / magnitude];
}