import Collider from './collision.js';
import Vector from './vector2d.js';
import Camera from '../renderer/camera.js';
import { WALL_COLOR, SHADOW_SIZE_X, SHADOW_SIZE_Y, SHADOW_COLOR } from '../vars.js';

export default class Wall {
    collider: Collider;

    constructor(position: Vector, size: Vector) {
        this.collider = new Collider(position, size);

        // TODO: walls that ie collide with tanks but not bullets
    }

    /**
     * Shorthand to get position
     * @return {Vector} position
     */
    pos() {
        return this.collider.position;
    }

    /**
     * Shorthand to get size
     * @return {Vector} size
     */
    size() {
        return this.collider.size;
    }

    draw(camera: Camera) {
        camera.fillRect(
            this.collider.position.l() as [number, number],
            this.collider.size.l() as [number, number],
            WALL_COLOR);
    }

    drawShadow(camera: Camera) {
        camera.fillRect(
            this.collider.position.l() as [number, number],
            [this.collider.size.x + SHADOW_SIZE_X, this.collider.size.y + SHADOW_SIZE_Y],
            SHADOW_COLOR);
    }
}
