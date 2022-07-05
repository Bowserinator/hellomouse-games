import { drawLine } from '../util/draw.js';
import drawGrid from '../util/draw_grid.js';
import { AA_COLOR, BOARD_SIZE, CWIS_COLOR, STEALTH_COLOR } from '../vars.js';
import { AbstractShip } from './ship.js';

/**
 * Board that contains ship placements (for your own ships)
 * @author Bowserinator
 */
export class ShipBoard {
    ships: Array<AbstractShip>;
    offset: [number, number];
    gridSize: number;

    stealth: Array<Array<number>>;
    aa: Array<Array<number>>;
    cwis: Array<Array<number>>;

    constructor(offset: [number, number], gridSize: number) {
        this.ships = [];
        this.offset = offset;
        this.gridSize = gridSize;
    }

    /** Reset when game restarts */
    reset() {
        this.ships.forEach(ship => ship.isPlaced = false);
        this.ships = [];
        this.resetMaps();
    }

    /** Reset maps */
    resetMaps() {
        const makeArr = () => {
            let r = [];
            for (let i = 0; i < BOARD_SIZE; i++)
                r.push(new Array(BOARD_SIZE).fill(0));
            return r;
        };
        this.stealth = makeArr();
        this.cwis = makeArr();
        this.aa = makeArr();
    }

    /**
     * Check if a click is on the board
     * @param x
     * @param y
     * @returns Is (x,y) on the board
     */
    isOnBoard(x: number, y : number) {
        const size = this.gridSize * BOARD_SIZE;
        return x >= this.offset[0] && y >= this.offset[1] &&
            x <= this.offset[0] + size && y <= this.offset[1] + size;
    }

    /**
     * Can a ship be placed?
     * @returns {boolean}
     */
    canPlace(ship: AbstractShip) {
        const [x, y] = ship.position;
        const [w, h] = ship.size;

        // Check position bounds
        if (x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE)
            return false;
        if (x + w > BOARD_SIZE || y + h > BOARD_SIZE)
            return false;

        // Check if placement is occupied
        for (let ny = y; ny < y + h; ny++)
            for (let nx = x; nx < x + w; nx++)
                for (let otherShip of this.ships)
                    if (ship.shape[ny - y][nx - x] !== 0 && otherShip.checkSpot(nx, ny))
                        return false;
        return true;
    }

    /**
     * Place a ship on the board
     * @returns {boolean} Was the placement successful?
     */
    place(ship: AbstractShip) {
        if (!this.canPlace(ship))
            return false;

        // Valid placement
        ship.isPlaced = true;
        this.ships.push(ship);
        this.computeShipMaps(ship);
        return true;
    }

    /**
     * Update maps for a ship
     * @param ship
     */
    computeShipMaps(ship: AbstractShip) {
        if (ship.config.cwis && ship.config.cwis >= 0)
            this.fillMap(this.cwis, ship.getCenter(), ship.config.cwis);
        if (ship.config.aa && ship.config.aa >= 0)
            this.fillMap(this.aa, ship.getCenter(), ship.config.aa);
        if (ship.config.stealth && ship.config.stealth >= 0)
            this.fillMap(this.stealth, ship.getCenter(), ship.config.stealth);
    }

    /**
     * Remove a ship from the board, also recomputes maps
     * @param ship Ship to remove
     */
    removeShip(ship: AbstractShip) {
        ship.isPlaced = false;
        this.ships = this.ships.filter(s => s !== ship);
        this.resetMaps();
        this.ships.forEach(s => this.computeShipMaps(s));
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
        x = Math.max(0, Math.min(BOARD_SIZE - 1, Math.round(x)));
        y = Math.max(0, Math.min(BOARD_SIZE - 1, Math.round(y)));
        return [x, y];
    }

    /**
     * Draw a square in the range data map
     * @param map Map to fill
     * @param center Center of the square
     * @param range Range to extend both sides
     */
    fillMap(map: Array<Array<number>>, center: [number, number], range: number) {
        for (let x = Math.max(0, center[0] - range); x <= Math.min(center[0] + range, BOARD_SIZE - 1); x++)
            for (let y = Math.max(0, center[1] - range); y <= Math.min(center[1] + range, BOARD_SIZE - 1); y++)
                map[y][x] = 1;
    }

    /**
     * Draw a map range
     * @param ctx
     * @param map Map to draw
     * @param color Color to fill
     */
    drawMap(ctx: CanvasRenderingContext2D, map: Array<Array<number>>, color: string) {
        for (let x = 0; x < BOARD_SIZE; x++)
            for (let y = 0; y < BOARD_SIZE; y++)
                if (map[y][x]) {
                    // eslint-disable-next-line @typescript-eslint/no-shadow
                    const shouldPlaceEdge = (x: number, y: number) => {
                        if (!map[y]) return true;
                        if (!map[y][x]) return true;
                        return false;
                    };
                    const [tx, ty] = [this.offset[0] + x * this.gridSize, this.offset[1] + y * this.gridSize];
                    const gridSize = this.gridSize;

                    ctx.fillStyle = color;
                    ctx.globalAlpha = 0.1;
                    ctx.fillRect(tx, ty, gridSize, gridSize);
                    ctx.globalAlpha = 0.9;

                    if (shouldPlaceEdge(x, y - 1)) // Top
                        drawLine(ctx, [tx, ty], [tx + gridSize, ty], color);
                    if (shouldPlaceEdge(x, y + 1)) // Bottom
                        drawLine(ctx, [tx, ty + gridSize], [tx + gridSize, ty + gridSize], color);
                    if (shouldPlaceEdge(x - 1, y)) // Left
                        drawLine(ctx, [tx, ty], [tx, ty + gridSize], color);
                    if (shouldPlaceEdge(x + 1, y)) // Right
                        drawLine(ctx, [tx + gridSize, ty], [tx + gridSize, ty + gridSize], color);
                }
        ctx.globalAlpha = 1;
    }

    /**
     * Draw the board where ships are placed
     * @param ctx CTX to render to
     */
    draw(ctx: CanvasRenderingContext2D) {
        drawGrid(ctx, this.offset, this.gridSize);

        // Ranges
        this.drawMap(ctx, this.aa, AA_COLOR);
        this.drawMap(ctx, this.cwis, CWIS_COLOR);
        this.drawMap(ctx, this.stealth, STEALTH_COLOR);

        // Ships
        this.ships.forEach(ship => ship.draw(ctx, this.offset, this.gridSize));
    }
}
