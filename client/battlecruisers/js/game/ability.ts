import GameState from './gamestate.js';
import { AirShotDownMarker, MissileShotDownMarker } from './marker.js';

/**
 * An ability singleton
 * @author Bowserinator
 */
export class AbstractAbility {
    name: string;
    cooldown: number;

    /**
     * Constructor
     * @param name Name of the ability
     * @param cooldown Cooldown in # of rounds
     */
    constructor(name: string, cooldown: number) {
        this.name = name;
        this.cooldown = cooldown;
    }

    /**
     * Do the ability
     * @param playerIndex The index of the player perfomring the action (target = 1 - playerIndex)
     * @param gameState
     * @param pos Where to use
     */
    do(playerIndex: number, gameState: GameState, pos: [number, number]) {
        // TODO: what params?
    }
}

class TorpedoBomberAbility extends AbstractAbility {
    constructor() {
        super('Torpedo Bomber', 2);
    }

    // Attack in a cross pattern
    do(playerIndex: number, gameState: GameState, pos: [number, number]) {
        const [x, y] = pos;

        // Planes get shot down by AA
        if (gameState.players[playerIndex].shipBoard.aa[y][x]) {
            gameState.players[1 - playerIndex].markerBoard.addMarker(new AirShotDownMarker(pos));
            return;
        }

        gameState.attack(1 - playerIndex, pos);
        gameState.attack(1 - playerIndex, [x - 1, y]);
        gameState.attack(1 - playerIndex, [x + 1, y]);
        gameState.attack(1 - playerIndex, [x, y - 1]);
        gameState.attack(1 - playerIndex, [x, y + 1]);
    }
}

class SonarAbility extends AbstractAbility {
    constructor() {
        super('Sonar Ping', 2);
    }

    // Probe 3x3 square
    do(playerIndex: number, gameState: GameState, pos: [number, number]) {
        const [x, y] = pos;
        for (let dx = -1; dx <= 1; dx++)
            for (let dy = -1; dy <= 1; dy++)
                gameState.probe(1 - playerIndex, [x + dx, y + dy]);
    }
}

class NuclearTorpedoAbility extends AbstractAbility {
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
}

class CruiseMissileAbility extends AbstractAbility {
    constructor() {
        super('Cruise Missile', 2);
    }

    // Attack in a X pattern
    do(playerIndex: number, gameState: GameState, pos: [number, number]) {
        const [x, y] = pos;

        // Missiles get shot down by CWIS
        if (gameState.players[playerIndex].shipBoard.cwis[y][x]) {
            gameState.players[1 - playerIndex].markerBoard.addMarker(new MissileShotDownMarker(pos));
            return;
        }

        gameState.attack(1 - playerIndex, pos);
        gameState.attack(1 - playerIndex, [x - 1, y - 1]);
        gameState.attack(1 - playerIndex, [x + 1, y - 1]);
        gameState.attack(1 - playerIndex, [x - 1, y + 1]);
        gameState.attack(1 - playerIndex, [x + 1, y + 1]);
    }
}

class SalvoAbility extends AbstractAbility {
    constructor() {
        super('Salvo', 0);
    }

    // Attack the position
    do(playerIndex: number, gameState: GameState, pos: [number, number]) {
        gameState.attack(1 - playerIndex, pos);
    }
}

class MineAbility extends AbstractAbility {
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
}

// Singletons
export const TORPEDO_BOMBER = new TorpedoBomberAbility();
export const SONAR = new SonarAbility();
export const NUKE = new NuclearTorpedoAbility();
export const MISSILE = new CruiseMissileAbility();
export const SALVO = new SalvoAbility();
export const MINE = new MineAbility();
