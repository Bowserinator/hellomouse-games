import Camera from '../../renderer/camera.js';
import Renderable from '../../renderer/renderable.js';
import GameState from '../gamestate.js';
import { Powerup } from '../../types.js';
import Vector from '../vector2d.js';

export class Powerupitem extends Renderable {
    powerup: Powerup;
    position: Vector;

    constructor(position: Vector, powerup: Powerup) {
        super(
            [] // TODO: powerup image list
        );
        this.position = position;
        this.powerup = powerup;
        // TODO make collider
    }

    draw(camera: Camera) {
        // Draw image
    }

    update(gameState: GameState, timestep: number) {
        // if collide with tank give powerup
    }
}
