import Vector from './vector2d.js';
import Collider from './collision.js';

export class Bullet {
    position: Vector;
    velocity: Vector;

    constructor(position: Vector, size: Vector, velocity: Vector) {
        if (this.constructor === Bullet)
            throw new Error('Bullet is Abstract');

        this.velocity = velocity;
        this.collider = new Collider(position, size);
    }

    update() {
        this.velocity = this.collider.bounce(this.velocity, 1)[0];

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
}


export class NormalBullet extends Bullet {
    constructor(position: Vector, velocity: Vector) {
        super(position, new Vector(5, 5), velocity);
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
