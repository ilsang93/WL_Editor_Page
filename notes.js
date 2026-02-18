// 노트 관리 관련 함수들
import {
    getNoteTimingParams,
    convertNoteTypeToExternal,
    convertExternalToNoteType,
    calculateLongNoteTime,
    beatToTime,
    timeToBeat,
    calculateSectionOffsets,
    recomputeSectionIndices
} from './utils.js';

const MUSIC_START_TIME = 3.0;

// 노트 검증
export function validateNote(note, globalBpm, globalSubdivisions) {
    const errors = [];
    
    if (typeof note.beat !== 'number' || isNaN(note.beat)) {
        errors.push('Invalid beat value');
    }
    
    if (!note.type || typeof note.type !== 'string') {
        errors.push('Invalid note type');
    }
    
    if (note.type.includes('direction') || note.type.includes('both')) {
        if (!note.direction || typeof note.direction !== 'string') {
            errors.push('Direction notes must have a valid direction');
        }
    }
    
    if (note.isLong && (!note.longTime || note.longTime <= 0)) {
        errors.push('Long notes must have positive longTime');
    }
    
    return {
        isValid: errors.length === 0,
        errors
    };
}

// 차트 전체 검증
export function validateChart(notes, globalBpm, globalSubdivisions, preDelaySeconds) {
    const errors = [];
    const warnings = [];
    const validatedNotes = [];

    // 시작점 확인 (구간 0의 beat 0 direction 노트)
    const startNote = notes.find(n => n.beat === 0 && n.type === "direction");
    if (!startNote) {
        errors.push('Chart must have a starting direction note at beat 0');
    }

    // 각 노트 검증
    notes.forEach((note, index) => {
        const validation = validateNote(note, globalBpm, globalSubdivisions);
        if (!validation.isValid) {
            errors.push(`Note ${index}: ${validation.errors.join(', ')}`);
        } else {
            // 원본 인덱스를 _origIndex로 보존 (section offset 매핑용)
            validatedNotes.push({ ...note, _origIndex: index });
        }
    });

    // 구간 오프셋 계산 (원본 notes 배열 기준)
    const sectionOffsets = calculateSectionOffsets(notes, globalBpm, globalSubdivisions);

    // 시간 순서 검증 및 Long Note 겹침 검사 (절대시간 기준)
    const sortedNotes = [...validatedNotes].sort((a, b) => {
        const aOff = sectionOffsets[a._origIndex] || 0;
        const bOff = sectionOffsets[b._origIndex] || 0;
        const aTime = aOff + beatToTime(a.beat, a.bpm || globalBpm, a.subdivisions || globalSubdivisions);
        const bTime = bOff + beatToTime(b.beat, b.bpm || globalBpm, b.subdivisions || globalSubdivisions);
        return aTime - bTime;
    });

    // Long Note 겹침 및 범위 내 노트 검증
    for (let i = 0; i < sortedNotes.length - 1; i++) {
        const currentNote = sortedNotes[i];
        if (currentNote.isLong && currentNote.longTime > 0) {
            const currentTiming = getNoteTimingParams(currentNote, globalBpm, globalSubdivisions);
            const currentOff = sectionOffsets[currentNote._origIndex] || 0;
            const currentStartTime = currentOff + beatToTime(currentNote.beat, currentTiming.bpm, currentTiming.subdivisions);
            const currentEndTime = currentStartTime + calculateLongNoteTime(currentNote, globalBpm, globalSubdivisions);

            // 현재 Long Note의 타입 확인
            const currentLongType = currentNote.type;

            // 다음 노트들이 현재 Long Note 범위 안에 있는지 검사
            for (let j = i + 1; j < sortedNotes.length; j++) {
                const nextNote = sortedNotes[j];
                const nextTiming = getNoteTimingParams(nextNote, globalBpm, globalSubdivisions);
                const nextOff = sectionOffsets[nextNote._origIndex] || 0;
                const nextTime = nextOff + beatToTime(nextNote.beat, nextTiming.bpm, nextTiming.subdivisions);

                // 부동소수점 정밀도 문제를 해결하기 위해 작은 오차 허용
                const EPSILON = 1e-10;

                if (nextTime < currentEndTime - EPSILON) {
                    // 다른 Long Note와의 겹침 검사 (에러)
                    if (nextNote.isLong && nextNote.longTime > 0) {
                        errors.push(`Error: Long Note ${nextNote._origIndex} (beat ${nextNote.beat}) overlaps with Long Note ${currentNote._origIndex} (beat ${currentNote.beat})`);
                    }
                    // 롱노트 범위 내 허용 노트 검증
                    else {
                        const nextNoteType = nextNote.type;
                        let isValidInRange = false;

                        if (currentLongType === 'longtab') {
                            isValidInRange = (nextNoteType === 'tab' || nextNoteType === 'direction' || nextNoteType === 'both');
                        } else if (currentLongType === 'longdirection') {
                            isValidInRange = (nextNoteType === 'tab');
                        } else if (currentLongType === 'longboth') {
                            isValidInRange = (nextNoteType === 'tab');
                        }

                        if (!isValidInRange) {
                            errors.push(`Error: Note ${nextNote._origIndex} (${nextNoteType}, beat ${nextNote.beat}) is not allowed within ${currentLongType} range (${currentNote._origIndex}, beat ${currentNote.beat})`);
                        }
                    }
                } else if (Math.abs(nextTime - currentEndTime) <= EPSILON) {
                    continue;
                } else {
                    break;
                }
            }
        }
    }

    // _origIndex 제거 후 반환
    const cleanedNotes = validatedNotes.map(n => {
        const { _origIndex, ...rest } = n;
        return rest;
    });

    return {
        isValid: errors.length === 0,
        errors,
        warnings,
        notes: cleanedNotes,
        sectionOffsets // save-json 핸들러에서 재사용 가능하도록 반환
    };
}

// 노트 데이터를 JSON 형식으로 변환
// sectionOffset: 이 노트가 속한 구간의 시작 절대시간(초). 기본값 0 (역호환)
export function noteToJsonFormat(note, globalBpm, globalSubdivisions, preDelaySeconds, sectionOffset = 0) {
    const timing = getNoteTimingParams(note, globalBpm, globalSubdivisions);
    let originalTime, finalTime;

    if (note.beat === 0 && note.type === "direction" && sectionOffset === 0) {
        // beat 0 direction 노트는 구간 0에서만 finalTime = 0 (기존 동작 유지)
        originalTime = 0;
        finalTime = 0;
    } else if ((note.type === "tab" || note.type === "longtab") &&
               note.hasOwnProperty('fadeDirectTime')) {
        // fade 구간의 tab/longtab 노트는 저장된 직접 시간값 사용
        finalTime = note.fadeDirectTime;
        originalTime = finalTime - preDelaySeconds;
    } else {
        originalTime = sectionOffset + beatToTime(note.beat, timing.bpm, timing.subdivisions);
        finalTime = originalTime + preDelaySeconds;
    }

    const noteType = convertNoteTypeToExternal(note.type);
    const longTimeInSeconds = (note.isLong && note.longTime > 0) ?
        calculateLongNoteTime(note, globalBpm, globalSubdivisions) : 0;

    const result = {
        beat: note.beat,
        bpm: note.bpm || globalBpm,
        subdivisions: note.subdivisions || globalSubdivisions,
        originalTime: originalTime,
        musicTime: 3.0 + originalTime, // MUSIC_START_TIME
        finalTime: finalTime,
        isLong: note.isLong || false,
        longTime: longTimeInSeconds,
        longTimeBeat: note.longTime || 0,
        noteType: noteType,
        direction: note.direction || "none",
        fade: note.fade || false  // BPM fade 여부 (boolean)
    };

    // Node 타입 노트의 경우 isWait 필드 추가
    if (note.type === "node") {
        result.isWait = note.wait || false;
    }

    // 모든 타입에서 beatReset이 true인 경우 isBeatReset 필드 추가
    if (note.beatReset) {
        result.isBeatReset = true;
    }

    return result;
}

// JSON 형식을 노트 데이터로 변환
export function jsonToNoteFormat(jsonNote, globalBpm, globalSubdivisions) {
    const beat = jsonNote.beat !== undefined ? jsonNote.beat : 
        timeToBeat(jsonNote.time || 0, globalBpm, globalSubdivisions);
    
    const type = convertExternalToNoteType(jsonNote.noteType);
    
    let longTimeBeat = 0;
    if (jsonNote.longTimeBeat !== undefined) {
        longTimeBeat = jsonNote.longTimeBeat;
    } else if (jsonNote.longTime !== undefined && jsonNote.longTime > 0) {
        const noteBpm = jsonNote.bpm || globalBpm;
        const noteSubdivisions = jsonNote.subdivisions || globalSubdivisions;
        longTimeBeat = timeToBeat(jsonNote.longTime, noteBpm, noteSubdivisions);
    }
    
    const noteData = {
        type: type,
        beat: beat,
        direction: jsonNote.direction || "none",
        isLong: jsonNote.isLong || false,
        longTime: longTimeBeat,
        bpm: jsonNote.bpm || globalBpm,
        subdivisions: jsonNote.subdivisions || globalSubdivisions,
        fade: jsonNote.fade || false  // BPM fade 여부 (boolean)
    };

    // Node 타입 노트의 경우 wait, beatReset 필드 추가
    if (type === "node") {
        noteData.wait = jsonNote.isWait || false;
        noteData.beatReset = jsonNote.isBeatReset || false; // 구버전 파일: undefined → false (역호환)
    }

    return noteData;
}

// 노트 리스트를 시간순으로 정렬
// 1차 정렬: sectionIndex (구간 번호) — 구간 경계를 항상 보존
// 2차 정렬: 구간 내 상대 시간 (beat 기반)
// 무작위 순서의 데이터도 안정적으로 정렬하기 위해 절대시간 기반 반복 정렬 적용
export function sortNotesByTime(notes, globalBpm, globalSubdivisions) {
    if (notes.length === 0) return [];

    // 작업용 배열 복사
    const workNotes = [...notes];

    // 초기 sectionIndex 계산
    recomputeSectionIndices(workNotes);

    // 반복 정렬: beatReset 노트가 잘못된 위치에 있어도 올바르게 수렴하도록
    // 절대시간 기반 정렬을 통해 무작위 순서의 데이터도 올바르게 정렬
    // 최대 3회 반복 (대부분 1-2회면 충분)
    let previousOrder = null;
    const maxIterations = 3;

    for (let iteration = 0; iteration < maxIterations; iteration++) {
        // 현재 순서를 문자열로 저장 (수렴 검사용)
        const currentOrder = workNotes.map(n => `${n.type}:${n.beat}:${n.sectionIndex || 0}`).join('|');

        // 수렴 확인: 순서가 변하지 않으면 종료
        if (currentOrder === previousOrder) {
            break;
        }
        previousOrder = currentOrder;

        // 각 노트의 구간 오프셋 계산 (현재 sectionIndex 기반)
        const sectionOffsets = calculateSectionOffsets(workNotes, globalBpm, globalSubdivisions);

        // 각 노트에 절대시간 정보를 임시로 저장
        workNotes.forEach((note, idx) => {
            const offset = sectionOffsets[idx] || 0;
            const timing = getNoteTimingParams(note, globalBpm, globalSubdivisions);
            note._absTime = offset + beatToTime(note.beat, timing.bpm, timing.subdivisions);
        });

        // 절대시간 기반 정렬 (동점일 때는 beat 값으로 2차 정렬)
        workNotes.sort((a, b) => {
            const timeDiff = a._absTime - b._absTime;
            if (Math.abs(timeDiff) > 0.0001) { // 부동소수점 오차 고려
                return timeDiff;
            }
            // 동일 시간일 경우 beat 값으로 정렬
            return a.beat - b.beat;
        });

        // 임시 필드 제거
        workNotes.forEach(note => {
            delete note._absTime;
        });

        // 정렬 후 sectionIndex 재계산
        recomputeSectionIndices(workNotes);
    }

    return workNotes;
}

// 초기 direction 노트 확인 및 추가
export function ensureInitialDirectionNote(notes) {
    const initialDirectionNote = notes.find(n => n.beat === 0 && n.type === "direction");
    
    if (!initialDirectionNote) {
        // beat 0에 direction 노트가 없으면 새로 추가
        notes.unshift({
            type: "direction",
            beat: 0,
            direction: "right",
            isLong: false,
            longTime: 0,
            bpm: 120,
            subdivisions: 16
        });
    } else if (initialDirectionNote.direction === "none") {
        // beat 0에 direction 노트가 있지만 none이면 right로 변경
        initialDirectionNote.direction = "right";
    }
}

// 마지막 direction 노트 확인 및 추가 (마지막 노트로부터 3초 간격)
export function ensureFinalDirectionNote(notes, globalBpm, globalSubdivisions) {
    if (notes.length === 0) return;

    // 시간순으로 정렬하여 마지막 노트 찾기
    const sortedNotes = sortNotesByTime(notes, globalBpm, globalSubdivisions);
    const lastNote = sortedNotes[sortedNotes.length - 1];

    if (!lastNote || (lastNote.type === "direction" && lastNote.direction === "none")) {
        return; // 이미 Direction Type None이 마지막에 있음
    }

    // 마지막 노트의 절대시간 계산 (구간 오프셋 포함)
    const sectionOffsets = calculateSectionOffsets(notes, globalBpm, globalSubdivisions);
    const lastNoteOrigIdx = notes.indexOf(lastNote);
    const lastNoteSectionOffset = (lastNoteOrigIdx >= 0) ? (sectionOffsets[lastNoteOrigIdx] || 0) : 0;

    const lastNoteTiming = getNoteTimingParams(lastNote, globalBpm, globalSubdivisions);
    const lastNoteTime = lastNoteSectionOffset + beatToTime(lastNote.beat, lastNoteTiming.bpm, lastNoteTiming.subdivisions);
    let lastNoteEndTime = lastNoteTime;

    if (lastNote.isLong && lastNote.longTime > 0) {
        const longTimeInSeconds = calculateLongNoteTime(lastNote, globalBpm, globalSubdivisions);
        lastNoteEndTime = lastNoteTime + longTimeInSeconds;
    }

    // Long Note인 경우 1초, 일반 노트인 경우 3초 후
    const delayTime = (lastNote.isLong && lastNote.longTime > 0) ? 1.0 : 3.0;
    // finalTime = 절대시간 기준. 마지막 구간의 sectionOffset을 뺀 상대 beat로 변환
    const lastSectionOffset = sectionOffsets[sectionOffsets.length - 1] || 0;
    const relativeEndTime = lastNoteEndTime - lastSectionOffset + delayTime;
    const finalBeat = timeToBeat(relativeEndTime, globalBpm, globalSubdivisions);

    // 마지막에 Direction Type None 노트 추가 (마지막 구간 기준 상대 beat)
    notes.push({
        type: "direction",
        beat: Math.round(finalBeat),
        direction: "none",
        isLong: false,
        longTime: 0,
        bpm: globalBpm,
        subdivisions: globalSubdivisions
    });
}

// 노트 복제
export function cloneNote(note) {
    return {
        type: note.type,
        beat: note.beat,
        direction: note.direction || "none",
        isLong: note.isLong || false,
        longTime: note.longTime || 0,
        bpm: note.bpm,
        subdivisions: note.subdivisions,
        wait: note.wait || false,
        beatReset: note.beatReset || false,
        fade: note.fade || false
    };
}

// 노트 타입별 색상 가져오기
export function getNoteColor(noteType) {
    const colors = {
        "tab": "#4CAF50",
        "direction": "#2196F3", 
        "both": "#FF9800",
        "longtab": "#FF5722",
        "longdirection": "#03A9F4",
        "longboth": "#E91E63",
        "node": "#607D8B"
    };
    return colors[noteType] || "#4CAF50";
}