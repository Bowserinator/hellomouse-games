import { Powerup, Direction } from '../types.js';
import Collider from './collision.js';
import Vector from './vector2d.js';
import GameState from './gamestate.js';
import { NormalBullet } from './bullets.js';
import {
    TANK_SPEED, TANK_SIZE, TANK_AMMO, TANK_FIRE_DELAY,
    TANK_BASE_ROTATION_RATE, TANK_TURRET_ROTATION_RATE } from '../vars.js';

import Camera from '../renderer/camera.js';
import drawTank from '../renderer/tank-render.js';

export default class Tank {
    position: Vector;
    velocity: Vector;
    ammo: number;
    lastFired: number;
    powerup: Powerup;
    collider: Collider;

    targetBaseRotation: number; // Rotation of base, visual only
    realBaseRotation: number;
    rotation: number; // Turret rotation, synced
    visualTurretRotation: number; // Visual only

    movement: Array<Direction>;
    isFiring: boolean;
    isDead: boolean;
    id: number;
    score: number;

    speed: number;

    constructor(pos: Vector, rotation: number, id = -1) {
        this.position = pos.copy(); // Center coordinate, not top-left corner. Collider has offset position
        this.velocity = new Vector(0, 0);
        this.ammo = TANK_AMMO;
        this.lastFired = 0; // UNIX timestamp last fired a bullet
        this.powerup = Powerup.NONE;
        this.id = id;

        // For physics
        this.rotation = rotation;
        this.realBaseRotation = 0;

        // Visual only
        this.visualTurretRotation = rotation;
        this.targetBaseRotation = 0;

        // Loaded from client intents
        this.movement = [Direction.NONE, Direction.NONE]; // horz, vert, none = not moving in that dir
        this.isFiring = false;
        this.isDead = false;

        // Other
        this.speed = TANK_SPEED;
        this.score = 0;

        this.createCollider();
    }

    createCollider() {
        let [x, y] = this.position.l();
        x -= TANK_SIZE / 2;
        y -= TANK_SIZE / 2;
        this.collider = new Collider(new Vector(x, y), new Vector(TANK_SIZE, TANK_SIZE)); // TODO
    }

    draw(camera: Camera) {
        if (this.isDead) return;
        drawTank(this, camera);
    }

    updateRotation(target: string, visual: string, rate: number, timestep: number) {
        let targetRotation = this[target];
        while (targetRotation < 0)
            targetRotation += 2 * Math.PI;

        // Rotate visual rotation to match
        rate *= timestep;
        let toRotate = (this[visual] < targetRotation) ? rate : -rate;

        // Snap to target if error is < 1 rotation timestep
        if (Math.abs(targetRotation - this[visual]) < rate)
            this[visual] = targetRotation;
        else if (Math.abs(targetRotation - this[visual]) < Math.PI)
            this[visual] += toRotate;
        else // Prevent making large turns when an opposite dir turn is faster
            this[visual] -= toRotate;

        // Normalize to 0 to 2PI
        this[visual] %= (Math.PI * 2);
        while (this[visual] < 0)
            this[visual] += Math.PI * 2;
    }

    updateBaseRotation(timestep: number) {
        // Update current target base rotation
        if (!this.velocity.isZero())
            this.targetBaseRotation = Math.atan2(this.velocity.y, this.velocity.x);
        this.updateRotation('targetBaseRotation', 'realBaseRotation', TANK_BASE_ROTATION_RATE, timestep);
    }

    update(gameState: GameState, timestep: number) {
        if (this.isDead) return;

        // @ts-ignore:next-line
        let dirMap: Record<Direction, number> = {};
        dirMap[Direction.LEFT] = -this.speed;
        dirMap[Direction.UP] = -this.speed;
        dirMap[Direction.RIGHT] = this.speed;
        dirMap[Direction.DOWN] = this.speed;
        dirMap[Direction.NONE] = 0;

        let [xDir, yDir] = [dirMap[this.movement[0]], dirMap[this.movement[1]]];
        this.velocity = new Vector(xDir, yDir);

        this.updateBaseRotation(timestep);
        this.updateRotation('rotation', 'visualTurretRotation', TANK_TURRET_ROTATION_RATE, timestep);

        this.position.x += this.velocity.x * timestep;
        this.position.y += this.velocity.y * timestep;
        this.createCollider();

        for (let wall of gameState.walls)
            if (wall.collider.collidesWith(this.collider)) {
                this.position = this.collider.getSnapPosition(wall.collider)[0];
                this.position.x += TANK_SIZE / 2;
                this.position.y += TANK_SIZE / 2;
                this.velocity = new Vector(0, 0);
                this.createCollider();
            }

        if (this.isFiring && (Date.now() - this.lastFired) > TANK_FIRE_DELAY) {
            // TODO: bullet types + ammo
            let bullet = new NormalBullet(
                this.position.add(Vector.vecFromRotation(this.rotation, TANK_SIZE)),
                Vector.vecFromRotation(this.rotation, 4 * TANK_SIZE));
            bullet.firedBy = this.id;

            gameState.addBullet(bullet);
            this.lastFired = Date.now();
        }
    }
}
