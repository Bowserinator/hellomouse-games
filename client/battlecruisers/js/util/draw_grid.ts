import { BOARD_SIZE, GRID_LINE_COLOR, GRID_OUTSIDE_COLOR } from '../vars.js';
import { drawLine } from './draw.js';


export default function drawGrid(ctx: CanvasRenderingContext2D, offset: [number, number], gridSize: number) {
    const [tx, ty] = offset;
    const s = BOARD_SIZE * gridSize;

    ctx.globalAlpha = 1;
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
