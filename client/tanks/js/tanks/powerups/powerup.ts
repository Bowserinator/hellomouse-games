import Tank from '../tank.js';
import { Powerup, PowerupCategory } from '../../types.js';
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
    category: PowerupCategory;

    constructor(tank: Tank, type: Powerup, category: PowerupCategory) {
        this.type = type;
        this.tank = tank;
        this.category = category;
        this.clearSameTypePowerups(false, [this]);
    }

    /**
     * Clear bullet powerups of the same type
     * @param {Array<PowerupState>} exceptions Don't remove these powerups
     */
    clearSameTypePowerups(isRecursive = false, exceptions: Array<PowerupState> = []) {
        if (isRecursive) return;

        let newPowerups = [];
        for (let powerup of this.tank.powerups)
            if (powerup.category === this.category && !exceptions.includes(powerup))
                powerup.stop(true);
            else
                newPowerups.push(powerup);
        this.tank.powerups = newPowerups;
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

    /** Stops the current powerup's effects and undos any changes made */
    stop(isRecursive = false) {
        this.clearSameTypePowerups(isRecursive);
    }
}
