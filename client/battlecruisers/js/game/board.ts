import { BOARD_SIZE } from '../vars.js';
import { AbstractShip } from './ship.js';

/**
 * Board that contains ship placements (for your own ships)
 * @author Bowserinator
 */
export class ShipBoard {
    ships: Array<AbstractShip>;

    constructor() {
        this.ships = [];
    }

    /**
     * Place a ship on the board
     * @returns {boolean} Was the placement successful?
     */
    place(ship: AbstractShip) {
        const shape = ship.shape;
        const [x, y] = ship.position;
        const [w, h] = [shape[0].length, shape.length];

        // Check position bounds
        if (x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE)
            return false;
        if (x + w >= BOARD_SIZE || y + h >= BOARD_SIZE)
            return false;

        // Check if placement is occupied
        for (let ny = y; ny < y + h; ny++)
            for (let nx = x; nx < x + w; nx++)
                for (let otherShip of this.ships)
                    if (otherShip.checkSpot(nx, ny))
                        return false;

        // Valid placement
        this.ships.push(ship);
        return true;
    }

    /**
     * Draw the board where ships are placed
     * @param ctx CTX to render to
     * @param gridSize Size of a single grid spot, can be dynamic
     */
    draw(ctx: CanvasRenderingContext2D, gridSize: number) {
        // TODO: draw bounding box + grid lines

        this.ships.forEach(ship => ship.draw(ctx, [0, 0], gridSize));
    }
}


/**
 * Board that shows your hits on the enemy
 * @author Bowserinator
 */
export class MarkerBoard {
    // Contains: markers?
    // todo: store history of markers and rounds so u can show a single round maybe?

    constructor() {

    }
}
