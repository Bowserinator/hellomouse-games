import { Powerup, Direction } from '../types.js';
import Collider from './collision.js';
import Vector from './vector2d.js';
import GameState from './gamestate.js';
import { NormalBullet } from './bullets.js';


export default class Tank {
    position: Vector;
    velocity: Vector;
    rotation: number;
    ammo: number;
    lastFired: number;
    powerup: Powerup;
    collider: Collider;

    movement: Array<Direction>;
    isFiring: boolean;
    isDead: boolean;
    id: number;

    speed: number;

    constructor(pos: Vector, rotation: number, id = -1) {
        this.position = pos.copy(); // Center coordinate, not top-left corner. Collider has offset position
        this.velocity = new Vector(0, 0);
        this.rotation = rotation;
        this.ammo = 2;
        this.lastFired = 0; // UNIX timestamp last fired a bullet
        this.powerup = Powerup.NONE;
        this.id = id;

        // Loaded from client intents
        this.movement = [Direction.NONE, Direction.NONE]; // horz, vert, none = not moving in that dir
        this.isFiring = false;
        this.isDead = false;

        // Other
        this.speed = 300;

        this.createCollider();
    }

    createCollider() {
        let [x, y] = this.position.l();
        x -= 25;
        y -= 25;
        this.collider = new Collider(new Vector(x, y), new Vector(50, 50)); // TODO
    }

    draw(ctx: CanvasRenderingContext2D) {
        if (this.isDead) return;
        this.collider.draw(ctx);
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
            gameState.addBullet(new NormalBullet(
                this.position.add(Vector.vecFromRotation(this.rotation, 50)),
                Vector.vecFromRotation(this.rotation, 4) ));
            this.lastFired = Date.now();
        }
    }
}
