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

    onFire(gameState: GameState) {
        // Triggered when fired
    }

    stop(gameState: GameState) {
        // TODO: send update to client
        this.tank.powerups = this.tank.powerups.filter(powerup => powerup !== this);
    }
}
