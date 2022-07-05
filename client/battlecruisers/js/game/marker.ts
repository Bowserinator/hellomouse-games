import { drawLine, drawRectangle, fillCircle, fillRectangle } from '../util/draw.js';

export class AbstractMarker {
    position: [number, number];
    priority: number;
    color: string;
    overwrite: boolean;

    constructor(color: string, position: [number, number], priority: number) {
        this.color = color;
        this.position = position;
        this.priority = priority;
        this.overwrite = true;
    }

    draw(ctx: CanvasRenderingContext2D, offset: [number, number], gridSize: number) {
        // Override
    }

    toCanvasPos(offset: [number, number], gridSize: number) {
        return [
            this.position[0] * gridSize + offset[0],
            this.position[1] * gridSize + offset[1]
        ];
    }
}

export class HitMarker extends AbstractMarker {
    constructor(position: [number, number]) {
        super('red', position, 4);
    }

    draw(ctx: CanvasRenderingContext2D, offset: [number, number], gridSize: number) {
        let [tx, ty] = this.toCanvasPos(offset, gridSize);
        drawRectangle(ctx, [tx, ty], [gridSize, gridSize], this.color);
        ctx.globalAlpha = 0.15;
        fillRectangle(ctx, [tx, ty], [gridSize, gridSize], this.color);
        ctx.globalAlpha = 1;
        fillCircle(ctx, [tx + gridSize / 2, ty + gridSize / 2], gridSize / 5, this.color);
    }
}

export class MissMarker extends AbstractMarker {
    constructor(position: [number, number]) {
        super('white', position, 3);
    }

    draw(ctx: CanvasRenderingContext2D, offset: [number, number], gridSize: number) {
        let [tx, ty] = this.toCanvasPos(offset, gridSize);
        drawRectangle(ctx, [tx, ty], [gridSize, gridSize], this.color);
        ctx.globalAlpha = 0.15;
        fillRectangle(ctx, [tx, ty], [gridSize, gridSize], this.color);
        ctx.globalAlpha = 1;
        fillCircle(ctx, [tx + gridSize / 2, ty + gridSize / 2], gridSize / 8, this.color);
    }
}

export class MaybeHitMarker extends AbstractMarker {
    constructor(position: [number, number]) {
        super('red', position, 1);
    }

    draw(ctx: CanvasRenderingContext2D, offset: [number, number], gridSize: number) {
        let [tx, ty] = this.toCanvasPos(offset, gridSize);
        ctx.globalAlpha = 0.3;
        drawRectangle(ctx, [tx, ty], [gridSize, gridSize], this.color);
        fillCircle(ctx, [tx + gridSize / 2, ty + gridSize / 2], gridSize / 5, this.color);
        ctx.globalAlpha = 1;
    }
}

export class MaybeMissMarker extends AbstractMarker {
    constructor(position: [number, number]) {
        super('white', position, 2);
    }

    draw(ctx: CanvasRenderingContext2D, offset: [number, number], gridSize: number) {
        let [tx, ty] = this.toCanvasPos(offset, gridSize);
        ctx.globalAlpha = 0.3;
        drawRectangle(ctx, [tx, ty], [gridSize, gridSize], this.color);
        fillCircle(ctx, [tx + gridSize / 2, ty + gridSize / 2], gridSize / 8, this.color);
        ctx.globalAlpha = 1;
    }
}

export class ShotDownMarker extends AbstractMarker {
    constructor(position: [number, number]) {
        super('#ffd024', position, -99);
        this.overwrite = false;
    }

    draw(ctx: CanvasRenderingContext2D, offset: [number, number], gridSize: number) {
        let [tx, ty] = this.toCanvasPos(offset, gridSize);
        let [cx, cy] = [tx + gridSize / 2, ty + gridSize / 2];
        let o = gridSize / 4;
        drawLine(ctx, [cx - o, cy - o], [cx + o, cy + o], this.color);
        drawLine(ctx, [cx - o, cy + o], [cx + o, cy - o], this.color);
    }
}
