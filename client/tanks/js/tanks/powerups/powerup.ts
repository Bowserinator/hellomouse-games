

// methods:
// -draw()
// -create(tank)

import Tank from '../tank.js';
import { Powerup } from '../../types.js';

//     NONE, MISSILE, LASER, SHOTGUN, BOMB, CLOAK, SHIELD

export class PowerupSingleton {
    constructor(tank: Tank, type: Powerup) {
        this.type = type;
        this.tank = tank;
    }

    draw(camera: Camera) {
        // Override
    }

    update(gameState: GameState) {
        // Override
    }

    stop(gameState: GameState) {
        // TODO: reset turret appearance and other values
        // Remove tank powerupSingleton + powerup
        // TODO: send update to client
        this.tank.powerupSingleton = null;
    }
}
