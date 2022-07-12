import { drawRectangle } from '../util/draw.js';
import { BOARD_SIZE } from '../vars.js';

/**
 * Abstract board
 * @author Bowserinator
 */
export class Board {
    offset: [number, number];
    gridSize: number;

    constructor(offset: [number, number], gridSize: number) {
        this.offset = offset;
        this.gridSize = gridSize;
    }

    /** Reset when game restarts */
    reset() {
        // Override
    }

    /**
     * Return an object for syncing server -> client
     * @returns obj
     */
    sync() {
        // Override
    }

    /**
     * Server -> client, client side processing
     * @param data Data from server
     */
    fromSync(data: any) {
        // Override
    }

    /**
     * Check if a click is on the board
     * @param x
     * @param y
     * @returns Is (x,y) on the board
     */
    isOnBoard(x: number, y: number) {
        const size = this.gridSize * BOARD_SIZE;
        return x >= this.offset[0] && y >= this.offset[1] &&
            x <= this.offset[0] + size && y <= this.offset[1] + size;
    }

    /**
     * Convert a click location to grid location
     * @param x Mouse x
     * @param y Mouse y
     * @returns [x, y] Grid coordinate, if out of bounds rounds to nearest
     */
    getClickLocation(x: number, y: number): [number, number] {
        x = (x - this.offset[0]) / this.gridSize;
        y = (y - this.offset[1]) / this.gridSize;
        x = Math.max(0, Math.min(BOARD_SIZE - 1, Math.floor(x)));
        y = Math.max(0, Math.min(BOARD_SIZE - 1, Math.floor(y)));
        return [x, y];
    }

    /**
     * Draw rectangular outline on the grid, automatically prevents
     * rectangle from going out of bounds
     * @param ctx CTX
     * @param x Grid x
     * @param y Grid y
     * @param w Width (grid cells)
     * @param h Height (grid cells)
     * @param color Color
     */
    drawOutlinedRectangle(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
        if (x + w < 0 || x >= BOARD_SIZE || y + h < 0 || y >= BOARD_SIZE)
            return;

        let x2 = Math.min(Math.max(0, x), BOARD_SIZE - 1);
        let y2 = Math.min(Math.max(0, y), BOARD_SIZE - 1);
        w = Math.min(x + w - x2, BOARD_SIZE - x);
        h = Math.min(y + h - y2, BOARD_SIZE - y);
        x2 = x2 * this.gridSize + this.offset[0];
        y2 = y2 * this.gridSize + this.offset[1];
        drawRectangle(ctx, [x2, y2], [this.gridSize * w, this.gridSize * h], color);
    }

    /**
     * Draw the grid
     * @param ctx CTX
     * @param drawBase Draw the base grid? False if overlaying on existing grid
     */
    draw(ctx: CanvasRenderingContext2D, drawBase = true) {
        // Override
    }
}
