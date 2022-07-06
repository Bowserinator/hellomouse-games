import { drawRectangle } from '../util/draw.js';
import { BOARD_SIZE } from '../vars.js';
import GameState from './gamestate.js';
import { AirShotDownMarker, MaybeHitMarker, MaybeMissMarker, MissileShotDownMarker } from './marker.js';
import { MarkerBoard } from './marker_board.js';

/**
 * An ability singleton
 * @author Bowserinator
 */
export class AbstractAbility {
    name: string;
    cooldown: number;
    lastRoundActivated: number;

    /**
     * Constructor
     * @param name Name of the ability
     * @param cooldown Cooldown in # of rounds
     */
    constructor(name: string, cooldown: number) {
        this.name = name;
        this.cooldown = cooldown;
        this.lastRoundActivated = -1;
    }

    /**
     * Do the ability
     * @param playerIndex The index of the player perfomring the action (target = 1 - playerIndex)
     * @param gameState
     * @param pos Where to use
     */
    do(playerIndex: number, gameState: GameState, pos: [number, number]) {
        // Override
    }

    /**
     * Draw fire preview
     * @param ctx
     * @param board Board to draw
     * @param pos Grid coordinate
     */
    drawPreview(ctx: CanvasRenderingContext2D, board: MarkerBoard, pos: [number, number]) {
        // Override
    }

    /**
     * Make a clone
     * @return this
     */
    clone() {
        throw new Error('Must override this');
    }

    /**
     * Check if active
     * @param round Round the powerup is active in
     * @returns Is the powerup active this round/
     */
    isNotActive(round: number) {
        return this.lastRoundActivated >= 0 && round - this.lastRoundActivated < this.cooldown;
    }
}

export class TorpedoBomberAbility extends AbstractAbility {
    constructor() {
        super('Torpedo Bomber', 2);
    }

    // Attack in a cross pattern
    do(playerIndex: number, gameState: GameState, pos: [number, number]) {
        const [x, y] = pos;

        // Planes get shot down by AA
        if (gameState.players[1 - playerIndex].shipBoard.aa[y][x]) {
            gameState.players[playerIndex].markerBoard.addMarker(new AirShotDownMarker(pos));
            return;
        }

        gameState.attack(1 - playerIndex, pos);
        gameState.attack(1 - playerIndex, [x - 1, y]);
        gameState.attack(1 - playerIndex, [x + 1, y]);
        gameState.attack(1 - playerIndex, [x, y - 1]);
        gameState.attack(1 - playerIndex, [x, y + 1]);
    }

    drawPreview(ctx: CanvasRenderingContext2D, board: MarkerBoard, pos: [number, number]) {
        const g = board.gridSize;
        const [tx, ty] = [
            board.offset[0] + pos[0] * g,
            board.offset[1] + pos[1] * g];
        drawRectangle(ctx, [tx, ty], [g, g], 'red');
        drawRectangle(ctx, [tx - g, ty], [g, g], 'red');
        drawRectangle(ctx, [tx + g, ty], [g, g], 'red');
        drawRectangle(ctx, [tx, ty - g], [g, g], 'red');
        drawRectangle(ctx, [tx, ty + g], [g, g], 'red');
    }

    clone() {
        return new TorpedoBomberAbility();
    }
}

export class SonarAbility extends AbstractAbility {
    constructor() {
        super('Sonar Ping', 2);
    }

    // Probe 3x3 square, Marks all squares as "potential targets"
    // unless one is in a stealth field
    do(playerIndex: number, gameState: GameState, pos: [number, number]) {
        const [x, y] = pos;
        let anyPartInStealth = false;
        let anyPartHit = false;

        let points = [];
        for (let dx = -1; dx <= 1; dx++)
            for (let dy = -1; dy <= 1; dy++) {
                let p: [number, number] = [x + dx, y + dy];
                if (p[0] < 0 || p[1] < 0 || p[0] >= BOARD_SIZE || p[1] >= BOARD_SIZE)
                    continue;
                points.push(p);
            }

        for (let p of points) {
            // Check if not stealthed
            let stealthed = gameState.players[1 - playerIndex].shipBoard.stealth[p[1]][p[0]];
            if (!stealthed && gameState.players[1 - playerIndex].shipBoard.shipGrid[p[1]][p[0]])
                anyPartHit = true;
            if (anyPartInStealth)
                anyPartInStealth = true;
        }
        for (let p of points)
            gameState.players[playerIndex].markerBoard.addMarker(
                (!anyPartInStealth && anyPartHit)
                    ? new MaybeHitMarker(p)
                    : new MaybeMissMarker(p)
            );
    }

    drawPreview(ctx: CanvasRenderingContext2D, board: MarkerBoard, pos: [number, number]) {
        const [tx, ty] = [
            board.offset[0] + pos[0] * board.gridSize - board.gridSize,
            board.offset[1] + pos[1] * board.gridSize - board.gridSize];
        drawRectangle(ctx, [tx, ty], [board.gridSize * 3, board.gridSize * 3], 'white');
    }

    clone() {
        return new SonarAbility();
    }
}

export class NuclearTorpedoAbility extends AbstractAbility {
    constructor() {
        super('Nuclear Torpedo', 12);
    }

    // Attack in a 7x7 square
    do(playerIndex: number, gameState: GameState, pos: [number, number]) {
        const [x, y] = pos;
        for (let dx = -3; dx <= 3; dx++)
            for (let dy = -3; dy <= 3; dy++)
                gameState.attack(1 - playerIndex, [x + dx, y + dy]);
    }

    drawPreview(ctx: CanvasRenderingContext2D, board: MarkerBoard, pos: [number, number]) {
        const [tx, ty] = [
            board.offset[0] + pos[0] * board.gridSize - 3 * board.gridSize,
            board.offset[1] + pos[1] * board.gridSize - 3 * board.gridSize];
        drawRectangle(ctx, [tx, ty], [board.gridSize * 7, board.gridSize * 7], 'red');
    }

    clone() {
        return new NuclearTorpedoAbility();
    }
}

export class CruiseMissileAbility extends AbstractAbility {
    constructor() {
        super('Cruise Missile', 2);
    }

    // Attack in a X pattern
    do(playerIndex: number, gameState: GameState, pos: [number, number]) {
        const [x, y] = pos;

        // Missiles get shot down by CWIS
        if (gameState.players[1 - playerIndex].shipBoard.cwis[y][x]) {
            gameState.players[playerIndex].markerBoard.addMarker(new MissileShotDownMarker(pos));
            return;
        }

        gameState.attack(1 - playerIndex, pos);
        gameState.attack(1 - playerIndex, [x - 1, y - 1]);
        gameState.attack(1 - playerIndex, [x + 1, y - 1]);
        gameState.attack(1 - playerIndex, [x - 1, y + 1]);
        gameState.attack(1 - playerIndex, [x + 1, y + 1]);
    }

    drawPreview(ctx: CanvasRenderingContext2D, board: MarkerBoard, pos: [number, number]) {
        const g = board.gridSize;
        const [tx, ty] = [
            board.offset[0] + pos[0] * g,
            board.offset[1] + pos[1] * g];
        drawRectangle(ctx, [tx, ty], [g, g], 'red');
        drawRectangle(ctx, [tx - g, ty - g], [g, g], 'red');
        drawRectangle(ctx, [tx - g, ty + g], [g, g], 'red');
        drawRectangle(ctx, [tx + g, ty - g], [g, g], 'red');
        drawRectangle(ctx, [tx + g, ty + g], [g, g], 'red');
    }

    clone() {
        return new CruiseMissileAbility();
    }
}

export class SalvoAbility extends AbstractAbility {
    constructor() {
        super('Salvo', 0);
    }

    // Attack the position
    do(playerIndex: number, gameState: GameState, pos: [number, number]) {
        gameState.attack(1 - playerIndex, pos);
    }

    drawPreview(ctx: CanvasRenderingContext2D, board: MarkerBoard, pos: [number, number]) {
        const [tx, ty] = [
            board.offset[0] + pos[0] * board.gridSize,
            board.offset[1] + pos[1] * board.gridSize];
        drawRectangle(ctx, [tx, ty], [board.gridSize, board.gridSize], 'red');
    }

    clone() {
        return new SalvoAbility();
    }
}

export class MineAbility extends AbstractAbility {
    constructor() {
        super('Mine', 0);
    }

    // Attack the position
    do(playerIndex: number, gameState: GameState, pos: [number, number]) {
        // Attack the player who's attacking
        const [x, y] = pos;
        for (let dx = -1; dx <= 1; dx++)
            for (let dy = -1; dy <= 1; dy++)
                gameState.attack(playerIndex, [x + dx, y + dy]);
    }

    clone() {
        return new MineAbility();
    }
}

// Singletons
export const TORPEDO_BOMBER = new TorpedoBomberAbility();
export const SONAR = new SonarAbility();
export const NUKE = new NuclearTorpedoAbility();
export const MISSILE = new CruiseMissileAbility();
export const SALVO = new SalvoAbility();
export const MINE = new MineAbility();
