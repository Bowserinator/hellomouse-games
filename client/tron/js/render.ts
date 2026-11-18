/** Canvas drawing of the arena from the point of view of a camera. */
import type { Arena } from './arena.js';

export const CELL_PX = 6;
const MAJOR_LINE = 8;

export interface Camera {
    x: number;
    y: number;
}

export function drawArena(ctx: CanvasRenderingContext2D, arena: Arena, camera: Camera, colors: Array<string>, now: number) {
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;
    const size = arena.size;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);
    if (!size) return;

    const left = width / 2 - camera.x * CELL_PX;
    const top = height / 2 - camera.y * CELL_PX;
    const extent = size * CELL_PX;

    ctx.fillStyle = '#05090d';
    ctx.fillRect(left, top, extent, extent);

    const x0 = Math.max(0, Math.floor(camera.x - width / 2 / CELL_PX));
    const x1 = Math.min(size, Math.ceil(camera.x + width / 2 / CELL_PX) + 1);
    const y0 = Math.max(0, Math.floor(camera.y - height / 2 / CELL_PX));
    const y1 = Math.min(size, Math.ceil(camera.y + height / 2 / CELL_PX) + 1);

    for (let x = x0; x <= x1; x++) {
        ctx.fillStyle = x % MAJOR_LINE ? 'rgba(0, 229, 255, 0.06)' : 'rgba(0, 229, 255, 0.16)';
        ctx.fillRect(left + x * CELL_PX, top + y0 * CELL_PX, 1, (y1 - y0) * CELL_PX);
    }
    for (let y = y0; y <= y1; y++) {
        ctx.fillStyle = y % MAJOR_LINE ? 'rgba(0, 229, 255, 0.06)' : 'rgba(0, 229, 255, 0.16)';
        ctx.fillRect(left + x0 * CELL_PX, top + y * CELL_PX, (x1 - x0) * CELL_PX, 1);
    }

    const heads = new Set<number>();
    arena.racers.forEach(racer => {
        if (racer.active && racer.alive) heads.add(racer.y * size + racer.x);
    });

    let lastOwner = 0;
    for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
            const owner = arena.owner[y * size + x];
            if (!owner || heads.has(y * size + x)) continue;
            if (owner !== lastOwner) {
                ctx.fillStyle = colors[owner - 1] ?? '#fff';
                lastOwner = owner;
            }
            ctx.fillRect(left + x * CELL_PX, top + y * CELL_PX, CELL_PX, CELL_PX);
        }

    arena.racers.forEach((racer, seat) => {
        if (!racer.active || !racer.alive) return;
        const head = arena.visualPosition(racer, now);
        const minX = Math.min(racer.prevX, head.x);
        const minY = Math.min(racer.prevY, head.y);
        ctx.fillStyle = colors[seat] ?? '#fff';
        ctx.fillRect(
            left + minX * CELL_PX, top + minY * CELL_PX,
            (Math.max(racer.prevX, head.x) - minX + 1) * CELL_PX,
            (Math.max(racer.prevY, head.y) - minY + 1) * CELL_PX
        );

        const px = left + head.x * CELL_PX;
        const py = top + head.y * CELL_PX;
        ctx.fillStyle = '#fff';
        ctx.shadowColor = colors[seat] ?? '#fff';
        ctx.shadowBlur = 4;
        ctx.fillRect(px + 1, py + 1, CELL_PX - 2, CELL_PX - 2);
        ctx.shadowBlur = 0;
        if (seat === arena.me) {
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1;
            ctx.strokeRect(px - 2, py - 2, CELL_PX + 4, CELL_PX + 4);
        }
    });

    ctx.strokeStyle = '#e0f7ff';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#00e5ff';
    ctx.shadowBlur = 4;
    ctx.strokeRect(left - 1, top - 1, extent + 2, extent + 2);
    ctx.shadowBlur = 0;
}
