import { BOARD_SIZE, GRID_LINE_COLOR, GRID_OUTSIDE_COLOR } from '../vars.js';
import { drawLine } from './draw.js';

const ROW_LABEL = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const COL_LABEL = '12456789ΑαΒβΓγΔδΕεΖζΗηΘθΙιΚκΛλΜμΝνΞξΟοΠπΡρΣσ/ςΤτΥυΦφΧχΨψΩω'.split('');


/**
 * Default grid background drawing (grid lines + labels)
 * @param ctx CTX
 * @param offset Grid offset
 * @param gridSize Grid size
 */
export default function drawGrid(ctx: CanvasRenderingContext2D, offset: [number, number], gridSize: number) {
    const [tx, ty] = offset;
    const s = BOARD_SIZE * gridSize;

    // Labels
    ctx.globalAlpha = 1;
    ctx.font = `${Math.round(gridSize * 0.75)}px Quantico`;
    ctx.fillStyle = GRID_OUTSIDE_COLOR;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';

    for (let y = 1; y <= BOARD_SIZE; y++) {
        const char = COL_LABEL[y - 1];
        const y2 = offset[1] + (y - 0.5) * gridSize;
        ctx.fillText(char, offset[0] / 2, y2);
    }
    for (let x = 1; x <= BOARD_SIZE; x++) {
        const char = ROW_LABEL[x - 1];
        const x2 = offset[0] + (x - 0.5) * gridSize;
        ctx.fillText(char, x2, offset[1] / 2);
    }

    // Outline
    drawLine(ctx, [tx, ty], [tx + s, ty], GRID_OUTSIDE_COLOR);
    drawLine(ctx, [tx, ty + s], [tx + s, ty + s], GRID_OUTSIDE_COLOR);
    drawLine(ctx, [tx, ty], [tx, ty + s], GRID_OUTSIDE_COLOR);
    drawLine(ctx, [tx + s, ty], [tx + s, ty + s], GRID_OUTSIDE_COLOR);

    // Grid
    ctx.globalAlpha = 0.02;
    ctx.fillStyle = GRID_LINE_COLOR;
    for (let x = 0; x < BOARD_SIZE; x++)
        for (let y = 0; y < BOARD_SIZE; y++)
            if ((x + y) % 2 === 0)
                ctx.fillRect(tx + x * gridSize, ty + y * gridSize, gridSize, gridSize);

    ctx.globalAlpha = 0.1;
    for (let x = 1; x < BOARD_SIZE; x++)
        drawLine(ctx, [tx + x * gridSize, ty], [tx + x * gridSize, ty + s], GRID_LINE_COLOR);
    for (let y = 1; y < BOARD_SIZE; y++)
        drawLine(ctx, [tx, ty + y * gridSize], [tx + s, ty + y * gridSize], GRID_LINE_COLOR);
    ctx.globalAlpha = 1;
}
