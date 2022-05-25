import Collider from './collision.js';
import Vector from './vector2d.js';
import Camera from '../renderer/camera.js';

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
        camera.fillRect(this.collider.position.l(), this.collider.size.l(), '#333');
    }
}
