import Tank from '../tank.js';
import { Powerup } from '../../types.js';
import Camera from '../../renderer/camera.js';
import GameState from '../gamestate.js';

/**
 * A powerup that belongs to a tank,
 * modifies some state of the tank
 * @author Bowserinator
 */
export class PowerupState {
    tank: Tank;
    type: Powerup;

    constructor(tank: Tank, type: Powerup) {
        this.type = type;
        this.tank = tank;
    }

    /**
     * Draw something for the powerup, override this
     * @param camera Camera object
     */
    draw(camera: Camera) {
        // Override
    }

    /**
     * Perform a server-side update
     * @param {GameState} gameState GameState
     * @param {number} timestep ms
     */
    update(gameState: GameState, timestep: number) {
        // Override
    }

    /**
     * Triggered when the tank "fires", useful for bullet-type powerups
     * @param {GameState} gameState GameState
     */
    onFire(gameState: GameState) {
        // Override
    }

    /**
     * Stops the current powerup's effects and undos any changes made
     * May not always be called if the powerup is directly deleted by another
     * @param {GameState} gameState GameState
     */
    stop(gameState: GameState) {
        // TODO: send update to client
        this.tank.powerups = this.tank.powerups.filter(powerup => powerup !== this);
    }
}
