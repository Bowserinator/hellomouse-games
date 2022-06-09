
/**
 * A 2D vector
 * @author Bowserinator
 */
export default class Vector2D {
    x: number;
    y: number;

    /**
     * @param {number} x
     * @param {number} y
     */
    constructor(x: number, y: number) {
        this.x = x;
        this.y = y;
    }

    /**
     * Compute the squared magnitude of the vector
     * Same as v.dot(v)
     * @return {number} Magnitude^2
     */
    magSquared() {
        return this.x * this.x + this.y * this.y;
    }

    /**
     * Compute magnitude of the vector
     * @return {number} Magnitude
     */
    magnitude() {
        return Math.sqrt(this.magSquared());
    }

    /**
     * Normalize the vector to have a magnitude of 1
     * @return {Vector2D}
     */
    normalize() {
        let m = this.magnitude();
        return new Vector2D(this.x / m, this.y / m);
    }

    /**
     * Compute dot product with other vector
     * @param {Vector2D} other
     * @return {number} dot product
     */
    dot(other: Vector2D) {
        return this.x * other.x + this.y * other.y;
    }

    /**
     * Sum two vectors
     * @param {Vector2D} other
     * @return {Vector2D} Sum
     */
    add(other: Vector2D) {
        return new Vector2D(this.x + other.x, this.y + other.y);
    }

    /**
     * Get list representation of the components of the vector
     * @return {[number, number]}
     */
    l(): [number, number] {
        return [this.x, this.y];
    }

    /**
     * Are both components zero?
     * @return {boolean}
     */
    isZero() {
        return this.x === 0 && this.y === 0;
    }

    /** Round the components (in place) */
    round() {
        this.x = Math.round(this.x);
        this.y = Math.round(this.y);
    }

    /**
     * Manhattan distance to another vector (slightly faster than
     * exact 2D distance)
     * @param {Vector2D} otherVec
     * @return {number} distance
     */
    manhattanDist(otherVec: Vector2D) {
        return Math.abs(this.x - otherVec.x) + Math.abs(this.y - otherVec.y);
    }

    /**
     * Squared absolute distance to another vec
     * @param {Vector2D} otherVec Other position
     * @return {number} distance
     */
    distance2(otherVec: Vector2D) {
        return Math.pow(this.x - otherVec.x, 2) + Math.pow(this.y - otherVec.y, 2);
    }

    /**
     * Absolute distance to another vec
     * @param {Vector2D} otherVec Other position
     * @return {number} distance
     */
    distance(otherVec: Vector2D) {
        return Math.sqrt(this.distance2(otherVec));
    }

    /**
     * Return a copy of this vector
     * @return {Vector2D}
     */
    copy() {
        return new Vector2D(this.x, this.y);
    }

    /**
     * Multiply this by a scalar
     * @param {number} v
     * @return {Vector2D} v * this
     */
    mul(v: number) {
        return new Vector2D(this.x * v, this.y * v);
    }

    /**
     * Compute the angle the vector makes, mathematician polar
     * @return {number} angle (rad)
     */
    angle() {
        return Math.atan2(this.y, this.x);
    }

    /**
     * Create a vector from an angle and magnitude
     * @param {number} angle
     * @param {number} magnitude
     * @return {Vector2D}
     */
    static vecFromRotation(angle: number, magnitude = 1) {
        return new Vector2D(
            Math.cos(angle) * magnitude,
            Math.sin(angle) * magnitude
        );
    }
}
