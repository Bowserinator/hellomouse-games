import Camera from '../../renderer/camera.js';
import Renderable from '../../renderer/renderable.js';
import GameState from '../gamestate.js';
import { Powerup } from '../../types.js';
import Vector from '../vector2d.js';
import Collider from '../collision.js';
import { createPowerupFromType } from './powerups.js';

const POWERUP_ITEM_SIZE = new Vector(30, 30); // Move to global config?

export class PowerupItem extends Renderable {
    powerup: Powerup;
    position: Vector;
    collider: Collider;
    randomID: number;

    constructor(position: Vector, powerup: Powerup) {
        super([
            ['', POWERUP_ITEM_SIZE] // TODO: powerup image list
        ]);
        this.position = position;
        this.powerup = powerup;
        this.collider = new Collider(position, POWERUP_ITEM_SIZE);
        this.randomID = Math.round(Math.random() * 100000);
    }

    draw(camera: Camera, gameState: GameState) {
        // Draw image
        camera.fillRect(this.position.l(), POWERUP_ITEM_SIZE.l(), 'red');
    }

    update(gameState: GameState, timestep: number) {
        // If collide with tank give powerup
        for (let tank of gameState.tanks)
            if (tank.collider.collidesWith(this.collider)) {
                // Note: you must seperate powerup create and the push
                // or weird bugs happen
                let powerup = createPowerupFromType(this.powerup, tank);
                tank.powerups.push(powerup);
                gameState.removePowerupItem(this);
                return;
            }
    }
}
