import { Bullet } from './bullets.js';
import Vector from './vector2d.js';
import Wall from './wall.js';
import Tank from './tank.js';


export default class GameState {
    tanks: Array<Tank>;
    tankIndex: number;
    walls: Array<Wall>;
    bullets: Array<Bullet>;
    lastUpdate: number;

    constructor() {
        this.tanks = [];
        this.tankIndex = 0;
        this.walls = [];
        this.bullets = [];

        this.lastUpdate = Date.now(); // Time of last update as UNIX timestamp
        this.addedBullets = new Set();
        this.addedTanks = []; // Requires order
        this.changedTanks = new Set();
    }

    addTank(tank: Tank) {
        let id = this.tanks.push(tank);
        this.addedTanks.push(id - 1);
        return id;
    }

    addBullet(bullet: Bullet) {
        this.bullets.push(bullet);
        this.addedBullets.add(bullet);
    }

    clearDeltas() {
        this.addedBullets.clear();
        this.changedTanks.clear();
        this.addedTanks = [];
    }

    update() {
        let timestep = (Date.now() - this.lastUpdate) / 1000;
        this.tanks.forEach(tank => tank.update(this, timestep));
        this.lastUpdate = Date.now();
    }

    syncFromMessage(message) {
        // TODO use enums
        if (message.action === 'MAP') {
            // Update map from scratch
            this.walls = [];
        }
        else if (message.action === 'POS') {
            // Positions of tanks
        }
        else if (message.action === 'CB') {
            // Create new bullet
        }
        else if (message.action === 'DB') {
            // Destroy existing bullet
        }
    }
}
