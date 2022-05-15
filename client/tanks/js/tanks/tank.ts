import { Powerup, Direction } from '../types.js';
import Collider from './collision.js';
import Vector from './vector2d.js';
import { NormalBullet } from './bullets.js';


export default class Tank {
    constructor(pos, rotation) {
        this.position = pos;
        this.rotation = rotation;
        this.ammo = 2;
        this.lastFired = 0; // UNIX timestamp last fired a bullet
        this.powerup = Powerup.NONE;

        // Loaded from client intents
        this.movement = [Direction.NONE, Direction.NONE]; // horz, vert
        this.isFiring = false;

        // Other
        this.speed = 300;
    }

    createCollider() {
        let [x, y] = this.position.l();
        x -= 25;
        y -= 25;
        this.collider = new Collider(new Vector(x, y), new Vector(50, 50)); // TODO
    }

    draw(ctx) {
        // drawCenteredSquare(this.position.x, this.position.y, 50, 'red');

        this.collider.draw(ctx);
    }

    update(gameState, timestep) {
        // TODO neatify this part
        let xDir = this.movement[0] === Direction.LEFT ? -this.speed : this.speed;
        if (this.movement[0] === Direction.NONE) xDir = 0;
        let yDir = this.movement[1] === Direction.UP ? -this.speed : this.speed;
        if (this.movement[1] === Direction.NONE) yDir = 0;

        this.velocity = new Vector(xDir, yDir);

        this.position.x += this.velocity.x * timestep;
        this.position.y += this.velocity.y * timestep;
        this.createCollider();

        for (let wall of gameState.walls)
            if (wall.collider.collidesWith(this.collider)) {
                this.position = this.collider.getSnapPosition(wall.collider)[0];
                this.position.x += 25;
                this.position.y += 25;
                this.velocity = new Vector(0, 0);
                this.createCollider();
            }

        if (this.isFiring && (Date.now() - this.lastFired) > 100) { // TODO
            gameState.addBullet(new NormalBullet(this.position,
                Vector.vecFromRotation(this.rotation, 4) ));
            this.lastFired = Date.now();
        }
    }
}
