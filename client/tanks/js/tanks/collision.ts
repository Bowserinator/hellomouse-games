import Vector from './vector2d.js';
import GameState from './gamestate.js';
import Camera from '../renderer/camera.js';

/**
 * Rectangular collision helper
 * @author Bowserinator
 */
export default class Collider {
    position: Vector;
    size: Vector;

    constructor(position: Vector, size: Vector) {
        this.position = position;
        this.size = size;
    }

    /**
     * Does this collider overlap with another collider?
     * @param {Collider}
     * @return {boolean}
     */
    collidesWith(collider: Collider) {
        let [cx, cy] = collider.position.l();
        let [cw, ch] = collider.size.l();
        let [x, y] = this.position.l();
        let [w, h] = this.size.l();
        return x < cx + cw &&
               x + w > cx &&
               y < cy + ch &&
               y + h > cy;
    }

    /**
     * If there is an overlap, compute which side to snap
     * to that minimizes displacement to prevent overlap
     * @param {Collider} otherCollider
     * @return {[Vector, boolean]} Snap location x, y
     */
    getSnapPosition(otherCollider: Collider) {
        // Assume other collider is immobile and there is already a collision
        // Top & bottom collision lines (horizontal)
        let vec1 = new Vector(this.position.x, otherCollider.position.y - this.size.y); // top / bottom
        let vec2 = new Vector(this.position.x, otherCollider.position.y + otherCollider.size.y);

        // Side collision lines (left & right)
        let vec3 = new Vector(otherCollider.position.x - this.size.x, this.position.y);
        let vec4 = new Vector(otherCollider.position.x + otherCollider.size.x, this.position.y);

        let minDist = Number.POSITIVE_INFINITY;
        let returned: [Vector, boolean] = [this.position, false];
        let [vec, dist]: [Vector | null, number] = [null, 0];

        for (let i = 0; i < 4; i++) {
            vec = [vec1, vec2, vec3, vec4][i];
            vec.round();
            dist = vec.manhattanDist(this.position);

            if (dist < minDist) {
                minDist = dist;
                returned = [vec, i < 2]; // i < 2 = is it a horizontal collision line?
            }
        }
        return returned;
    }

    /**
     * Perform a bounce of the collider given an initial velocity
     * and timestep. Updates the collider's position in place
     *
     * @param {GameState} gameState
     * @param {Vector} velocity Initial v
     * @param {number} time timestep
     * @return {[Vector, number]} [post-velocity, bounce count]
     */
    bounce(gameState: GameState, velocity: Vector, time: number): [Vector, number] {
        const STEP_SIZE = 2;
        let steps = time * velocity.magnitude();
        let v = velocity.normalize();
        let bounceCount = 0;

        while (steps > 0) {
            let mul = steps < STEP_SIZE ? steps : STEP_SIZE;

            this.position.x += mul * v.x;
            this.position.y += mul * v.y;

            for (let wall of gameState.walls)
                if (wall.collider.collidesWith(this)) {
                    let [vec, isHorz] = this.getSnapPosition(wall.collider);
                    if (vec === null) continue; // Should never happen
                    this.position = vec;
                    bounceCount++;

                    if (isHorz) {
                        velocity.y *= -1;
                        v.y *= -1;
                    } else {
                        velocity.x *= -1;
                        v.x *= -1;
                    }
                }
            steps -= STEP_SIZE;
        }
        return [velocity, bounceCount];
    }

    /** Debug draw method */
    draw(camera: Camera, color = 'green') {
        camera.drawRect(
            this.position.l() as [number, number],
            this.size.l() as [number, number],
            color);
    }
}
