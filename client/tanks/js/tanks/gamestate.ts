import { Direction, TankSync, BulletType } from '../types.js';
import { Bullet, NormalBullet } from './bullets.js';

import Vector from './vector2d.js';
import Wall from './wall.js';
import Tank from './tank.js';
import generateMaze from './map-gen.js';

interface SyncMessage {
    movement: [Direction, Direction];
    position: [number, number];
    velocity: [number, number];
    rotation: number;
    id: number;
    type: TankSync;
    bulletType: BulletType;

    positions: Array<[number, number]>;
    rotations: Array<number>;
    seed: number;
}

export default class GameState {
    isClientSide: boolean;
    tanks: Array<Tank>;
    tankIndex: number;
    walls: Array<Wall>;
    bullets: Array<Bullet>;

    lastUpdate: number;
    addedBullets: Set<Bullet>;
    addedTanks: Array<number>;
    killedTanks: Set<number>;
    changedTankIDs: Set<number>;

    constructor(isClientSide = false) {
        this.isClientSide = isClientSide;
        this.tanks = [];
        this.tankIndex = 0;
        this.walls = [];
        this.bullets = [];

        this.lastUpdate = Date.now(); // Time of last update as UNIX timestamp
        this.addedBullets = new Set();
        this.addedTanks = []; // Requires order
        this.changedTankIDs = new Set();
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

    killTank(tank: Tank) {
        if (!tank.isDead)
            this.killedTanks.add(tank.id);
        tank.isDead = true;
    }

    clearDeltas() {
        this.addedBullets.clear();
        this.changedTankIDs.clear();
        this.addedTanks = [];
        this.killedTanks.clear();
    }

    update() {
        let timestep = (Date.now() - this.lastUpdate) / 1000;
        this.tanks.forEach(tank => tank.update(this, timestep));
        this.bullets.forEach(bullet => bullet.update(this, timestep));
        this.lastUpdate = Date.now();
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
            this.tanks[message.id].rotation = message.rotation;
        } else if (message.type === TankSync.UPDATE_ALL_TANKS) {
            this.tanks = [];
            for (let i = 0; i < message.positions.length; i++)
                this.addTank(new Tank(new Vector(...message.positions[i]), message.rotations[i], i));
        } else if (message.type === TankSync.ADD_BULLET) {
            let bullet = Bullet.bulletFromType(message.bulletType,
                new Vector(...message.position), new Vector(...message.velocity));
            this.addBullet(bullet);
        } else if (message.type === TankSync.MAP_UPDATE)
            generateMaze(this, message.seed);
        else if (message.type === TankSync.TANK_DIED)
            this.tanks[message.id].isDead = true;
        return true;
    }
}
