// export-svg.js - 차트 이미지(SVG) 내보내기 기능
import {
    directionToVector,
    getNoteTimingParams,
    calculateFadeProgress,
    beatToTime,
    calculatePathBeat,
    calculateSectionOffsets
} from './utils.js';

// SVG 스케일: 월드 유닛당 픽셀 수 (에디터 기본 zoom=30과 동일)
const SCALE = 30;
// 콘텐츠 주변 여백 (픽셀)
const MARGIN = 80;
// 배경색
const BG_COLOR = '#1a1a2e';
// 노드 노트의 위쪽 오프셋 (픽셀)
const NODE_Y_OFFSET = 30;

// ---- 경로 계산 (DOM 의존 없이 파라미터로만 처리) ----

function _movementSpeed(fromNote, toNote, globalBpm, speedMult) {
    const fromBpm = fromNote.bpm || globalBpm;
    const toBpm = toNote.bpm || globalBpm;
    const effectiveBpm = (toNote.fade && Math.abs(fromBpm - toBpm) > 0.01)
        ? (fromBpm + toBpm) / 2
        : toBpm;
    return 0.4 * speedMult * effectiveBpm;
}

function _buildPathDirectionNotes(pathNotes, bpm, subdivisions, preDelaySeconds) {
    return pathNotes.map(note => {
        const so = note._sectionOffset || 0;
        let finalTime;
        if (note.beat === 0 && note.type === 'direction' && so === 0) {
            finalTime = 0;
        } else {
            const nb = note.bpm || bpm;
            const ns = note.subdivisions || subdivisions;
            finalTime = so + beatToTime(note.beat, nb, ns) + preDelaySeconds;
        }
        const pathBeat = calculatePathBeat(note, preDelaySeconds, bpm, subdivisions);
        return { ...note, finalTime, pathBeat };
    }).sort((a, b) => a.finalTime - b.finalTime);
}

function _buildNodePositions(pathDirNotes, bpm, speedMult) {
    const positions = [];
    let pos = { x: 0, y: 0 };
    positions.push({ ...pos });

    for (let i = 0; i < pathDirNotes.length - 1; i++) {
        const a = pathDirNotes[i];
        const b = pathDirNotes[i + 1];
        let next;

        if (b.type === 'node' && b.wait) {
            next = { x: pos.x, y: pos.y };
        } else {
            const speed = _movementSpeed(a, b, bpm, speedMult);
            const dist = speed * (b.finalTime - a.finalTime);

            let dir = a.direction;
            if (a.type === 'node') {
                for (let j = i - 1; j >= 0; j--) {
                    const prev = pathDirNotes[j];
                    if (prev.type !== 'node' && prev.direction) {
                        dir = prev.direction;
                        break;
                    }
                }
                dir = dir || 'right';
            }

            const [dx, dy] = directionToVector(dir);
            const mag = Math.hypot(dx, dy) || 1;
            next = {
                x: pos.x + (dx / mag) * dist,
                y: pos.y + (dy / mag) * dist
            };
        }

        pos = { ...next };
        positions.push({ ...pos });
    }

    return positions;
}

function _posFromPath(finalTime, pathDirNotes, nodePositions, bpm) {
    for (let i = 0; i < pathDirNotes.length - 1; i++) {
        const a = pathDirNotes[i];
        const b = pathDirNotes[i + 1];
        if (a.finalTime <= finalTime && finalTime <= b.finalTime) {
            if (b.finalTime === a.finalTime) return { ...nodePositions[i] };
            let t = (finalTime - a.finalTime) / (b.finalTime - a.finalTime);
            if (b.fade && Math.abs((a.bpm || bpm) - (b.bpm || bpm)) > 0.01) {
                t = calculateFadeProgress(t, a.bpm || bpm, b.bpm || bpm);
            }
            const pa = nodePositions[i], pb = nodePositions[i + 1];
            return {
                x: pa.x + (pb.x - pa.x) * t,
                y: pa.y + (pb.y - pa.y) * t
            };
        }
    }
    // 마지막 노드 이후
    if (nodePositions.length > 0) return { ...nodePositions[nodePositions.length - 1] };
    return null;
}

// ---- SVG 요소 빌더 ----

function _esc(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function _f(n) { return n.toFixed(2); }

function _circle(cx, cy, r, fill, stroke, sw) {
    let s = `<circle cx="${_f(cx)}" cy="${_f(cy)}" r="${r}" fill="${fill}"`;
    if (stroke && sw > 0) s += ` stroke="${stroke}" stroke-width="${sw}"`;
    return s + '/>';
}

function _line(x1, y1, x2, y2, stroke, sw, extra = '') {
    return `<line x1="${_f(x1)}" y1="${_f(y1)}" x2="${_f(x2)}" y2="${_f(y2)}" stroke="${stroke}" stroke-width="${sw}"${extra}/>`;
}

function _arrow(cx, cy, direction, color, size = 20) {
    if (!direction || direction === 'none') return '';
    const [dx, dy] = directionToVector(direction);
    const mag = Math.hypot(dx, dy) || 1;
    const ux = (dx / mag) * size, uy = (dy / mag) * size;
    const ex = cx + ux, ey = cy + uy;
    const perpX = -uy * 0.5, perpY = ux * 0.5;
    const shaft = `<line x1="${_f(cx)}" y1="${_f(cy)}" x2="${_f(ex)}" y2="${_f(ey)}" stroke="${color}" stroke-width="4"/>`;
    const head = `<polygon points="${_f(ex)},${_f(ey)} ${_f(ex - ux * 0.4 + perpX)},${_f(ey - uy * 0.4 + perpY)} ${_f(ex - ux * 0.4 - perpX)},${_f(ey - uy * 0.4 - perpY)}" fill="${color}"/>`;
    return shaft + head;
}

function _triangle(cx, cy, size, fill, stroke, sw) {
    const h = size * 0.866;
    const pts = `${_f(cx)},${_f(cy - h * 0.6)} ${_f(cx - size * 0.5)},${_f(cy + h * 0.4)} ${_f(cx + size * 0.5)},${_f(cy + h * 0.4)}`;
    let s = `<polygon points="${pts}" fill="${fill}"`;
    if (stroke && sw > 0) s += ` stroke="${stroke}" stroke-width="${sw}"`;
    return s + '/>';
}

function _text(x, y, content, fontSize, fill, fontWeight = 'normal') {
    return `<text x="${_f(x)}" y="${_f(y)}" font-family="Arial,sans-serif" font-size="${fontSize}" font-weight="${fontWeight}" fill="${fill}" text-anchor="middle" dominant-baseline="middle">${_esc(content)}</text>`;
}

// 롱노트 바: 실제 경로를 따라가는 폴리라인
function _longNotePolyline(startTime, endTime, pathDirNotes, nodePositions, bpm, color, toSVG) {
    if (pathDirNotes.length < 2) return '';

    const pts = [];
    const startPos = _posFromPath(startTime, pathDirNotes, nodePositions, bpm);
    if (startPos) pts.push(toSVG(startPos));

    // 시간 범위 안에 있는 경로 노드들 포함
    for (let i = 0; i < pathDirNotes.length; i++) {
        const t = pathDirNotes[i].finalTime;
        if (t > startTime && t < endTime && nodePositions[i]) {
            pts.push(toSVG(nodePositions[i]));
        }
    }

    const endPos = _posFromPath(endTime, pathDirNotes, nodePositions, bpm);
    if (endPos) pts.push(toSVG(endPos));

    if (pts.length < 2) return '';
    const ptStr = pts.map(p => `${_f(p.x)},${_f(p.y)}`).join(' ');
    return `<polyline points="${ptStr}" stroke="${color}" stroke-width="10" stroke-opacity="0.55" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;
}

// ---- 메인 내보내기 함수 ----

export function exportChartSVG({ notes, events, bpm, subdivisions, preDelaySeconds, speedMultiplier }) {
    if (!notes || notes.length === 0) return;

    // 노트 복사 및 구간 오프셋 계산
    const clonedNotes = notes.map(n => ({ ...n }));
    const sectionOffsets = calculateSectionOffsets(clonedNotes, bpm, subdivisions);
    clonedNotes.forEach((n, i) => { n._sectionOffset = sectionOffsets[i] || 0; });

    // 경로 노트 (direction + node)
    const pathNotes = clonedNotes.filter(n => n.type === 'direction' || n.type === 'node');
    if (pathNotes.length === 0) return;

    const pathDirNotes = _buildPathDirectionNotes(pathNotes, bpm, subdivisions, preDelaySeconds);
    const nodePositions = _buildNodePositions(pathDirNotes, bpm, speedMultiplier);
    if (nodePositions.length === 0) return;

    // 노트 월드 위치 + finalTime 계산
    const noteRenderData = [];
    for (const note of clonedNotes) {
        let finalTime;
        if (note.beat === 0 && note.type === 'direction' && note._sectionOffset === 0) {
            finalTime = 0;
        } else if ((note.type === 'tab' || note.type === 'longtab') &&
                   Object.prototype.hasOwnProperty.call(note, 'fadeDirectTime')) {
            finalTime = note.fadeDirectTime;
        } else {
            const nb = note.bpm || bpm;
            const ns = note.subdivisions || subdivisions;
            finalTime = note._sectionOffset + beatToTime(note.beat, nb, ns) + preDelaySeconds;
        }
        const pos = _posFromPath(finalTime, pathDirNotes, nodePositions, bpm);
        if (!pos) continue;
        noteRenderData.push({ note, pos, finalTime });
    }

    // 이벤트 월드 위치 계산
    const eventRenderData = [];
    for (const event of (events || [])) {
        if (typeof event.eventTime !== 'number') continue;
        const pos = _posFromPath(event.eventTime, pathDirNotes, nodePositions, bpm);
        if (!pos) continue;
        eventRenderData.push({ event, pos });
    }

    // 바운딩 박스 계산 (월드 좌표)
    const allPts = [
        ...nodePositions,
        ...noteRenderData.map(d => d.pos),
        ...eventRenderData.map(d => d.pos)
    ];

    // 롱노트 끝점도 포함
    for (const { note, finalTime } of noteRenderData) {
        if (!note.isLong || !note.longTime || note.longTime <= 0) continue;
        const timing = getNoteTimingParams(note, bpm, subdivisions);
        const endTime = finalTime + beatToTime(note.longTime, timing.bpm, timing.subdivisions);
        const endPos = _posFromPath(endTime, pathDirNotes, nodePositions, bpm);
        if (endPos) allPts.push(endPos);
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of allPts) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    }

    if (!isFinite(minX)) { minX = 0; maxX = 1; minY = 0; maxY = 1; }
    if (maxX - minX < 1) maxX = minX + 1;
    if (maxY - minY < 1) maxY = minY + 1;

    // 노드 라벨(-30px 위)과 이벤트 라벨(+18px 아래)을 위한 여유 공간
    const extraTop = (NODE_Y_OFFSET + 14) / SCALE;
    const extraBottom = 22 / SCALE;
    minY -= extraTop;
    maxY += extraBottom;

    const svgW = Math.ceil((maxX - minX) * SCALE + MARGIN * 2);
    const svgH = Math.ceil((maxY - minY) * SCALE + MARGIN * 2);

    const toSVG = p => ({
        x: (p.x - minX) * SCALE + MARGIN,
        y: (p.y - minY) * SCALE + MARGIN
    });

    // BPM 변화 노트 감지: pathDirNotes를 순서대로 처리
    const bpmChangeSet = new Set();
    let prevBpm = bpm;
    for (const pn of pathDirNotes) {
        const effectiveBpm = pn.bpm || bpm;
        if (Math.abs(effectiveBpm - prevBpm) > 0.01 || pn.fade) {
            bpmChangeSet.add(pn);
        }
        if (pn.bpm) prevBpm = pn.bpm;
    }

    const isBpmChange = note => {
        if (note.fade) return true;
        for (const pn of bpmChangeSet) {
            if (pn.beat === note.beat &&
                pn.type === note.type &&
                pn._sectionOffset === note._sectionOffset) {
                return true;
            }
        }
        return false;
    };

    // ---- SVG 레이어별 구성 ----
    let bgLayer = '';
    let longBarLayer = '';
    let pathLayer = '';
    let eventLayer = '';
    let noteLayer = '';
    let highlightLayer = '';
    let labelLayer = '';

    // 배경
    bgLayer = `<rect width="${svgW}" height="${svgH}" fill="${BG_COLOR}"/>`;

    // 롱노트 바 (경로를 따라가는 폴리라인)
    for (const { note, finalTime } of noteRenderData) {
        if (!note.isLong || !note.longTime || note.longTime <= 0) continue;
        const timing = getNoteTimingParams(note, bpm, subdivisions);
        const endTime = finalTime + beatToTime(note.longTime, timing.bpm, timing.subdivisions);
        const barColor = note.type === 'longtab' ? '#FF6B6B'
            : note.type === 'longdirection' ? '#4CAF50'
            : '#9C27B0'; // longboth
        longBarLayer += _longNotePolyline(finalTime, endTime, pathDirNotes, nodePositions, bpm, barColor, toSVG);
    }

    // 경로 선분 (wait 구간 제외)
    for (let i = 0; i < nodePositions.length - 1; i++) {
        const nextNote = pathDirNotes[i + 1];
        if (nextNote && nextNote.type === 'node' && nextNote.wait) continue;
        const sp1 = toSVG(nodePositions[i]);
        const sp2 = toSVG(nodePositions[i + 1]);
        pathLayer += _line(sp1.x, sp1.y, sp2.x, sp2.y, '#888888', 2);
    }

    // 이벤트 마커 (삼각형 + 라벨)
    for (const { event, pos } of eventRenderData) {
        const sp = toSVG(pos);
        const label = event.eventId
            ? `${event.eventType}:${event.eventId}`
            : event.eventType;
        eventLayer += _triangle(sp.x, sp.y, 12, '#FF9800', '#FF6F00', 1.5);
        labelLayer += _text(sp.x, sp.y + 18, label, 9, '#FFB74D');
    }

    // 노트 렌더링 + BPM 변화 강조
    for (const { note, pos } of noteRenderData) {
        const sp = toSVG(pos);
        const isFirst = note.beat === 0 && note._sectionOffset === 0;
        const bpmChange = isBpmChange(note);
        const type = note.type;

        if (type === 'node') {
            const nodeY = sp.y - NODE_Y_OFFSET;
            const noteBpm = note.bpm || bpm;
            // 노드는 실제 표시 위치(위쪽)에 강조 링 표시
            if (bpmChange) {
                highlightLayer += `<circle cx="${_f(sp.x)}" cy="${_f(nodeY)}" r="16" fill="none" stroke="#FFD700" stroke-width="3" stroke-dasharray="5 3" opacity="0.9"/>`;
            }
            noteLayer += _circle(sp.x, nodeY, 8, '#607D8B', '#263238', 2);
            noteLayer += _line(sp.x, nodeY + 8, sp.x, sp.y - 3, '#607D8B', 1, ' stroke-opacity="0.5"');
            labelLayer += _text(sp.x, nodeY, String(noteBpm), 10, 'white', 'bold');
        } else {
            if (bpmChange) {
                highlightLayer += `<circle cx="${_f(sp.x)}" cy="${_f(sp.y)}" r="16" fill="none" stroke="#FFD700" stroke-width="3" stroke-dasharray="5 3" opacity="0.9"/>`;
            }
            if (type === 'tab' || type === 'longtab') {
                const fill = isFirst ? 'red' : '#FF6B6B';
                const stroke = isFirst ? '#cc0000' : '#4CAF50';
                noteLayer += _circle(sp.x, sp.y, 8, fill, stroke, 2);
            } else if (type === 'direction' || type === 'longdirection') {
                noteLayer += _arrow(sp.x, sp.y, note.direction, isFirst ? '#f00' : '#4CAF50', 20);
            } else if (type === 'both' || type === 'longboth') {
                noteLayer += _circle(sp.x, sp.y, 8, '#9C27B0', '#4A148C', 2);
                noteLayer += _arrow(sp.x, sp.y, note.direction, '#9C27B0', 26);
            }
        }
    }

    // SVG 조립
    const svg = [
        `<?xml version="1.0" encoding="UTF-8"?>`,
        `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}">`,
        bgLayer,
        longBarLayer,
        pathLayer,
        eventLayer,
        noteLayer,
        highlightLayer,
        labelLayer,
        `</svg>`
    ].join('\n');

    // 다운로드
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'chart-export.svg';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
