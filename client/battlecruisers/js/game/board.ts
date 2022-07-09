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
     * Draw the grid
     * @param ctx CTX
     * @param drawBase Draw the base grid? False if overlaying on existing grid
     */
    draw(ctx: CanvasRenderingContext2D, drawBase = true) {
        // Override
    }
}
