import { Direction, TankSync, BulletType, ExplosionGraphics } from '../types.js';
import { Bullet, LaserBullet } from './bullets/bullets.js';
import Camera from '../renderer/camera.js';
import { generateMazeImage, generateMazeShadowImage } from '../renderer/maze-image-gen.js';

import Vector from './vector2d.js';
import Wall from './wall.js';
import Tank from './tank.js';
import Explosion from './explosion.js';
import generateMaze from './map-gen.js';

interface SyncMessage {
    movement: [Direction, Direction];
    position: [number, number];
    velocity: [number, number];
    rotation: number;
    id: number;
    type: TankSync;
    bulletType: BulletType;
    bulletTypes: Array<BulletType>;
    extra?: any;
    extras: object;

    velocities: Array<[number, number]>;
    positions: Array<[number, number]>;
    rotations: Array<number>;
    indices: Array<number>;
    seed: number;

    damageRadii: Array<number>;
    graphicsRadii: Array<number>;
    durations: Array<number>;
    graphics: Array<ExplosionGraphics>;
}

export default class GameState {
    isClientSide: boolean;
    tanks: Array<Tank>;
    tankIndex: number;
    walls: Array<Wall>;
    bullets: Array<Bullet>;
    explosions: Array<Explosion>;

    lastUpdate: number;
    addedBullets: Set<Bullet>;
    removedBulletIds: Set<number>;
    addedTanks: Array<number>;
    killedTanks: Set<number>;
    changedTankIDs: Set<number>;
    addedExplosions: Set<Explosion>;

    camera: Camera;

    // Clientside only:
    mazeLayer?: HTMLCanvasElement;
    mazeShadowLayer?: HTMLCanvasElement;

    constructor(isClientSide = false) {
        this.isClientSide = isClientSide;
        this.tanks = [];
        this.tankIndex = 0; // Client tank index
        this.walls = [];
        this.bullets = [];
        this.explosions = [];

        this.lastUpdate = Date.now(); // Time of last update as UNIX timestamp
        this.addedBullets = new Set();
        this.removedBulletIds = new Set();
        this.addedTanks = []; // Requires order
        this.changedTankIDs = new Set();
        this.addedExplosions = new Set();
        this.killedTanks = new Set();
    }

    /**
     * Push a new tank to tank array and update tank delta
     * @param {Tank} tank To add
     * @return {number} Result of .push
     */
    addTank(tank: Tank) {
        let id = this.tanks.push(tank);
        this.addedTanks.push(id - 1);
        this.tanks[this.tanks.length - 1].id = id - 1;
        return id;
    }

    /**
     * Add new bullet to bullet array
     * and update bullet delta
     * @param {Bullet} bullet
     */
    addBullet(bullet: Bullet) {
        this.bullets.push(bullet);
        this.addedBullets.add(bullet);
    }

    addExplosion(explosion: Explosion) {
        this.explosions.push(explosion);
        this.addedExplosions.add(explosion);
    }

    removeBullet(bullet: Bullet) {
        bullet.onRemove(this);

        let i = this.bullets.indexOf(bullet);
        if (i > -1) this.removedBulletIds.add(i);
        // TODO: more efficent splice
        this.bullets = this.bullets.filter((b: Bullet) => b !== bullet);
    }

    removeExplosion(explosion: Explosion) {
        // Explosions don't need removal sync since they decay naturally over time
        this.explosions = this.explosions.filter((e: Explosion) => e !== explosion);
        this.addedExplosions.delete(explosion);
    }

    killTank(tank: Tank) {
        if (!tank.isDead)
            this.killedTanks.add(tank.id);
        tank.isDead = true;
    }

    clearDeltas() {
        this.addedBullets.clear();
        this.removedBulletIds.clear();
        this.changedTankIDs.clear();
        this.addedTanks = [];
        this.killedTanks.clear();
        this.addedExplosions.clear();
    }

    update() {
        let timestep = (Date.now() - this.lastUpdate) / 1000;
        this.tanks.forEach(tank => tank.update(this, timestep));
        this.bullets.forEach(bullet => bullet.update(this, timestep));
        this.explosions.forEach(explosion => explosion.update(this, timestep));
        this.lastUpdate = Date.now();
    }

    draw() {
        if (this.mazeShadowLayer)
            this.camera.drawImage(this.mazeShadowLayer, 0, 0);

        this.tanks.forEach(tank => tank.draw(this.camera, this));

        if (this.mazeLayer)
            this.camera.drawImage(this.mazeLayer, 0, 0);
        this.bullets.forEach(bullet => bullet.draw(this.camera, this));

        this.explosions.forEach(explosion => explosion.draw(this.camera, this));
    }

    /**
     * Update state on client from a server message
     * Call from client side only
     * @param {SyncMessgae} message
     * @return {boolean} Success / changed?
     */
    syncFromMessage(message: SyncMessage) {
        if (message.type === TankSync.TANK_POS) {
            if (message.id === undefined || !this.tanks[message.id])
                return false;

            this.tanks[message.id].movement = message.movement;
            this.tanks[message.id].position = new Vector(...message.position);

            // Client is free to lie about own rotation since you can rotate
            // instantly anyways, so this prevents rotation stuttering
            if (message.id !== this.tankIndex)
                this.tanks[message.id].rotation = message.rotation;
        } else if (message.type === TankSync.UPDATE_ALL_TANKS) {
            this.tanks = [];

            // TODO: keep old tanks if not necessary to create new one
            for (let i = 0; i < message.positions.length; i++)
                this.addTank(new Tank(new Vector(...message.positions[i]), message.rotations[i], i));
        } else if (message.type === TankSync.ADD_BULLET) {
            let bullet = Bullet.bulletFromType(message.bulletType,
                new Vector(...message.position), new Vector(...message.velocity));
            if (message.extra)
                bullet.syncExtra(message.extra, message.bulletType);

            this.addBullet(bullet);
        } else if (message.type === TankSync.REMOVE_BULLETS)
            this.bullets = this.bullets.filter((b, i) => !message.indices.includes(i));
        else if (message.type === TankSync.MAP_UPDATE) {
            this.tankIndex = message.id;
            let [w, h] = generateMaze(this, message.seed);
            if (this.isClientSide) {
                this.mazeLayer = generateMazeImage(this.walls, w, h);
                this.mazeShadowLayer = generateMazeShadowImage(this.walls, w, h);
            }
        } else if (message.type === TankSync.TANK_DIED)
            this.tanks[message.id].isDead = true;
        else if (message.type === TankSync.SYNC_ALL_BULLETS) {
            this.bullets = [];
            for (let i = 0; i < message.positions.length; i++) {
                this.bullets.push(Bullet.bulletFromType(
                    message.bulletTypes[i],
                    new Vector(...message.positions[i]),
                    new Vector(...message.velocities[i])
                ));
                if (message.extras[i])
                    this.bullets[this.bullets.length - 1].syncExtra(message.extras[i], message.bulletTypes[i]);
            }
        } else if (message.type === TankSync.ADD_EXPLOSIONS)
            for (let i = 0; i < message.positions.length; i++)
                this.addExplosion(new Explosion(
                    new Vector(...message.positions[i]),
                    message.damageRadii[i],
                    message.graphicsRadii[i],
                    message.durations[i],
                    message.graphics[i]
                ));
        return true;
    }
}
