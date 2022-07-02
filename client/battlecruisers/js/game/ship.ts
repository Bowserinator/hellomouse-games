import { ROTATION } from '../types.js';
import { drawLine } from '../util/draw.js';
import { SHIP_OUTLINE_COLOR } from '../vars.js';

interface ShipConfig {
    shape: Array<Array<number>>;
    cwis?: number; // CWIS range
    aa?: number;   // Anti-air range
    stealth?: number; // Stealth range
    abilities?: Array<any>; // TODO
}

export class AbstractShip {
    name: string;
    config: ShipConfig;
    position: [number, number];
    size: [number, number];
    rotation: ROTATION;
    shape: Array<Array<number>>;

    /**
     * Construct a ship (abstract)
     * @param name Name of the ship
     * @param position Position (grid coord, [0, 0] = top left)
     * @param rotation Rotation of placement
     * @param config Config of ship
     */
    constructor(name: string, position: [number, number], rotation: ROTATION, config: ShipConfig) {
        if (this.constructor === AbstractShip)
            throw new Error('Can\'t instantiate abstract class!');

        this.name = name;
        this.position = position;
        this.rotation = rotation;
        this.config = config;

        // Set config defaults
        if (this.config.aa === undefined)
            this.config.aa = -1;
        if (this.config.cwis === undefined)
            this.config.cwis = -1;
        if (this.config.stealth === undefined)
            this.config.stealth = -1;
        if (this.config.abilities === undefined)
            this.config.abilities = [];

        // Compute shape
        this.shape = config.shape.map(row => [...row]);
        for (let i = 0; i < rotation; i++)
            this.shape = this.shape[0].map((val, index) => this.shape.map(row => row[index]).reverse());
        this.size = [this.shape[0].length, this.shape.length];
    }

    /**
     * Check if a coordinate lands on this ship
     * @param x x coordinate
     * @param y y coordinate
     * @returns Coordinate lands on ship?
     */
    checkSpot(x: number, y: number) {
        // Not in bounding box
        if (x < this.position[0] || y < this.position[0] ||
            x >= this.position[0] + this.size[0] || y >= this.position[1] + this.size[1])
            return false;
        return this.shape[y - this.position[1]][x - this.position[0]] !== 0;
    }

    /**
     * Draw the ship bounding box
     * @param ctx CTX
     * @param offset Offset (top left corner) for the grid
     * @param gridSize Grid cell size
     */
    draw(ctx: CanvasRenderingContext2D, offset: [number, number], gridSize: number) {
        // Draw the ship bounding box
        const shouldPlaceEdge = (x: number, y: number) => {
            if (!this.shape[y]) return true;
            if (!this.shape[y][x]) return true;
            return false;
        };

        for (let dy = 0; dy < this.size[1]; dy++)
            for (let dx = 0; dx < this.size[0]; dx++) {
                if (this.shape[dy][dx] === 0) continue;

                const tx = offset[0] + (this.position[0] + dx) * gridSize;
                const ty = offset[1] + (this.position[1] + dy) * gridSize;

                if (shouldPlaceEdge(dx, dy - 1)) // Top
                    drawLine(ctx, [tx, ty], [tx + gridSize, ty], SHIP_OUTLINE_COLOR);
                if (shouldPlaceEdge(dx, dy + 1)) // Bottom
                    drawLine(ctx, [tx, ty + gridSize], [tx + gridSize, ty + gridSize], SHIP_OUTLINE_COLOR);
                if (shouldPlaceEdge(dx - 1, dy)) // Left
                    drawLine(ctx, [tx, ty], [tx, ty + gridSize], SHIP_OUTLINE_COLOR);
                if (shouldPlaceEdge(dx + 1, dy)) // Right
                    drawLine(ctx, [tx + gridSize, ty], [tx + gridSize, ty + gridSize], SHIP_OUTLINE_COLOR);
            }
    }

    onHit() {

    }
}


/**
 * Aircraft carrier, has good AA and allows
 * spy planes to be launched
 */
export class CarrierShip extends AbstractShip {
    static config = {
        shape: [
            [1, 1, 1, 1, 1, 1, 1, 1],
            [1, 1, 1, 1, 1, 1, 0, 0]
        ],
        aa: 5,
        abilities: []
    };

    constructor(position: [number, number], rotation: ROTATION) {
        super('Carrier', position, rotation, CarrierShip.config);
    }
}

/** Battlecruiser, enables extra salvos */
export class BattlecruiserShip extends AbstractShip {
    static config = {
        shape: [[1, 1, 1, 1, 1, 1, 1]],
        abilities: []
    };

    constructor(position: [number, number], rotation: ROTATION) {
        super('Battlecruiser', position, rotation, BattlecruiserShip.config);
    }
}

/** Cruiser, enables cruise missiles */
export class CruiserShip extends AbstractShip {
    static config = {
        shape: [[1, 1, 1, 1, 1, 1]],
        aa: 3,
        abilities: []
    };

    constructor(position: [number, number], rotation: ROTATION) {
        super('Cruiser', position, rotation, CruiserShip.config);
    }
}

/** Nuke sub, allows firing tactical nukes */
export class MissileSubmarineShip extends AbstractShip {
    static config = {
        shape: [[1, 1, 1, 1, 1]],
        abilities: []
    };

    constructor(position: [number, number], rotation: ROTATION) {
        super('Strategic Missile Submarine', position, rotation, MissileSubmarineShip.config);
    }
}

/** AEGIS Ship, defends against missiles */
export class AegisShip extends AbstractShip {
    static config = {
        shape: [[1, 1, 1, 1, 1]],
        cwis: 4,
        abilities: []
    };

    constructor(position: [number, number], rotation: ROTATION) {
        super('AEGIS Cruiser', position, rotation, AegisShip.config);
    }
}

/** Counterintelligence ship, stealths ships from sonar */
export class CounterIntelShip extends AbstractShip {
    static config = {
        shape: [[1, 1, 1, 1]],
        aa: 3,
        abilities: []
    };

    constructor(position: [number, number], rotation: ROTATION) {
        super('Counterintelligence Ship', position, rotation, CounterIntelShip.config);
    }
}

/** Destroyer, allows for extra salvos */
export class DestroyerShip extends AbstractShip {
    static config = {
        shape: [[1, 1, 1, 1]],
        aa: 2,
        abilities: []
    };

    constructor(position: [number, number], rotation: ROTATION) {
        super('Destroyer', position, rotation, DestroyerShip.config);
    }
}

/** Submarine, allows for sonar scans */
export class SubmarineShip extends AbstractShip {
    static config = {
        shape: [[1, 1, 1]],
        abilities: []
    };

    constructor(position: [number, number], rotation: ROTATION) {
        super('Submarine', position, rotation, SubmarineShip.config);
    }
}

/** Mine, explodes enemy's board when activated */
export class MineShip extends AbstractShip {
    static config = {
        shape: [[1]],
        cwis: -1,
        aa: -1,
        abilities: []
    };

    constructor(position: [number, number], rotation: ROTATION) {
        super('Mine', position, rotation, MineShip.config);
    }
}
