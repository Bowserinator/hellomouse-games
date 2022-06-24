import Vector from './vector2d.js';
import GameState from './gamestate.js';
import Camera from '../renderer/camera.js';
import { SHIELD_RADIUS } from './powerups/shield.js';

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
     * Is the center of this collider within a certain distance
     * from a given center?
     * @param {Vector} center Distance to center
     * @param {number} distance Radius from center
     * @return {boolean}
     */
    within(position: Vector, distance: number) {
        let centerX = this.position.x + this.size.x / 2;
        let centerY = this.position.y + this.size.y / 2;
        return Math.pow(centerX - position.x, 2) + Math.pow(centerY - position.y, 2) <= distance * distance;
    }

    /**
     * Is position inside or on collider
     * @param {Vector} position Position
     * @return {boolean}
     */
    contains(position: Vector) {
        return this.position.x <= position.x && this.position.x + this.size.x >= position.x &&
            this.position.y <= position.y && this.position.y + this.size.y >= position.y;
    }

    /**
     * Does the line intersect the bounding box at any point?
     * (From start to end)
     * @param {Vector} start Start of the line
     * @param {Vector} end End of the line
     * @returns Does it collide?
     */
    collidesWithLine(start: Vector, end: Vector) {
        /** Do lines intersect, stolen from https://stackoverflow.com/a/28866825 */
        function linesIntersect(p1: Vector, p2: Vector, p3: Vector, p4: Vector) {
            // eslint-disable-next-line @typescript-eslint/no-shadow, @typescript-eslint/naming-convention
            function CCW(p1: Vector, p2: Vector, p3: Vector) {
                return (p3.y - p1.y) * (p2.x - p1.x) > (p2.y - p1.y) * (p3.x - p1.x);
            }
            // eslint-disable-next-line new-cap
            return (CCW(p1, p3, p4) !== CCW(p2, p3, p4)) && (CCW(p1, p2, p3) !== CCW(p1, p2, p4));
        }

        return linesIntersect(start, end, this.position, this.position.add(new Vector(this.size.x, 0))) ||
            linesIntersect(start, end, this.position, this.position.add(new Vector(0, this.size.y))) ||
            linesIntersect(start, end, this.position.add(new Vector(0, this.size.y)), this.position.add(this.size)) ||
            linesIntersect(start, end, this.position.add(new Vector(this.size.x, 0)), this.position.add(this.size));
    }

    /**
     * Does a circle overlap with this collider?
     * @param {Vector} center Center of circle
     * @param {number} r Radius of circle
     * @returns {boolean} Does the circle overlap?
     */
    collidesWithCircle(center: Vector, r: number) {
        // eslint-disable-next-line @typescript-eslint/no-shadow
        function lineIntersect(center: Vector, radius: number, line1: Vector, line2: Vector) {
            center = center.add(line1.mul(-1));
            line2 = line2.add(line1.mul(-1));

            let t = (line2.x * center.x + line2.y + center.y) / (line2.x * line2.x + line2.y * line2.y);
            t = Math.max(0, Math.min(t, 1));

            let deltaX = line2.x * t - center.x;
            let deltaY = line2.y * t - center.y;
            return deltaX * deltaX + deltaY * deltaY <= radius * radius;
        }

        return lineIntersect(center, r, this.position, this.position.add(new Vector(this.size.x, 0))) ||
            lineIntersect(center, r, this.position, this.position.add(new Vector(0, this.size.y))) ||
            lineIntersect(center, r, this.position.add(new Vector(0, this.size.y)), this.position.add(this.size)) ||
            lineIntersect(center, r, this.position.add(new Vector(this.size.x, 0)), this.position.add(this.size));
    }

    /**
     * Perform a bounce of the collider given an initial velocity
     * and timestep. Updates the collider's position in place
     *
     * @param {GameState} gameState
     * @param {Vector} velocity Initial v
     * @param {number} time timestep
     * @param {boolean} allowBounce if false, terminates upon collision
     * @param {number} bounceEnergy Velocity to retain per bounce, 1 = all, 2 = double, 0.5 = halve, etc...
     * @return {[Vector, number, Array<Vector>]} [post-velocity, bounce count, bounce positions]
     */
    bounce(gameState: GameState, velocity: Vector, time: number,
        allowBounce = true, bounceEnergy = 1): [Vector, number, Array<Vector>] {
        const STEP_SIZE = 2;
        let steps = time * velocity.magnitude();
        let v = velocity.normalize();
        let bounceCount = 0;
        let bouncePositions = [];

        while (steps > 0) {
            let mul = steps < STEP_SIZE ? steps : STEP_SIZE;

            this.position.x += mul * v.x;
            this.position.y += mul * v.y;

            // Bounce off of shields
            for (let tank of gameState.tanks)
                if (tank.invincible && this.collidesWithCircle(tank.position, SHIELD_RADIUS)) {
                    let center = new Vector(this.position.x + this.size.x / 2, this.position.y + this.size.y / 2);
                    let newVelocity = (new Vector(
                        center.x - tank.position.x,
                        center.y - tank.position.y
                    )).normalize().mul(velocity.magnitude());

                    velocity.x = newVelocity.x;
                    velocity.y = newVelocity.y;

                    bounceCount++;
                    bouncePositions.push(this.position.copy());

                    if (!allowBounce)
                        return [velocity, bounceCount, bouncePositions]; // Collided, stop
                }

            for (let wall of gameState.walls)
                if (wall.collider.collidesWith(this)) {
                    let [vec, isHorz] = this.getSnapPosition(wall.collider);
                    if (vec === null) continue; // Should never happen
                    this.position = vec;
                    bounceCount++;
                    bouncePositions.push(this.position.copy());

                    if (isHorz) {
                        velocity.y *= -bounceEnergy;
                        v.y *= -bounceEnergy;
                    } else {
                        velocity.x *= -bounceEnergy;
                        v.x *= -bounceEnergy;
                    }

                    if (!allowBounce)
                        return [velocity, bounceCount, bouncePositions]; // Collided, stop
                }
            steps -= STEP_SIZE;
        }
        return [velocity, bounceCount, bouncePositions];
    }

    /** Debug draw method */
    draw(camera: Camera, color = 'green') {
        camera.drawRect(
            this.position.l() as [number, number],
            this.size.l() as [number, number],
            color);
    }
}
