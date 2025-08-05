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