import { ROTATION } from '../types.js';
import { drawLine } from '../util/draw.js';
import { AA_COLOR, CWIS_COLOR, SHIP_OUTLINE_COLOR, STEALTH_COLOR } from '../vars.js';

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
    isPlaced: boolean;

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
        this.isPlaced = false;

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
     * Get the center grid coordinate of the ship rounded down
     * @returns [x, y]
     */
    getCenter(): [number, number] {
        return [Math.floor(this.position[0] + this.size[0] / 2), Math.floor(this.position[1] + this.size[1] / 2)];
    }

    /**
     * Change the ship rotation, updates size + shape + rotation
     * @param rotation Rotation enum
     */
    setRotation(rotation: ROTATION) {
        this.rotation = rotation;
        this.shape = this.config.shape.map(row => [...row]);
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
        if (x < this.position[0] || y < this.position[1] ||
            x >= this.position[0] + this.size[0] || y >= this.position[1] + this.size[1])
            return false;
        return this.shape[y - this.position[1]][x - this.position[0]] !== 0;
    }

    /**
     * Draw a single placement range preview
     * @param ctx CTX
     * @param color Color to draw range
     * @param offset Grid offset
     * @param gridSize Grid size
     * @param range Range (from center, square, total length = 2 * range + 1)
     */
    drawPlacingRange(ctx: CanvasRenderingContext2D, color: string, offset: [number, number],
        gridSize: number, range: number) {
        const center = this.getCenter();
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.rect(
            center[0] * gridSize - gridSize * range + offset[0],
            center[1] * gridSize - gridSize * range + offset[1],
            gridSize * (range * 2 + 1),
            gridSize * (range * 2 + 1));
        ctx.stroke();
    }

    /**
     * Draw all placement range previews
     * @param ctx CTX
     * @param offset Grid offset
     * @param gridSize Grid size
     */
    drawPlacingRanges(ctx: CanvasRenderingContext2D, offset: [number, number], gridSize: number) {
        if (this.config.cwis && this.config.cwis >= 0)
            this.drawPlacingRange(ctx, CWIS_COLOR, offset, gridSize, this.config.cwis);
        if (this.config.aa && this.config.aa >= 0)
            this.drawPlacingRange(ctx, AA_COLOR, offset, gridSize, this.config.aa);
        if (this.config.stealth && this.config.stealth >= 0)
            this.drawPlacingRange(ctx, STEALTH_COLOR, offset, gridSize, this.config.stealth);
    }

    /**
     * Fill the ship outline
     * @param ctx ctx
     * @param offset Grid offset
     * @param gridSize Size of grid cell
     * @param color Color to draw + fill
     */
    drawBoundingBox(ctx: CanvasRenderingContext2D, offset: [number, number], gridSize: number, color: string) {
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

                ctx.globalAlpha = 0.25;
                ctx.fillStyle = color;
                ctx.fillRect(tx, ty, gridSize, gridSize);
                ctx.globalAlpha = 1;

                if (shouldPlaceEdge(dx, dy - 1)) // Top
                    drawLine(ctx, [tx, ty], [tx + gridSize, ty], color);
                if (shouldPlaceEdge(dx, dy + 1)) // Bottom
                    drawLine(ctx, [tx, ty + gridSize], [tx + gridSize, ty + gridSize], color);
                if (shouldPlaceEdge(dx - 1, dy)) // Left
                    drawLine(ctx, [tx, ty], [tx, ty + gridSize], color);
                if (shouldPlaceEdge(dx + 1, dy)) // Right
                    drawLine(ctx, [tx + gridSize, ty], [tx + gridSize, ty + gridSize], color);
            }
    }

    /**
     * Draw the ship bounding box
     * @param ctx CTX
     * @param offset Offset (top left corner) for the grid
     * @param gridSize Grid cell size
     */
    draw(ctx: CanvasRenderingContext2D, offset: [number, number], gridSize: number) {
        this.drawBoundingBox(ctx, offset, gridSize, SHIP_OUTLINE_COLOR);
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
        aa: 2,
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
        stealth: 3,
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
        aa: 1,
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
