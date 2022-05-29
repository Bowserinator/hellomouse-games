import Tank from '../tank.js';
import { Powerup } from '../../types.js';
import Camera from '../../renderer/camera.js';
import GameState from '../gamestate.js';

//     NONE, MISSILE, LASER, SHOTGUN, BOMB, CLOAK, SHIELD

export class PowerupSingleton {
    tank: Tank;
    type: Powerup;

    constructor(tank: Tank, type: Powerup) {
        this.type = type;
        this.tank = tank;
    }

    draw(camera: Camera) {
        // Override
    }

    update(gameState: GameState, timestep: number) {
        // Override
    }

    stop(gameState: GameState) {
        // TODO: reset turret appearance and other values
        // Remove tank powerupSingleton + powerup
        // TODO: send update to client
        this.tank.powerup = null;
    }
}
