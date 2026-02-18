// Canvas 관련 함수들
import { directionToVector, getNoteTimingParams, calculateLongNoteTime, timeToBeat } from './utils.js';

// Canvas에 원을 그리는 유틸리티 함수
export function drawCircle(ctx, x, y, radius, fillStyle, strokeStyle = null, lineWidth = 0) {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2 * Math.PI);
    ctx.fillStyle = fillStyle;
    ctx.fill();
    
    if (strokeStyle && lineWidth > 0) {
        ctx.strokeStyle = strokeStyle;
        ctx.lineWidth = lineWidth;
        ctx.stroke();
    }
}

// Canvas에 텍스트를 그리는 유틸리티 함수
export function drawText(ctx, text, x, y, font = "bold 8px Arial", fillStyle = "white", textAlign = "center", textBaseline = "middle") {
    ctx.fillStyle = fillStyle;
    ctx.font = font;
    ctx.textAlign = textAlign;
    ctx.textBaseline = textBaseline;
    ctx.fillText(text, x, y);
}

// Canvas에 삼각형을 그리는 유틸리티 함수 (이벤트 마커용)
export function drawTriangle(ctx, x, y, size = 8, fillStyle = "#FF9800", strokeStyle = null, lineWidth = 0) {
    const height = size * 0.866; // 정삼각형 높이

    ctx.beginPath();
    ctx.moveTo(x, y - height * 0.6); // 상단 꼭짓점
    ctx.lineTo(x - size * 0.5, y + height * 0.4); // 좌하단
    ctx.lineTo(x + size * 0.5, y + height * 0.4); // 우하단
    ctx.closePath();

    ctx.fillStyle = fillStyle;
    ctx.fill();

    if (strokeStyle && lineWidth > 0) {
        ctx.strokeStyle = strokeStyle;
        ctx.lineWidth = lineWidth;
        ctx.stroke();
    }
}

// 노트의 방향 벡터와 화살표를 그리는 함수
export function drawDirectionArrow(ctx, screenX, screenY, direction, color, size = 18) {
    const [dx, dy] = directionToVector(direction);
    const mag = Math.hypot(dx, dy) || 1;
    const ux = (dx / mag) * size;
    const uy = (dy / mag) * size;
    const endX = screenX + ux;
    const endY = screenY + uy;

    ctx.beginPath();
    ctx.moveTo(screenX, screenY);
    ctx.lineTo(endX, endY);
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.stroke();

    const perpX = -uy * 0.5;
    const perpY = ux * 0.5;
    ctx.beginPath();
    ctx.moveTo(endX, endY);
    ctx.lineTo(endX - ux * 0.4 + perpX, endY - uy * 0.4 + perpY);
    ctx.lineTo(endX - ux * 0.4 - perpX, endY - uy * 0.4 - perpY);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
}

// Long Note 처리를 위한 통합 함수
export function processLongNote(note, pathBeat, pathDirectionNotes, nodePositions, color, globalBpm, globalSubdivisions, drawLongNoteBar) {
    if (note.longTime <= 0) return null;
    
    const longTimeInSeconds = calculateLongNoteTime(note, globalBpm, globalSubdivisions);
    const longTimeInGlobalBeats = timeToBeat(longTimeInSeconds, globalBpm, globalSubdivisions);
    const endPathBeat = pathBeat + longTimeInGlobalBeats;
    const timing = getNoteTimingParams(note, globalBpm, globalSubdivisions);

    drawLongNoteBar(pathBeat, endPathBeat, pathDirectionNotes, nodePositions, color, 8, timing.subdivisions);

    // End position 계산
    for (let i = 0; i < pathDirectionNotes.length - 1; i++) {
        const a = pathDirectionNotes[i];
        const b = pathDirectionNotes[i + 1];
        if (a.pathBeat <= endPathBeat && endPathBeat <= b.pathBeat) {
            const interp = (endPathBeat - a.pathBeat) / (b.pathBeat - a.pathBeat);
            const pa = nodePositions[i];
            const pb = nodePositions[i + 1];
            return {
                x: pa.x + (pb.x - pa.x) * interp,
                y: pa.y + (pb.y - pa.y) * interp
            };
        }
    }
    return null;
}

// 눈금자 그리기
export function drawRuler(rulerCtx, rulerCanvas, duration, zoom = 1) {
    rulerCtx.clearRect(0, 0, rulerCanvas.width, rulerCanvas.height);
    rulerCtx.fillStyle = "#444";
    rulerCtx.fillRect(0, 0, rulerCanvas.width, rulerCanvas.height);

    const pixelsPerSecond = rulerCanvas.width / duration * zoom;
    rulerCtx.strokeStyle = "#fff";
    rulerCtx.fillStyle = "#fff";
    rulerCtx.font = "10px Arial";
    rulerCtx.textAlign = "center";

    for (let second = 0; second <= duration; second++) {
        const x = second * pixelsPerSecond;
        if (x > rulerCanvas.width) break;
        
        rulerCtx.beginPath();
        rulerCtx.moveTo(x, 0);
        rulerCtx.lineTo(x, second % 5 === 0 ? 15 : 10);
        rulerCtx.stroke();

        if (second % 5 === 0) {
            rulerCtx.fillText(second + "s", x, 25);
        }
    }
}