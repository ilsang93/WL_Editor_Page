// 노트 관리 관련 함수들
import { 
    getNoteTimingParams, 
    convertNoteTypeToExternal, 
    convertExternalToNoteType,
    calculateLongNoteTime,
    beatToTime,
    timeToBeat 
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
    
    // 시작점 확인
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
            validatedNotes.push({ ...note });
        }
    });
    
    // 시간 순서 검증 및 Long Note 겹침 검사
    const sortedNotes = [...validatedNotes].sort((a, b) => {
        const aTime = beatToTime(a.beat, a.bpm || globalBpm, a.subdivisions || globalSubdivisions);
        const bTime = beatToTime(b.beat, b.bpm || globalBpm, b.subdivisions || globalSubdivisions);
        return aTime - bTime;
    });
    
    // Long Note와 다음 노트들의 겹침 검사
    for (let i = 0; i < sortedNotes.length - 1; i++) {
        const currentNote = sortedNotes[i];
        if (currentNote.isLong && currentNote.longTime > 0) {
            const currentTiming = getNoteTimingParams(currentNote, globalBpm, globalSubdivisions);
            const currentStartTime = beatToTime(currentNote.beat, currentTiming.bpm, currentTiming.subdivisions);
            const currentEndTime = currentStartTime + calculateLongNoteTime(currentNote, globalBpm, globalSubdivisions);
            
            // 다음 노트들이 현재 Long Note 범위 안에 있는지 검사
            for (let j = i + 1; j < sortedNotes.length; j++) {
                const nextNote = sortedNotes[j];
                const nextTiming = getNoteTimingParams(nextNote, globalBpm, globalSubdivisions);
                const nextTime = beatToTime(nextNote.beat, nextTiming.bpm, nextTiming.subdivisions);
                
                if (nextTime < currentEndTime) {
                    const originalCurrentIndex = notes.findIndex(n => n === currentNote);
                    const originalNextIndex = notes.findIndex(n => n === nextNote);
                    warnings.push(`Warning: Note ${originalNextIndex} (beat ${nextNote.beat}) overlaps with Long Note ${originalCurrentIndex} (beat ${currentNote.beat}, ends at ${currentEndTime.toFixed(3)}s)`);
                } else {
                    break; // 더 이상 겹치는 노트가 없음
                }
            }
        }
    }
    
    return {
        isValid: errors.length === 0,
        errors,
        warnings,
        notes: validatedNotes
    };
}

// 노트 데이터를 JSON 형식으로 변환
export function noteToJsonFormat(note, globalBpm, globalSubdivisions, preDelaySeconds) {
    const timing = getNoteTimingParams(note, globalBpm, globalSubdivisions);
    const originalTime = beatToTime(note.beat, timing.bpm, timing.subdivisions);
    
    let finalTime;
    if (note.beat === 0 && note.type === "direction") {
        finalTime = originalTime;
    } else {
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
        direction: note.direction || "none"
    };
    
    // Node 타입 노트의 경우 isWait 필드 추가
    if (note.type === "node") {
        result.isWait = note.wait || false;
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
        subdivisions: jsonNote.subdivisions || globalSubdivisions
    };
    
    // Node 타입 노트의 경우 wait 필드 추가
    if (type === "node") {
        noteData.wait = jsonNote.isWait || false;
    }
    
    return noteData;
}

// 노트 리스트를 시간순으로 정렬
export function sortNotesByTime(notes, globalBpm, globalSubdivisions) {
    return [...notes].sort((a, b) => {
        const aTiming = getNoteTimingParams(a, globalBpm, globalSubdivisions);
        const bTiming = getNoteTimingParams(b, globalBpm, globalSubdivisions);
        const aTime = beatToTime(a.beat, aTiming.bpm, aTiming.subdivisions);
        const bTime = beatToTime(b.beat, bTiming.bpm, bTiming.subdivisions);
        return aTime - bTime;
    });
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
    
    // 마지막 노트의 시간 계산 (Long Note인 경우 끝나는 시간 고려)
    const lastNoteTiming = getNoteTimingParams(lastNote, globalBpm, globalSubdivisions);
    const lastNoteTime = beatToTime(lastNote.beat, lastNoteTiming.bpm, lastNoteTiming.subdivisions);
    let lastNoteEndTime = lastNoteTime;
    
    if (lastNote.isLong && lastNote.longTime > 0) {
        const longTimeInSeconds = calculateLongNoteTime(lastNote, globalBpm, globalSubdivisions);
        lastNoteEndTime = lastNoteTime + longTimeInSeconds;
    }
    
    // Long Note인 경우 1초, 일반 노트인 경우 3초 후의 beat 값 계산
    const delayTime = (lastNote.isLong && lastNote.longTime > 0) ? 1.0 : 3.0;
    const finalTime = lastNoteEndTime + delayTime;
    const finalBeat = timeToBeat(finalTime, globalBpm, globalSubdivisions);
    
    // 마지막에 Direction Type None 노트 추가
    notes.push({
        type: "direction",
        beat: Math.round(finalBeat), // 정수로 반올림
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
        wait: note.wait || false
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