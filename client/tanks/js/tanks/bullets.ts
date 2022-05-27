import Vector from './vector2d.js';
import Collider from './collision.js';
import Tank from './tank.js';
import GameState from './gamestate.js';
import { BulletType } from '../types.js';
import Camera from '../renderer/camera.js';
import drawBullet from '../renderer/bullet-render.js';

interface BulletConfig {
    imageUrl: string; // // Abs url to image, ie /tanks/img/...
    size: Vector; // Size [w, h]
    speed: number; // () -> pixels/s
    despawnTime: number; // Time in ms to despawn
    type: BulletType;

    imageSize?: Vector; // If different from size
    rotate?: boolean; // Rotate texture? (No for symmetric textures)
    allowBounce?: boolean; // Can bounce (otherwise dies on wall)
}


export class Bullet {
    velocity: Vector;
    collider: Collider;
    type: BulletType;
    createdTime: number;
    firedBy: number; // Tank id that fired the bullet, else -1
    config: BulletConfig;
    rotation: number;

    constructor(position: Vector, direction: Vector, config: BulletConfig) {
        if (this.constructor === Bullet)
            throw new Error('Bullet is Abstract');

        this.velocity = direction.normalize().mul(config.speed);
        this.collider = new Collider(position.copy(), config.size);
        this.createdTime = Date.now();
        this.firedBy = -1;
        this.type = config.type;
        this.rotation = Math.atan2(this.velocity.y, this.velocity.x);

        this.config = config;

        // Config defaults
        if (this.config.rotate === undefined)
            this.config.rotate = false;
        if (this.config.allowBounce === undefined)
            this.config.allowBounce = true;
    }

    update(gameState: GameState, timestep: number) {
        if (!gameState.isClientSide && Date.now() - this.createdTime > this.config.despawnTime) {
            gameState.removeBullet(this);
            return;
        }

        let bounces;
        [this.velocity, bounces] = this.collider.bounce(gameState, this.velocity, timestep);

        if (!this.config.allowBounce && bounces > 0) {
            gameState.removeBullet(this);
            return;
        }

        if (this.config.rotate)
            this.rotation = Math.atan2(this.velocity.y, this.velocity.x);

        // Hit other bullets
        for (let bullet of gameState.bullets)
            if (bullet !== this && this.collider.collidesWith(bullet.collider) && !gameState.isClientSide)
                gameState.removeBullet(bullet);

        // Hit tanks
        for (let tank of gameState.tanks.filter((t: Tank) => !t.isDead))
            if (this.collider.collidesWith(tank.collider) && !gameState.isClientSide) {
                if (tank.id !== this.firedBy && this.firedBy > -1) // No points for suicide shots
                    gameState.tanks[this.firedBy].score++;
                gameState.killTank(tank);
                gameState.removeBullet(this);
                return;
            }
    }

    getCenter() {
        return new Vector(
            this.collider.position.x + this.collider.size.x / 2,
            this.collider.position.y + this.collider.size.y / 2
        );
    }

    draw(camera: Camera) {
        drawBullet(this, camera, this.config.rotate);
    }

    drawFirePreview(camera: Camera) {

    }

    onFire() {

    }

    onDeath() {

    }

    /**
     * Create a bullet of a given type
     * @param {BulletType} type Type of the bullet
     * @param {Vector} position Position of bullet
     * @param {Vector} direction Direction of bullet
     * @return {Bullet} bullet
     */
    static bulletFromType(type: BulletType, position: Vector, direction: Vector): Bullet {
        switch (type) {
                case BulletType.NORMAL:
                    return new NormalBullet(position, direction);
                case BulletType.FAST:
                    return new HighSpeedBullet(position, direction);
                case BulletType.MAGNET:
                    return new MagneticMineBullet(position, direction);
        }
        throw new Error(`Unknown bullet type ${type}`);
    }
}


export class NormalBullet extends Bullet {
    static config = {
        type: BulletType.NORMAL,
        imageUrl: '/tanks/img/normal_bullet.png',
        size: new Vector(7, 7),
        speed: 300,
        despawnTime: 10000
    };

    constructor(position: Vector, direction: Vector) {
        super(position, direction, NormalBullet.config);
    }
}

export class MagneticMineBullet extends Bullet {
    static config = {
        type: BulletType.MAGNET,
        imageUrl: '/tanks/img/fast_bullet.png',
        size: new Vector(14, 14),
        speed: 160,
        despawnTime: 10000
    };

    constructor(position: Vector, direction: Vector) {
        super(position, direction, MagneticMineBullet.config);
    }

    update(gameState: GameState, timestep: number) {
        super.update(gameState, timestep);

        // TODO: get nearest tank
        let closest = gameState.tanks[0];
        if (!closest) return;
        let distance = 9999999;
        for (let tank of gameState.tanks) {
            let dis = tank.collider.position.manhattanDist(this.collider.position);
            if (dis < distance) {
                distance = dis;
                closest = tank;
            }
        }

        // Accelerate towards tank
        let tank = closest;
        let v1 = new Vector(
            tank.position.x - this.collider.position.x,
            tank.position.y - this.collider.position.y);
        v1 = v1.normalize().mul(200);

        // TODO: limit speed
        // TODO priming period
        // TODO draw target color

        this.velocity.x += v1.x * timestep;
        this.velocity.y += v1.y * timestep;
    }
}

class LaserBullet {

}

class BombBullet {

}

export class HighSpeedBullet extends Bullet {
    static config = {
        type: BulletType.FAST,
        imageUrl: '/tanks/img/fast_bullet.png',
        size: new Vector(7, 7),
        speed: 1000,
        despawnTime: 1000,
        allowBounce: false,
        imageSize: new Vector(16, 12),
        rotate: true
    };

    constructor(position: Vector, direction: Vector) {
        super(position, direction, HighSpeedBullet.config);
    }
}
