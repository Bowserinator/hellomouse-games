import { MarkerType } from '../types.js';
import { drawLine, drawRectangle, fillCircle, fillRectangle } from '../util/draw.js';
import { AA_COLOR, CWIS_COLOR } from '../vars.js';

export class AbstractMarker {
    type: MarkerType;
    position: [number, number];
    priority: number;
    color: string;
    overwrite: boolean; // If false can co-exist with other markers

    /**
     * Construct a marker
     * @param type Type of marker
     * @param color Color to draw marker with
     * @param position Position (grid pos, [0,0] = top left)
     * @param priority Priority. Lower priority markers are replaced by higher ones in same spot
     */
    constructor(type: MarkerType, color: string, position: [number, number], priority: number) {
        if (this.constructor === AbstractMarker)
            throw new Error('Can\'t instantiate abstract class!');

        this.type = type;
        this.color = color;
        this.position = position;
        this.priority = priority;
        this.overwrite = true;
    }

    /**
     * Return an obj to sync server -> client
     * @returns obj
     */
    sync() {
        return [this.type, this.position];
    }

    /**
     * Draw the marker
     * @param ctx CTX
     * @param offset Grid offset
     * @param gridSize Grid size
     */
    draw(ctx: CanvasRenderingContext2D, offset: [number, number], gridSize: number) {
        // Override
    }

    /**
     * Helper to convert this position to canvas position
     * @param offset Grid offset
     * @param gridSize Grid size
     * @returns [x, y] on canvas
     */
    toCanvasPos(offset: [number, number], gridSize: number) {
        return [
            this.position[0] * gridSize + offset[0],
            this.position[1] * gridSize + offset[1]
        ];
    }

    /**
     * Create marker from type + pos
     * @param type Type of marker
     * @param position Pos of marker (grid)
     * @returns Marker
     */
    static markerFromType(type: MarkerType, position: [number, number]) {
        switch (type) {
            case MarkerType.HIT_MARKER:
                return new HitMarker(position);
            case MarkerType.MISS_MARKER:
                return new MissMarker(position);
            case MarkerType.MAYBE_HIT_MARKER:
                return new MaybeHitMarker(position);
            case MarkerType.MAYBE_MISS_MARKER:
                return new MaybeMissMarker(position);
            case MarkerType.UNKNOWN:
                return new MaybeUnknownMarker(position);
            case MarkerType.AA_SHOTDOWN:
                return new AirShotDownMarker(position);
            case MarkerType.MISSILE_SHOTDOWN:
                return new MissileShotDownMarker(position);
        }
        throw new Error(`Unknown marker type ${type}`);
    }
}

export class HitMarker extends AbstractMarker {
    constructor(position: [number, number]) {
        super(MarkerType.HIT_MARKER, 'red', position, 4);
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
        super(MarkerType.MISS_MARKER, 'white', position, 3);
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
        super(MarkerType.MAYBE_HIT_MARKER, 'red', position, 2);
    }

    draw(ctx: CanvasRenderingContext2D, offset: [number, number], gridSize: number) {
        let [tx, ty] = this.toCanvasPos(offset, gridSize);
        ctx.globalAlpha = 0.3;
        drawRectangle(ctx, [tx, ty], [gridSize, gridSize], this.color);
        fillCircle(ctx, [tx + gridSize / 2, ty + gridSize / 2], gridSize / 5, this.color);
        ctx.globalAlpha = 1;
    }
}

// When a stealth field interferes with a scan
export class MaybeUnknownMarker extends AbstractMarker {
    constructor(position: [number, number]) {
        super(MarkerType.UNKNOWN, '#777', position, 0);
    }

    draw(ctx: CanvasRenderingContext2D, offset: [number, number], gridSize: number) {
        let [tx, ty] = this.toCanvasPos(offset, gridSize);
        ctx.globalAlpha = 1;
        ctx.font = `${Math.round(gridSize * 0.75)}px Quantico`;
        ctx.fillStyle = this.color;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        ctx.fillText('?', tx + gridSize / 2, ty + gridSize / 2);
    }
}

export class MaybeMissMarker extends AbstractMarker {
    constructor(position: [number, number]) {
        super(MarkerType.MAYBE_MISS_MARKER, 'white', position, 2);
    }

    draw(ctx: CanvasRenderingContext2D, offset: [number, number], gridSize: number) {
        let [tx, ty] = this.toCanvasPos(offset, gridSize);
        ctx.globalAlpha = 0.3;
        drawRectangle(ctx, [tx, ty], [gridSize, gridSize], this.color);
        fillCircle(ctx, [tx + gridSize / 2, ty + gridSize / 2], gridSize / 8, this.color);
        ctx.globalAlpha = 1;
    }
}

class ShotDownMarker extends AbstractMarker {
    constructor(type: MarkerType, color: string, position: [number, number]) {
        super(type, color, position, -99);
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

export class MissileShotDownMarker extends ShotDownMarker {
    constructor(position: [number, number]) {
        super(MarkerType.MISSILE_SHOTDOWN, CWIS_COLOR, position);
    }
}

export class AirShotDownMarker extends ShotDownMarker {
    constructor(position: [number, number]) {
        super(MarkerType.AA_SHOTDOWN, AA_COLOR, position);
    }
}
