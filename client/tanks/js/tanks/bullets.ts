import Vector from './vector2d.js';
import Collider from './collision.js';
import GameState from './gamestate.js';
import { BulletType } from '../types.js';
import { BULLET_DESPAWN_TIME } from '../vars.js';

export class Bullet {
    position: Vector;
    velocity: Vector;
    collider: Collider;
    type: BulletType;
    createdTime: number;

    constructor(position: Vector, size: Vector, velocity: Vector) {
        if (this.constructor === Bullet)
            throw new Error('Bullet is Abstract');

        this.velocity = velocity.copy();
        this.collider = new Collider(position.copy(), size.copy());
        this.createdTime = Date.now();
    }

    update(gameState: GameState, timestep: number) {
        if (!gameState.isClientSide && Date.now() - this.createdTime > BULLET_DESPAWN_TIME) {
            gameState.removeBullet(this);
            return;
        }

        this.velocity = this.collider.bounce(gameState, this.velocity, timestep)[0];

        // Hit tanks
        // TODO: add to changedTankIDs
        // or make new check in state for this (deadTanks)
        for (let tank of gameState.tanks)
            if (this.collider.collidesWith(tank.collider) && !gameState.isClientSide)
                gameState.killTank(tank);


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
        let v1 = new Vector(tank.position.x - this.collider.position.x,
            tank.position.y - this.collider.position.y);
        v1 = v1.normalize();

        // this.velocity[0] += v1[0];
        // this.velocity[1] += v1[1];
    }

    draw(ctx: CanvasRenderingContext2D) {
        this.collider.draw(ctx);
    }

    onFire() {

    }

    onDeath() {

    }

    /**
     * Create a bullet of a given type
     * @param {BulletType} type Type of the bullet
     * @param {Vector} position Position of bullet
     * @param {Vector} velocity Velocity of bullet
     */
    static bulletFromType(type: BulletType, position: Vector, velocity: Vector) {
        switch (type) {
                case BulletType.NORMAL:
                    return new NormalBullet(position, velocity);
        }
        throw new Error(`Unknown bullet type ${type}`);
    }
}


export class NormalBullet extends Bullet {
    constructor(position: Vector, velocity: Vector) {
        super(position, new Vector(5, 5), velocity);
        this.type = BulletType.NORMAL;
    }
}

class MissileBullet {

}

class LaserBullet {

}

class BombBullet {

}

class HighSpeedBullet {

}
