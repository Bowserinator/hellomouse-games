import Collider from './collision.js';
import Vector from './vector2d.js';

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

    draw(ctx: CanvasRenderingContext2D) {
        this.collider.draw(ctx, 'red');

        // TODO
    }
}
