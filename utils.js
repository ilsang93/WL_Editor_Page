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

// pathBeat 계산 함수 (_sectionOffset 지원)
export function calculatePathBeat(note, preDelaySeconds, globalBpm, globalSubdivisions) {
    const sectionOffset = note._sectionOffset || 0;
    if (note.beat === 0 && note.type === "direction" && sectionOffset === 0) {
        return 0;
    } else {
        const timing = getNoteTimingParams(note, globalBpm, globalSubdivisions);
        const originalTime = sectionOffset + beatToTime(note.beat, timing.bpm, timing.subdivisions);
        const adjustedTime = originalTime + preDelaySeconds;
        return timeToBeat(adjustedTime, globalBpm, globalSubdivisions);
    }
}

// 구간 번호(sectionIndex)를 각 노트에 부여 (배열 순서 기준)
// beatReset=true인 노트를 만날 때마다 구간 번호 1 증가
// 이 함수는 배열 순서가 변경될 때마다 호출해야 함 (노트 추가/삭제/정렬/beatReset 변경 시)
export function recomputeSectionIndices(notes) {
    let currentSection = 0;
    for (let i = 0; i < notes.length; i++) {
        notes[i].sectionIndex = currentSection;
        if (notes[i].beatReset) {
            currentSection++;
        }
    }
}

// 구간(section) 오프셋 계산 함수
// sectionIndex가 설정된 경우: 배열 순서에 독립적인 방식으로 계산 (정렬 안정성 보장)
// sectionIndex 미설정: 배열 순서 기반 계산 (레거시 폴백)
// offsets[i] = i번 노트의 구간 시작 절대시간(초)
export function calculateSectionOffsets(notes, globalBpm, globalSubdivisions) {
    if (notes.length === 0) return [];

    // sectionIndex 기반 계산 (정렬 이후에도 안정적)
    if (notes[0].sectionIndex !== undefined) {
        // 각 구간의 시작 절대시간을 beatReset 노트에서 계산
        const sectionStartTimes = new Map([[0, 0]]);

        for (const note of notes) {
            if (note.beatReset) {
                const sIdx = note.sectionIndex;
                if (!sectionStartTimes.has(sIdx + 1)) {
                    const prevOffset = sectionStartTimes.get(sIdx) || 0;
                    const bpm = note.bpm || globalBpm;
                    const subs = note.subdivisions || globalSubdivisions;
                    sectionStartTimes.set(sIdx + 1, prevOffset + beatToTime(note.beat, bpm, subs));
                }
            }
        }

        return notes.map(n => sectionStartTimes.get(n.sectionIndex) || 0);
    }

    // 레거시 폴백: 배열 순서 기반 계산
    const offsets = new Array(notes.length).fill(0);
    let currentOffset = 0;
    for (let i = 0; i < notes.length; i++) {
        offsets[i] = currentOffset;
        const note = notes[i];
        if (note.beatReset) {
            const bpm = note.bpm || globalBpm;
            const subs = note.subdivisions || globalSubdivisions;
            currentOffset += beatToTime(note.beat, bpm, subs);
        }
    }
    return offsets;
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

// BPM fade를 고려한 진행도 계산 (Unity StageUtils.CalculateFadeProgress와 동일)
// normalizedTime: 0~1 사이의 시간 진행도
// startBpm: 시작 BPM, endBpm: 끝 BPM
// 반환값: 실제 이동 거리 진행도 (0~1)
export function calculateFadeProgress(normalizedTime, startBpm, endBpm) {
    // v(t) = startBpm + (endBpm - startBpm) * t (선형 BPM 변화)
    // 거리 = ∫v(t)dt = startBpm*t + (endBpm - startBpm)*t²/2
    // 정규화된 총 거리 = startBpm + (endBpm - startBpm)/2 = (startBpm + endBpm)/2

    const t = normalizedTime;

    // 전체 구간의 총 거리 (t=1일 때)
    const totalDistance = (startBpm + endBpm) / 2;

    // 방어 코드: totalDistance가 0이면 선형 보간으로 fallback
    if (Math.abs(totalDistance) < 0.001) {
        return t;
    }

    // 현재 시점까지의 누적 거리
    const currentDistance = startBpm * t + (endBpm - startBpm) * t * t / 2;

    // 거리 진행도 반환
    return currentDistance / totalDistance;
}