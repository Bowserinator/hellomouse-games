import { Powerup, Direction } from '../types.js';
import Collider from './collision.js';
import Vector from './vector2d.js';
import GameState from './gamestate.js';
import { Bullet, NormalBullet } from './bullets.js';
import { BulletType } from '../types.js';
import {
    TANK_SPEED, TANK_SIZE, TANK_AMMO, TANK_FIRE_DELAY,
    TANK_BASE_ROTATION_RATE, TANK_TURRET_ROTATION_RATE } from '../vars.js';

import { PowerupSingleton, ShieldPowerup } from './powerups/powerups.js';

import Camera from '../renderer/camera.js';
import drawTank from '../renderer/render-tank.js';


export default class Tank {
    position: Vector;
    velocity: Vector;
    ammo: number;
    lastFired: number;
    powerup: Powerup;
    powerupSingleton: PowerupSingleton | null; // TODO rename or remove powerup
    collider: Collider;

    targetBaseRotation: number; // Rotation of base, visual only
    realBaseRotation: number;
    rotation: number; // Turret rotation, synced
    visualTurretRotation: number; // Visual only
    fakeBullet: Bullet; // Used for visual path preview

    movement: Array<Direction>;
    isFiring: boolean;
    isDead: boolean;
    id: number;
    score: number;
    invincible: boolean;

    speed: number;

    constructor(pos: Vector, rotation: number, id = -1) {
        this.position = pos.copy(); // Center coordinate, not top-left corner. Collider has offset position
        this.velocity = new Vector(0, 0);
        this.ammo = TANK_AMMO;
        this.lastFired = 0; // UNIX timestamp last fired a bullet
        this.invincible = false;
        this.powerup = Powerup.NONE;
        this.powerupSingleton = new ShieldPowerup(this);
        this.id = id;

        // For physics
        this.rotation = rotation;
        this.realBaseRotation = 0;

        // Visual only
        this.visualTurretRotation = rotation;
        this.targetBaseRotation = 0;

        // TODO move to method
        this.fakeBullet = Bullet.bulletFromType(BulletType.NORMAL,
            ...this.getFiringPositionAndDirection());

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
        this.collider = new Collider(new Vector(x, y), new Vector(TANK_SIZE, TANK_SIZE));
    }

    draw(camera: Camera, gamestate: GameState) {
        if (this.isDead) return;
        drawTank(this, camera);

        this.fakeBullet = Bullet.bulletFromType(BulletType.FAST,
            ...this.getFiringPositionAndDirection()); // TODO: dont recreate but have set velocity + position shit
        this.fakeBullet.drawFirePreview(camera, gamestate);

        if (this.powerupSingleton)
            this.powerupSingleton.draw(camera);
    }

    /**
     * Get spawn pos + dir of a bullet that would be fired from this given this.rotation
     * @return {[Vector, Vector]} Firing position, direction
     */
    getFiringPositionAndDirection(): [Vector, Vector] {
        // 0.73 > 1/sqrt(2), the length of the diagonal from the center to a corner of the hitbox
        // so the spawned bullet won't collide with the tank
        let pos = this.position.add(Vector.vecFromRotation(this.rotation, 0.73 * TANK_SIZE));
        let dir = Vector.vecFromRotation(this.rotation, 1);
        return [pos, dir];
    }

    updateRotation(target: string, visual: string, rate: number, timestep: number) {
        let targetRotation = (this as any)[target];
        while (targetRotation < 0)
            targetRotation += 2 * Math.PI;

        // Rotate visual rotation to match
        rate *= timestep;
        let toRotate = ((this as any)[visual] < targetRotation) ? rate : -rate;

        // Snap to target if error is < 1 rotation timestep
        if (Math.abs(targetRotation - (this as any)[visual]) < rate)
            (this as any)[visual] = targetRotation;
        else if (Math.abs(targetRotation - (this as any)[visual]) < Math.PI)
            (this as any)[visual] += toRotate;
        else // Prevent making large turns when an opposite dir turn is faster
            (this as any)[visual] -= toRotate;

        // Normalize to 0 to 2PI
        (this as any)[visual] %= (Math.PI * 2);
        while ((this as any)[visual] < 0)
            (this as any)[visual] += Math.PI * 2;
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
            let bullet = Bullet.bulletFromType(
                BulletType.NORMAL,
                ...this.getFiringPositionAndDirection());

            bullet.firedBy = this.id;

            gameState.addBullet(bullet);
            this.lastFired = Date.now();
        }

        if (this.powerupSingleton)
            this.powerupSingleton.update(gameState);
    }
}
