import { ROTATION } from '../types.js';
import { drawLine } from '../util/draw.js';
import { AA_COLOR, CWIS_COLOR, SHIP_OUTLINE_COLOR, STEALTH_COLOR } from '../vars.js';
import { AbstractAbility, MINE, MISSILE, NUKE, SONAR, TORPEDO_BOMBER } from './ability.js';
import GameState from './gamestate.js';
import { MarkerBoard } from './marker_board.js';
import { ShipBoard } from './ship_board.js';

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
    abilities: Array<AbstractAbility>;
    isPlaced: boolean;
    index: number;
    imageUrl: string;
    lives: number;
    totalLives: number;

    /**
     * Construct a ship (abstract)
     * @param img Image url of ship, not including prefix of /battlecruisers/img/ships/
     * @param name Name of the ship
     * @param position Position (grid coord, [0, 0] = top left)
     * @param rotation Rotation of placement
     * @param config Config of ship
     */
    constructor(img: string, name: string, position: [number, number], rotation: ROTATION, config: ShipConfig) {
        if (this.constructor === AbstractShip)
            throw new Error('Can\'t instantiate abstract class!');

        this.imageUrl = '/battlecruisers/img/ships/' + img;
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

        // Copy abilities
        this.abilities = this.config.abilities.map(a => a.clone());
        this.index = -1; // Set in player

        // Compute shape
        this.shape = config.shape.map(row => [...row]);
        for (let i = 0; i < rotation; i++)
            this.shape = this.shape[0].map((val, index) => this.shape.map(row => row[index]).reverse());
        this.size = [this.shape[0].length, this.shape.length];
        this.lives = this.shape.flat().filter(x => x > 0).length;
        this.totalLives = this.lives;
    }

    /**
     * Get a sync object
     * @returns obj
     */
    sync() {
        return [this.index, this.isPlaced, this.position, this.rotation, this.abilities.map(a => a.sync()), this.lives];
    }

    /**
     * Update from server
     * @param data Server data
     */
    fromSync(data: any) {
        if (data[0] !== this.index) {
            console.error(`Warning: Ship index doesn't match, I'm ${this.index}, got ${data[0]}`);
            return;
        }
        this.isPlaced = data[1];
        if (data[2] !== -1)
            this.position = data[2];
        if (data[3] !== -1)
            this.rotation = data[3];
        this.lives = Math.min(data[5], this.totalLives);
        if (data[4] !== -1)
            for (let i = 0; i < data[4].length; i++)
                this.abilities[i].fromSync(data[4][i]);
    }

    /**
     * Get the center grid coordinate of the ship rounded down
     * @returns [x, y]
     */
    getCenter(): [number, number] {
        let f1 = ROTATION.R0 === this.rotation ? Math.ceil : Math.floor;
        let f2 = ROTATION.R90 === this.rotation ? Math.ceil : Math.floor;
        return [f1(this.position[0] + (this.size[0] - 1) / 2), f2(this.position[1] + (this.size[1] - 1) / 2)];
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
     * @param board Board this is being placed on
     * @param ctx CTX
     * @param color Color to draw range
     * @param offset Grid offset
     * @param gridSize Grid size
     * @param range Range (from center, square, total length = 2 * range + 1)
     */
    drawPlacingRange(board: ShipBoard, ctx: CanvasRenderingContext2D, color: string, range: number) {
        const center = this.getCenter();
        board.drawOutlinedRectangle(ctx, center[0] - range, center[1] - range, 2 * range + 1, 2 * range + 1, color);
    }

    /**
     * Draw all placement range previews
     * @param ctx CTX
     * @param offset Grid offset
     * @param gridSize Grid size
     */
    drawPlacingRanges(board: ShipBoard, ctx: CanvasRenderingContext2D) {
        if (this.config.cwis && this.config.cwis >= 0)
            this.drawPlacingRange(board, ctx, CWIS_COLOR, this.config.cwis);
        if (this.config.aa && this.config.aa >= 0)
            this.drawPlacingRange(board, ctx, AA_COLOR, this.config.aa);
        if (this.config.stealth && this.config.stealth >= 0)
            this.drawPlacingRange(board, ctx, STEALTH_COLOR, this.config.stealth);
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

    /**
     * Check hits, and act if sunk
     * @param playerIndex Index of enemy player
     * @param gameState
     * @param shipBoard shipBoard this ship belongs to
     * @param markerBoard Marker board of the enemy
     */
    checkHits(playerIndex: number, gameState: GameState, shipBoard: ShipBoard, markerBoard: MarkerBoard) {
        this.lives = this.totalLives;
        for (let marker of markerBoard.hitMarkers)
            if (this.checkSpot(...marker.position))
                this.lives--;

        if (this.lives <= 0) {
            // Recompute maps since dead ships dont have AA/CWIS/etc..
            this.lives = 0;
            shipBoard.resetMaps();
            shipBoard.ships.forEach(s => shipBoard.computeShipMaps(s));
            this.abilities.forEach(a => a.disabled = true); // Sunk ships don't have abilities
        }
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
        abilities: [TORPEDO_BOMBER, TORPEDO_BOMBER, TORPEDO_BOMBER]
    };

    constructor(position: [number, number], rotation: ROTATION) {
        super('carrier.png', 'Carrier', position, rotation, CarrierShip.config);
    }
}

/** Battlecruiser, enables extra salvos */
export class BattlecruiserShip extends AbstractShip {
    static config = {
        shape: [[1, 1, 1, 1, 1, 1, 1]],
        abilities: []
    };

    constructor(position: [number, number], rotation: ROTATION) {
        super('battlecruiser.png', 'Battlecruiser', position, rotation, BattlecruiserShip.config);
    }
}

/** Cruiser, enables cruise missiles */
export class CruiserShip extends AbstractShip {
    static config = {
        shape: [[1, 1, 1, 1, 1, 1]],
        aa: 2,
        abilities: [MISSILE]
    };

    constructor(position: [number, number], rotation: ROTATION) {
        super('cruiser.png', 'Cruiser', position, rotation, CruiserShip.config);
    }
}

/** Nuke sub, allows firing tactical nukes */
export class MissileSubmarineShip extends AbstractShip {
    static config = {
        shape: [[1, 1, 1, 1, 1]],
        abilities: [NUKE]
    };

    constructor(position: [number, number], rotation: ROTATION) {
        super('strat_sub.png', 'Strategic Missile Submarine', position, rotation, MissileSubmarineShip.config);
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
        super('aegis.png', 'AEGIS Cruiser', position, rotation, AegisShip.config);
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
        super('stealth.png', 'Counterintelligence Ship', position, rotation, CounterIntelShip.config);
    }
}

/** Destroyer, allows for extra salvos */
export class DestroyerShip extends AbstractShip {
    static config = {
        shape: [[1, 1, 1, 1]],
        abilities: []
    };

    constructor(position: [number, number], rotation: ROTATION) {
        super('destroyer.png', 'Destroyer', position, rotation, DestroyerShip.config);
    }
}

/** Submarine, allows for sonar scans */
export class SubmarineShip extends AbstractShip {
    static config = {
        shape: [[1, 1, 1]],
        abilities: [SONAR]
    };

    constructor(position: [number, number], rotation: ROTATION) {
        super('sub.png', 'Submarine', position, rotation, SubmarineShip.config);
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
        super('mine.png', 'Mine', position, rotation, MineShip.config);
    }

    checkHits(playerIndex: number, gameState: GameState, shipBoard: ShipBoard, markerBoard: MarkerBoard) {
        super.checkHits(playerIndex, gameState, shipBoard, markerBoard);
        if (this.lives === 0)
            MINE.do(playerIndex, gameState, this.position);
    }
}
