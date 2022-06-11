import { Powerup, Direction, BulletType, ExplosionGraphics } from '../types.js';
import Collider from './collision.js';
import Vector from './vector2d.js';
import GameState from './gamestate.js';
import Explosion from './explosion.js';
import { Bullet } from './bullets/bullets.js';
import {
    TANK_SPEED, TANK_SIZE, TANK_TURRET_SIZE, TANK_FIRE_DELAY,
    TANK_BASE_ROTATION_RATE, TANK_TURRET_ROTATION_RATE } from '../vars.js';

import { StealthPowerup, PowerupSingleton, ShieldPowerup, LaserPowerup, TANK_TURRET_IMAGE_URLS } from './powerups/powerups.js';

import Camera from '../renderer/camera.js';
import Renderable from '../renderer/renderable.js';

const TURRET_SIZE = new Vector(TANK_TURRET_SIZE, TANK_TURRET_SIZE);

export default class Tank extends Renderable {
    position: Vector;
    velocity: Vector;
    bulletType: BulletType;
    lastFired: number;
    powerups: Array<PowerupSingleton>;
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
    stealthed: boolean;
    firedBullets: Array<Bullet>;
    turretImageUrl: string;

    speed: number;

    constructor(pos: Vector, rotation: number, id = -1) {
        super([
            ['/tanks/img/tank-body.png', new Vector(TANK_SIZE, TANK_SIZE)],
            ...(Object.values(TANK_TURRET_IMAGE_URLS).map((url: string): [string, Vector] => [url, TURRET_SIZE]))
        ]);

        this.turretImageUrl = TANK_TURRET_IMAGE_URLS[Powerup.NONE];
        this.position = pos.copy(); // Center coordinate, not top-left corner. Collider has offset position
        this.velocity = new Vector(0, 0);
        this.bulletType = BulletType.NORMAL;
        this.lastFired = 0; // UNIX timestamp last fired a bullet
        this.invincible = false;
        this.stealthed = false;
        this.powerups = [];
        this.id = id;
        this.firedBullets = [];

        // For physics
        this.rotation = rotation;
        this.realBaseRotation = 0;

        // Visual only
        this.visualTurretRotation = rotation;
        this.targetBaseRotation = 0;
        this.fakeBullet = Bullet.bulletFromType(this.bulletType,
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

    changeBulletType(bulletType: BulletType) {
        this.bulletType = bulletType;
        this.fakeBullet = Bullet.bulletFromType(this.bulletType,
            ...this.getFiringPositionAndDirection());
    }

    draw(camera: Camera, gamestate: GameState) {
        if (this.isDead) return;
        if (!this.isLoaded()) return;

        const isOwnTank = gamestate.tanks[gamestate.tankIndex] === this;
        if (this.stealthed)
            camera.ctx.globalAlpha = isOwnTank ? 0.2 : 0;

        camera.drawImageRotated(this.images[this.imageUrls[0][0]],
            this.position.x, this.position.y, this.realBaseRotation);
        camera.drawImageRotated(this.images[this.turretImageUrl],
            this.position.x, this.position.y, this.visualTurretRotation);
        if (this.stealthed) camera.ctx.globalAlpha = 1;

        if (isOwnTank) {
            let [pos, vel] = this.getFiringPositionAndDirection();
            this.fakeBullet.firedBy = this.id;
            this.fakeBullet.setCenter(pos);
            this.fakeBullet.setVelocityFromDir(vel);
            this.fakeBullet.drawFirePreview(camera, gamestate);
        }
        this.powerups.forEach(powerup => powerup.draw(camera));
    }

    onDeath(gameState: GameState) {
        gameState.addExplosion(new Explosion(this.position, 0, 26, 300, ExplosionGraphics.SIMPLE));
    }

    /**
     * Get spawn pos + dir of a bullet that would be fired from this given this.rotation
     * @return {[Vector, Vector]} Firing position, direction
     */
    getFiringPositionAndDirection(): [Vector, Vector] {
        // 0.73 > 1/sqrt(2), the length of the diagonal from the center to a corner of the hitbox
        // so the spawned bullet won't collide with the tank
        let rot = Vector.vecFromRotation(this.rotation, 0.73 * TANK_SIZE);
        let pos = this.position.add(rot);
        let dir = rot;
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
            this.firedBullets = this.firedBullets.filter(b => !b.isDead);
            if (this.firedBullets.length < (this.fakeBullet.config.maxAmmo || 1)) {
                let bullet = Bullet.bulletFromType(
                    this.bulletType,
                    ...this.getFiringPositionAndDirection());
                bullet.firedBy = this.id;
                bullet.onFire(gameState);
                this.powerups.forEach(powerup => powerup.onFire(gameState));

                gameState.addBullet(bullet);
                this.firedBullets.push(bullet);
                this.lastFired = Date.now();
            }
        }

        this.powerups.forEach(powerup => powerup.update(gameState, timestep));
    }
}
