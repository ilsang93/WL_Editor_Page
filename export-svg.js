// export-svg.js - 차트 이미지(JPG) 내보내기 기능
import {
    directionToVector,
    getNoteTimingParams,
    calculateFadeProgress,
    beatToTime,
    calculatePathBeat,
    calculateSectionOffsets
} from './utils.js';

// 최대 캔버스 크기 (브라우저 제한 고려)
const MAX_CANVAS_WIDTH = 4096;
const MAX_CANVAS_HEIGHT = 4096;
// 콘텐츠 주변 여백 (픽셀)
const MARGIN = 80;
// 배경색
const BG_COLOR = '#1a1a2e';

// ---- 경로 계산 ----

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
    if (nodePositions.length > 0) return { ...nodePositions[nodePositions.length - 1] };
    return null;
}

// ---- Canvas 그리기 헬퍼 ----

function _drawArrow(ctx, cx, cy, direction, color, size = 16, lineWidth = 3) {
    if (!direction || direction === 'none') return;
    const [dx, dy] = directionToVector(direction);
    const mag = Math.hypot(dx, dy) || 1;
    const ux = (dx / mag) * size, uy = (dy / mag) * size;
    const ex = cx + ux, ey = cy + uy;
    const perpX = -uy * 0.5, perpY = ux * 0.5;

    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(ex, ey);
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - ux * 0.4 + perpX, ey - uy * 0.4 + perpY);
    ctx.lineTo(ex - ux * 0.4 - perpX, ey - uy * 0.4 - perpY);
    ctx.closePath();
    ctx.fill();
}

// ---- 메인 내보내기 함수 ----

export function exportChartSVG({ notes, bpm, subdivisions, preDelaySeconds, speedMultiplier, musicName, level }) {
    console.log('Export started. Notes count:', notes?.length);
    console.log('Parameters:', { bpm, subdivisions, preDelaySeconds, speedMultiplier, musicName, level });

    if (!notes || notes.length === 0) {
        alert('노트가 없습니다. 먼저 노트를 추가해주세요.');
        return;
    }

    // 노트 복사 및 구간 오프셋 계산
    const clonedNotes = notes.map(n => ({ ...n }));
    const sectionOffsets = calculateSectionOffsets(clonedNotes, bpm, subdivisions);
    clonedNotes.forEach((n, i) => { n._sectionOffset = sectionOffsets[i] || 0; });

    // 경로 노트 (direction + node)
    const pathNotes = clonedNotes.filter(n => n.type === 'direction' || n.type === 'node');
    console.log('Path notes count:', pathNotes.length);

    if (pathNotes.length === 0) {
        alert('경로 노트(Direction/Node)가 없습니다.');
        return;
    }

    const pathDirNotes = _buildPathDirectionNotes(pathNotes, bpm, subdivisions, preDelaySeconds);
    const nodePositions = _buildNodePositions(pathDirNotes, bpm, speedMultiplier);
    console.log('Node positions count:', nodePositions.length);

    if (nodePositions.length === 0) {
        alert('경로 계산에 실패했습니다.');
        return;
    }

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

    console.log('Note render data count:', noteRenderData.length);

    if (noteRenderData.length === 0) {
        alert('렌더링할 노트가 없습니다.');
        return;
    }

    // 바운딩 박스 계산
    const allPts = [...nodePositions, ...noteRenderData.map(d => d.pos)];

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

    // 노드 라벨과 이벤트를 위한 여유 공간 (월드 좌표)
    const extraTop = 2; // 월드 유닛
    const extraBottom = 1;
    minY -= extraTop;
    maxY += extraBottom;

    // 월드 크기
    const worldWidth = maxX - minX;
    const worldHeight = maxY - minY;

    // 최대 캔버스 크기를 고려한 스케일 계산
    const maxScaleX = (MAX_CANVAS_WIDTH - MARGIN * 2) / worldWidth;
    const maxScaleY = (MAX_CANVAS_HEIGHT - MARGIN * 2) / worldHeight;
    const scale = Math.min(maxScaleX, maxScaleY, 20); // 최대 20까지

    const canvasW = Math.ceil(worldWidth * scale + MARGIN * 2);
    const canvasH = Math.ceil(worldHeight * scale + MARGIN * 2);

    console.log('Bounding box:', { minX, minY, maxX, maxY });
    console.log('World size:', worldWidth, 'x', worldHeight);
    console.log('Scale:', scale);
    console.log('Canvas dimensions:', canvasW, 'x', canvasH);

    if (canvasW <= 0 || canvasH <= 0 || canvasW > MAX_CANVAS_WIDTH || canvasH > MAX_CANVAS_HEIGHT) {
        alert(`캔버스 크기 오류: ${canvasW}x${canvasH}`);
        return;
    }

    const toCanvas = p => ({
        x: (p.x - minX) * scale + MARGIN,
        y: (p.y - minY) * scale + MARGIN
    });

    // BPM 변화 노트 감지
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

    // 스케일에 비례하는 시각 요소 크기
    const nodeYOffset = Math.max(20, scale * 1.5);
    const noteRadius = Math.max(3, scale * 0.35);
    const pathLineWidth = Math.max(1, scale * 0.1);
    const longBarWidth = Math.max(4, scale * 0.4);
    const arrowSize = Math.max(10, scale * 0.8);
    const fontSize = Math.max(8, scale * 0.45);

    // 오프스크린 Canvas 생성
    const canvas = document.createElement('canvas');
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext('2d');

    // 배경
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, canvasW, canvasH);

    // 롱노트 바 (스케일 적용된 두께로)
    for (const { note, finalTime } of noteRenderData) {
        if (!note.isLong || !note.longTime || note.longTime <= 0) continue;
        const timing = getNoteTimingParams(note, bpm, subdivisions);
        const endTime = finalTime + beatToTime(note.longTime, timing.bpm, timing.subdivisions);
        const barColor = note.type === 'longtab' ? '#FF6B6B'
            : note.type === 'longdirection' ? '#4CAF50'
            : '#9C27B0';

        // 롱노트 바 그리기 (인라인으로 처리)
        if (pathDirNotes.length >= 2) {
            const pts = [];
            const startPos = _posFromPath(finalTime, pathDirNotes, nodePositions, bpm);
            if (startPos) pts.push(toCanvas(startPos));

            for (let i = 0; i < pathDirNotes.length; i++) {
                const t = pathDirNotes[i].finalTime;
                if (t > finalTime && t < endTime && nodePositions[i]) {
                    pts.push(toCanvas(nodePositions[i]));
                }
            }

            const endPos = _posFromPath(endTime, pathDirNotes, nodePositions, bpm);
            if (endPos) pts.push(toCanvas(endPos));

            if (pts.length >= 2) {
                ctx.strokeStyle = barColor;
                ctx.lineWidth = longBarWidth;
                ctx.globalAlpha = 0.55;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.beginPath();
                ctx.moveTo(pts[0].x, pts[0].y);
                for (let i = 1; i < pts.length; i++) {
                    ctx.lineTo(pts[i].x, pts[i].y);
                }
                ctx.stroke();
                ctx.globalAlpha = 1.0;
            }
        }
    }

    // 경로 선분
    ctx.strokeStyle = '#888888';
    ctx.lineWidth = pathLineWidth;
    for (let i = 0; i < nodePositions.length - 1; i++) {
        const nextNote = pathDirNotes[i + 1];
        if (nextNote && nextNote.type === 'node' && nextNote.wait) continue;
        const sp1 = toCanvas(nodePositions[i]);
        const sp2 = toCanvas(nodePositions[i + 1]);
        ctx.beginPath();
        ctx.moveTo(sp1.x, sp1.y);
        ctx.lineTo(sp2.x, sp2.y);
        ctx.stroke();
    }

    // 노트 렌더링
    for (const { note, pos } of noteRenderData) {
        const sp = toCanvas(pos);
        const isFirst = note.beat === 0 && note._sectionOffset === 0;
        const bpmChange = isBpmChange(note);
        const type = note.type;

        // BPM 변화 강조 링
        if (bpmChange) {
            const ringY = type === 'node' ? sp.y - nodeYOffset : sp.y;
            ctx.strokeStyle = '#FFD700';
            ctx.lineWidth = Math.max(2, scale * 0.15);
            ctx.setLineDash([Math.max(3, scale * 0.25), Math.max(2, scale * 0.15)]);
            ctx.globalAlpha = 0.9;
            ctx.beginPath();
            ctx.arc(sp.x, ringY, noteRadius * 2, 0, 2 * Math.PI);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.globalAlpha = 1.0;
        }

        if (type === 'node') {
            const nodeY = sp.y - nodeYOffset;
            const noteBpm = note.bpm || bpm;
            ctx.fillStyle = '#607D8B';
            ctx.strokeStyle = '#263238';
            ctx.lineWidth = Math.max(1, scale * 0.1);
            ctx.beginPath();
            ctx.arc(sp.x, nodeY, noteRadius, 0, 2 * Math.PI);
            ctx.fill();
            ctx.stroke();

            ctx.strokeStyle = '#607D8B';
            ctx.globalAlpha = 0.5;
            ctx.lineWidth = Math.max(0.5, scale * 0.05);
            ctx.beginPath();
            ctx.moveTo(sp.x, nodeY + noteRadius);
            ctx.lineTo(sp.x, sp.y - 3);
            ctx.stroke();
            ctx.globalAlpha = 1.0;

            ctx.fillStyle = 'white';
            ctx.font = `bold ${fontSize}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(noteBpm), sp.x, nodeY);
        } else if (type === 'tab' || type === 'longtab') {
            const fill = isFirst ? 'red' : '#FF6B6B';
            const stroke = isFirst ? '#cc0000' : '#4CAF50';
            ctx.fillStyle = fill;
            ctx.strokeStyle = stroke;
            ctx.lineWidth = Math.max(1, scale * 0.1);
            ctx.beginPath();
            ctx.arc(sp.x, sp.y, noteRadius, 0, 2 * Math.PI);
            ctx.fill();
            ctx.stroke();
        } else if (type === 'direction' || type === 'longdirection') {
            const arrowLineWidth = Math.max(2, scale * 0.15);
            _drawArrow(ctx, sp.x, sp.y, note.direction, isFirst ? '#f00' : '#4CAF50', arrowSize, arrowLineWidth);
        } else if (type === 'both' || type === 'longboth') {
            ctx.fillStyle = '#9C27B0';
            ctx.strokeStyle = '#4A148C';
            ctx.lineWidth = Math.max(1, scale * 0.1);
            ctx.beginPath();
            ctx.arc(sp.x, sp.y, noteRadius, 0, 2 * Math.PI);
            ctx.fill();
            ctx.stroke();
            const arrowLineWidth = Math.max(2, scale * 0.15);
            _drawArrow(ctx, sp.x, sp.y, note.direction, '#9C27B0', arrowSize * 1.3, arrowLineWidth);
        }
    }

    // 좌상단 메타정보 표시
    const metaFontSize = Math.max(12, Math.min(20, fontSize * 1.5));
    const infoX = 20;
    let infoY = metaFontSize + 10;
    const lineHeight = metaFontSize * 1.5;

    const displayMusicName = musicName || 'Unknown';
    const textWidth = Math.max(200, displayMusicName.length * metaFontSize * 0.6);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(10, 10, textWidth + 20, lineHeight * 4 + 10);

    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${metaFontSize}px Arial`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    ctx.fillText(`Music: ${displayMusicName}`, infoX, infoY);
    infoY += lineHeight;
    ctx.fillText(`Level: ${level || '-'}`, infoX, infoY);
    infoY += lineHeight;
    ctx.fillText(`BPM: ${bpm}`, infoX, infoY);
    infoY += lineHeight;
    ctx.fillText(`Subdivisions: ${subdivisions}`, infoX, infoY);

    // JPG 다운로드
    console.log('Final canvas size:', canvasW, 'x', canvasH);
    console.log('Starting image export...');

    // toBlob 대신 toDataURL 사용 (더 넓은 브라우저 호환성)
    try {
        const dataURL = canvas.toDataURL('image/jpeg', 0.92);
        console.log('DataURL length:', dataURL.length);

        if (dataURL.length < 100) {
            alert('이미지 생성 실패: 빈 이미지');
            return;
        }

        const a = document.createElement('a');
        a.href = dataURL;
        a.download = 'chart-export.jpg';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        console.log('Export completed successfully');
    } catch (error) {
        console.error('Failed to export image:', error);
        alert('이미지 내보내기에 실패했습니다: ' + error.message);
    }
}
