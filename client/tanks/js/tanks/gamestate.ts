import { Direction, TankSync, BulletType, ExplosionGraphics, Powerup } from '../types.js';
import { Bullet } from './bullets/bullets.js';
import Camera from '../renderer/camera.js';
import { generateMazeImage } from '../renderer/maze-image-gen.js';

import Vector from './vector2d.js';
import Wall from './wall.js';
import Tank from './tank.js';
import Explosion from './explosion.js';
import Particle from './particle.js';
import { generateMaze, getMazeSize } from './map-gen.js';
import { PowerupItem } from './powerups/powerup-item.js';
import { createPowerupFromType } from './powerups/powerups.js';
import { CELL_SIZE, MAX_POWERUP_ITEMS, POWERUP_ITEM_SIZE, DELAY_POWERUP_SPAWN, POWERUPS_TO_SPAWN_AT_ONCE, DELAY_AFTER_WIN_ROUND } from '../vars.js';
import Collider from './collision.js';
import performStateDiff from '../util/diff.js';

interface SyncMessage {
    seed: number;
    movement: [Direction, Direction];
    position: [number, number];
    velocity: [number, number];
    rotation: number;
    id: number;
    ids: Array<number>;
    type: TankSync;
    bulletType: BulletType;
    bulletTypes: Array<BulletType>;
    extra?: any;
    extras: Record<number, any>;

    velocities: Array<[number, number]>;
    positions: Array<[number, number]>;
    rotations: Array<number>;
    indices: Array<number>;

    damageRadii: Array<number>;
    graphicsRadii: Array<number>;
    durations: Array<number>;
    graphics: Array<ExplosionGraphics>;
    powerup: Powerup;
    data: string;
}

/**
 * GameState class, stores almost everything related to the game
 * @author Bowserinator
 */
export default class GameState {
    isClientSide: boolean;
    tanks: Array<Tank>;
    tankIndex: number;
    walls: Array<Wall>;
    bullets: Array<Bullet>;
    explosions: Array<Explosion>;
    powerupItems: Array<PowerupItem>;

    lastUpdate: number;
    lastPowerupSpawn: number;
    addedBullets: Set<Bullet>;
    removedBulletIds: Set<number>;
    addedTanks: Array<number>;
    killedTanks: Set<number>;
    changedTankIDs: Set<number>;
    addedExplosions: Set<Explosion>;
    addedPowerupItems: Set<PowerupItem>;
    removedPowerupItems: Set<PowerupItem>;
    addedPowerups: Set<[Powerup, number]>; // Powerup, tankid

    totalRounds: number;
    round: number;
    previousRound: number; // Client only
    timeSinceRoundEnded: number; // Server only
    timeRoundStarted: number; // Server only

    camera: Camera; // Set in game.js
    zeroCameraCache: Camera; // Cached camera
    mazeSeed: number;

    // Clientside only:
    mazeLayer?: HTMLCanvasElement;
    mazeShadowLayer?: HTMLCanvasElement;
    particles: Array<Particle>;

    // State diff
    syncDataDiff: Array<any>;
    inLobby: boolean;

    /**
     * Construct a new GameState
     * @param isClientSide Is this on the client?
     */
    constructor(isClientSide = false) {
        this.isClientSide = isClientSide;
        this.tanks = [];
        this.tankIndex = 0; // Client tank index
        this.walls = [];
        this.bullets = [];
        this.explosions = [];
        this.particles = []; // Client side only
        this.powerupItems = [];
        this.mazeSeed = 0;

        this.lastPowerupSpawn = Date.now();
        this.lastUpdate = Date.now(); // Time of last update as UNIX timestamp
        this.addedBullets = new Set();
        this.removedBulletIds = new Set();
        this.addedTanks = []; // Requires order
        this.changedTankIDs = new Set();
        this.addedExplosions = new Set();
        this.killedTanks = new Set();
        this.addedPowerupItems = new Set();
        this.removedPowerupItems = new Set();
        this.addedPowerups = new Set();

        this.totalRounds = 20;
        this.round = 0;
        this.previousRound = 0;
        this.inLobby = true;
        this.timeSinceRoundEnded = -1;
        this.timeRoundStarted = -1;
        this.syncDataDiff = [];
    }

    /** Go from lobby -> game */
    startGame() {
        this.inLobby = false;
        this.tanks.forEach(tank => tank.score = 0); // Reset scores
        this.startRound();
    }

    /** Start a new round */
    startRound() {
        this.timeRoundStarted = Date.now();

        if (!this.isClientSide)
            this.round++;

        // Revive all tanks, remove powerups
        this.tanks.forEach(tank => tank.reset());
        this.walls = [];
        this.bullets = [];
        this.explosions = [];
        this.particles = [];
        this.powerupItems = [];
        this.lastPowerupSpawn = Date.now();

        // All rounds elapsed
        if (!this.isClientSide && this.round > this.totalRounds) {
            this.round = 0;
            this.inLobby = true;
            return;
        }

        // Regnerate maze + move tanks around
        if (!this.isClientSide) {
            let mapSeed = Math.floor(Math.random() * 100000000);
            generateMaze(this, mapSeed);
            this.mazeSeed = mapSeed;
            this.spreadTanks();
        }
    }

    /** Advance round if can (Server side only) */
    advanceRoundCheck() {
        if (!this.isClientSide)
            if (this.timeSinceRoundEnded < 0 && this.getAliveTanks().length <= 1)
                this.timeSinceRoundEnded = Date.now();
            else if (this.timeSinceRoundEnded > 0 && Date.now() - this.timeSinceRoundEnded > DELAY_AFTER_WIN_ROUND) {
                this.timeSinceRoundEnded = -1;

                // Give a point to all surviving tanks
                this.getAliveTanks().forEach(tank => tank.score++);
                this.startRound();
            }
    }

    /**
     * Give a tank a powerup
     * @param tank Tank to give powerup
     * @param powerup Powerup enum type to give
     */
    giveTankPowerup(tank: Tank, powerup: Powerup) {
        let powerupState = createPowerupFromType(powerup, tank);
        tank.powerups.push(powerupState);
        this.addedPowerups.add([powerup, tank.id]);
    }

    /**
     * Find nearest tank to a position, ignores dead & stealthed tanks
     * @param position Position to find nearest tank to
     * @param exclude Array of tanks to exclude in search
     * @returns Nearest tank, or null if none found
     */
    getNearestTank(position: Vector, exclude: Array<Tank> = []) {
        let tanks = this.tanks.filter(tank => !tank.isDead && !tank.stealthed && !exclude.includes(tank));
        if (!tanks.length) return null;
        return tanks.reduce((a, b) => a.position.distance2(position) < b.position.distance2(position) ? a : b);
    }

    /** Clear all deltas, call (server side) after syncing with client */
    clearDeltas() {
        this.addedBullets.clear();
        this.removedBulletIds.clear();
        this.changedTankIDs.clear();
        this.addedTanks = [];
        this.killedTanks.clear();
        this.addedExplosions.clear();
        this.addedPowerupItems.clear();
        this.removedPowerupItems.clear();
        this.addedPowerups.clear();
    }

    /**
     * Get all alive tanks
     * @returns Array of tanks that aren't dead
     */
    getAliveTanks() {
        return this.tanks.filter(tank => !tank.isDead);
    }

    /**
     * Randomly spread all (alive) players through the maze
     * Also randomizes starting rotations
     */
    spreadTanks() {
        // Relocate all tanks outside of maze for now
        const aliveTanks = this.getAliveTanks();
        aliveTanks.forEach(tank => {
            tank.position.x = -100;
            tank.position.y = -100;
            tank.updateCollider();
        });

        const size = getMazeSize(this.mazeSeed);
        for (let tank of aliveTanks) {
            let [x, y] = [0, 0];
            while (!x || !y || aliveTanks.some(t => t.collider.contains(new Vector(x, y)))) {
                x = CELL_SIZE / 2 + CELL_SIZE * Math.round(Math.random() * (size - 1));
                y = CELL_SIZE / 2 + CELL_SIZE * Math.round(Math.random() * (size - 1));
            }
            tank.position.x = x;
            tank.position.y = y;
            tank.rotation = Math.random() * Math.PI * 2;
            tank.updateCollider();
        }
    }

    /**
     * Spawn a random powerup somewhere in the maze. Can fail to spawn
     * a powerup if there are no empty spots or too many existing powerups
     */
    spawnRandomPowerup() {
        let powerups = Object.values(Powerup).filter(x => typeof x !== 'string');
        powerups = powerups.filter((p, i) => powerups[i] !== Powerup.NONE);

        const powerup = powerups[Math.floor(Math.random() * powerups.length)];
        const size = getMazeSize(this.mazeSeed);
        let [x, y] = [0, 0];

        // No more room for maze items
        if (this.powerupItems.length > Math.min(MAX_POWERUP_ITEMS, size * size))
            return;

        // Pick unoccupied spot away from tanks
        let attempts = 0;
        while (!x || !y ||
            this.powerupItems.some(i => i.collider.position.x === x && i.collider.position.y === y) ||
            this.getAliveTanks()
                .some(tank => tank.position.distance(new Vector(x, y)) < CELL_SIZE)) {
            x = CELL_SIZE / 2 + CELL_SIZE * Math.round(Math.random() * (size - 1)) - POWERUP_ITEM_SIZE / 2;
            y = CELL_SIZE / 2 + CELL_SIZE * Math.round(Math.random() * (size - 1)) - POWERUP_ITEM_SIZE / 2;
            attempts++;
            if (attempts > 10) return;
        }
        this.addPowerupItem(new PowerupItem(new Vector(x, y), powerup as Powerup));
    }

    /** Update tick, called BOTH on client & server */
    update() {
        let timestep = (Date.now() - this.lastUpdate) / 1000;

        if (!this.inLobby) {
            this.advanceRoundCheck();

            this.particles.forEach(particle => particle.update(this, timestep));
            this.tanks.forEach(tank => tank.update(this, timestep));
            this.bullets.forEach(bullet => bullet.update(this, timestep));
            this.explosions.forEach(explosion => explosion.update(this, timestep));
            this.powerupItems.forEach(item => item.update(this, timestep));

            if (!this.isClientSide && this.lastUpdate - this.lastPowerupSpawn > DELAY_POWERUP_SPAWN) {
                this.lastPowerupSpawn = this.lastUpdate;
                for (let i = 0; i < POWERUPS_TO_SPAWN_AT_ONCE; i++)
                    this.spawnRandomPowerup();
            }
        }

        this.lastUpdate = Date.now();
    }

    /**
     * Give a player points for a kill
     * @param killedTank Tank that was killed
     * @param firedBy tankIndex that fired the killing shot
     */
    scoreKill(killedTank: Tank, firedBy: number) {
        if (killedTank.id !== firedBy && firedBy > -1) // No points for suicide shots
            this.tanks[firedBy].score++;
    }

    /**
     * Is a collider visible (in viewport)
     * @param collider Collider to check again
     * @param margin Margin to expand past edge of screen (total)
     * @returns Is visible? (In camera viewport?)
     */
    isVisible(collider: Collider, margin = 0) {
        const [w, h] = [this.camera.ctx.canvas.width + margin, this.camera.ctx.canvas.height + margin];
        const [cx, cy] = [this.camera.position.x, this.camera.position.y];

        const xMatch = collider.position.x + collider.size.x >= cx && collider.position.x <= cx + w;
        const yMatch = collider.position.y + collider.size.y >= cy && collider.position.y <= cy + h;
        return xMatch && yMatch;
    }

    /** Draw arrows on edges to show where other players are */
    drawOtherPlayerMarkers() {
        const [w, h] = [this.camera.ctx.canvas.width, this.camera.ctx.canvas.height];
        const MARGIN = 10;
        const ARROW_SIZE = 10;

        for (let tank of this.tanks) {
            if (tank.isDead || tank.stealthed || tank === this.tanks[this.tankIndex])
                continue;

            if (!this.isVisible(tank.collider)) {
                const [tx, ty] = this.camera.worldToScreen(...tank.position.l());
                let x = Math.max(MARGIN, Math.min(w - MARGIN, tx));
                let y = Math.max(MARGIN, Math.min(h - MARGIN, ty));

                if (y === h - MARGIN) { // Bottom
                    this.camera.ctx.beginPath();
                    this.camera.ctx.moveTo(x, y);
                    this.camera.ctx.lineTo(x - ARROW_SIZE, y - ARROW_SIZE);
                    this.camera.ctx.lineTo(x + ARROW_SIZE, y - ARROW_SIZE);
                } else if (y === MARGIN) { // Top
                    this.camera.ctx.beginPath();
                    this.camera.ctx.moveTo(x, y);
                    this.camera.ctx.lineTo(x - ARROW_SIZE, y + ARROW_SIZE);
                    this.camera.ctx.lineTo(x + ARROW_SIZE, y + ARROW_SIZE);
                } else if (x === w - MARGIN) { // Right
                    this.camera.ctx.beginPath();
                    this.camera.ctx.moveTo(x, y);
                    this.camera.ctx.lineTo(x - ARROW_SIZE, y + ARROW_SIZE);
                    this.camera.ctx.lineTo(x - ARROW_SIZE, y - ARROW_SIZE);
                } else if (x === MARGIN) { // Left
                    this.camera.ctx.beginPath();
                    this.camera.ctx.moveTo(x, y);
                    this.camera.ctx.lineTo(x + ARROW_SIZE, y + ARROW_SIZE);
                    this.camera.ctx.lineTo(x + ARROW_SIZE, y - ARROW_SIZE);
                }
                this.camera.ctx.closePath();
                this.camera.ctx.strokeStyle = 'black';
                this.camera.ctx.stroke();
                this.camera.ctx.fillStyle = tank.tintPrefix;
                this.camera.ctx.fill();
            }
        }
    }

    /** Draw the game state */
    draw() {
        // if (this.mazeShadowLayer)
        //    this.camera.drawImage(this.mazeShadowLayer, 0, 0);

        this.powerupItems.forEach(p => p.draw(this.camera, this));
        this.tanks.forEach(tank => tank.draw(this.camera, this));

        if (this.mazeLayer)
            this.camera.drawImage(this.mazeLayer, 0, 0);

        this.particles.forEach(particle => particle.draw(this.camera, this));
        this.bullets.forEach(bullet => bullet.draw(this.camera, this));
        this.explosions.forEach(explosion => explosion.draw(this.camera, this));

        this.drawOtherPlayerMarkers();
    }

    /**
     * Return a sync object
     * @param {boolean} diff Perform a diff with previous state
     * @return Object to send
     */
    sync(diff = true) {
        let data = [
            this.totalRounds,         // 0
            this.round,               // 1
            this.inLobby ? '1' : '0', // 2
            this.mazeSeed             // 3
        ];

        const diffResult = performStateDiff(data, diff, this.syncDataDiff);
        this.syncDataDiff = diffResult[1];
        return diffResult[0];
    }

    /**
     * Update state on client from a server message
     * Call from client side only
     * @param {SyncMessgae} message
     * @return {boolean} Success / changed?
     */
    syncFromMessage(message: SyncMessage) {
        switch (message.type) {
            // Sync most tank properties
            case TankSync.GENERIC_TANK_SYNC: {
                if (message.id === undefined || !this.tanks[message.id]) return false;
                this.tanks[message.id].fromSync(message.id, message.data, this);
                break;
            }

            // Create new bullet / remove bullets / sync all bullets from scratch (to avoid desyncs)
            case TankSync.ADD_BULLET: {
                let bullet = Bullet.bulletFromType(message.bulletType,
                    new Vector(...message.position), new Vector(...message.velocity));
                if (message.extra)
                    bullet.syncExtra(message.extra);
                this.addBullet(bullet);
                break;
            }
            case TankSync.REMOVE_BULLETS: {
                this.bullets = this.bullets.filter((b, i) => !message.indices.includes(i));
                break;
            }
            case TankSync.SYNC_ALL_BULLETS: {
                this.bullets = [];
                for (let i = 0; i < message.positions.length; i++) {
                    this.bullets.push(Bullet.bulletFromType(
                        message.bulletTypes[i],
                        new Vector(...message.positions[i]),
                        new Vector(...message.velocities[i])
                    ));
                    if (message.extras[i])
                        this.bullets[this.bullets.length - 1].syncExtra(message.extras[i]);
                }
                break;
            }

            // Create explosions / powerups / remove powerups
            case TankSync.ADD_EXPLOSIONS: {
                for (let i = 0; i < message.positions.length; i++)
                    this.addExplosion(new Explosion(
                        new Vector(...message.positions[i]),
                        message.damageRadii[i],
                        message.graphicsRadii[i],
                        message.durations[i],
                        message.graphics[i]
                    ));
                break;
            }
            case TankSync.ADD_POWERUP_ITEM: {
                let item = new PowerupItem(
                    new Vector(...message.position),
                    message.powerup
                );
                item.randomID = message.id;
                this.addPowerupItem(item);
                break;
            }
            case TankSync.DELETE_POWERUP_ITEM: {
                this.powerupItems = this.powerupItems.filter(p => p.randomID !== message.id);
                break;
            }
            case TankSync.GIVE_POWERUP: {
                this.giveTankPowerup(this.tanks[message.id], message.powerup);
                break;
            }

            // Used for syncing powerup firing events
            case TankSync.TANK_FIRED: {
                if (this.isClientSide)
                    message.ids.forEach(id => this.tanks[id].onFireClientSide(this));
                break;
            }

            // Recreate all tanks from scratch
            case TankSync.CREATE_ALL_TANKS: {
                this.tanks = [];
                for (let syncMessage of message.data) {
                    this.addTank(new Tank(new Vector(-10, -10), 0));
                    const i = this.tanks.length - 1;
                    this.tanks[i].fromSync(i, syncMessage, this);
                    this.tankIndex = message.id;
                }
                break;
            }

            // Sync game state attributes
            case TankSync.STATE_SYNC: {
                const data = message.data;
                if (!data.length) return;
                let arr = data.split(',');

                if (arr[0] !== '')
                    this.totalRounds = parseInt(arr[0]);
                if (arr[1] !== '') {
                    this.round = parseInt(arr[1]);
                    if (this.round !== this.previousRound) {
                        this.previousRound = this.round;
                        this.startRound();
                    }
                }
                if (arr[2] !== '')
                    this.inLobby = arr[2] === '1';
                if (arr[3] !== '') {
                    this.mazeSeed = parseInt(arr[3]);
                    let [w, h] = generateMaze(this, this.mazeSeed);
                    this.mazeLayer = generateMazeImage(this.walls, w, h);
                }
                break;
            }
        }
        return true;
    }

    /**
     * Kill a tank (NOT remove), this means exploding the tank
     * Calls on killed events + updates killed tank delta
     * @param tank Tank to kill
     */
    killTank(tank: Tank) {
        if (!tank.isDead) {
            this.killedTanks.add(tank.id);
            tank.onDeath(this);
        }
        tank.isDead = true;
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
     * @returns The bullet added
     */
    addBullet(bullet: Bullet) {
        this.bullets.push(bullet);
        this.addedBullets.add(bullet);
        return bullet;
    }

    /**
     * Add a explosion + update explosion delta
     * @param explosion Explosion to add
     * @returns The explosion added
     */
    addExplosion(explosion: Explosion) {
        this.explosions.push(explosion);
        this.addedExplosions.add(explosion);
        return explosion;
    }

    /**
     * Add a new particle. Only works client side
     * @param particle Particle to add, only works on client
     * @returns Particle added
     */
    addParticle(particle: Particle) {
        if (!this.isClientSide) return;
        this.particles.push(particle);
        return particle;
    }

    /**
     * Add a powerup item + add to powerup item diff
     * @param powerup Add a new powerup
     * @returns The added powerup
     */
    addPowerupItem(powerup: PowerupItem) {
        this.powerupItems.push(powerup);
        this.addedPowerupItems.add(powerup);
        return powerup;
    }

    /**
     * Remove a bullet + add to remove bullet delta + trigger onRemove
     * @param bullet Bullet to remove
     */
    removeBullet(bullet: Bullet) {
        bullet.isDead = true;
        bullet.onRemove(this);

        let i = this.bullets.indexOf(bullet);
        if (i > -1) this.removedBulletIds.add(i);
        this.bullets = this.bullets.filter((b: Bullet) => b !== bullet);
    }

    /**
     * Delete an explosion. This is not synced as explosions decay naturally
     * @param explosion Explosion to remove
     */
    removeExplosion(explosion: Explosion) {
        this.explosions = this.explosions.filter((e: Explosion) => e !== explosion);
        this.addedExplosions.delete(explosion);
    }

    /**
     * Particle to remove, only should be called client side
     * @param particle Particle to remove
     */
    removeParticle(particle: Particle) {
        this.particles = this.particles.filter(p => p !== particle);
    }

    /**
     * Remove a powerup item and add to delta
     * @param powerup Powerup item to remove
     */
    removePowerupItem(powerup: PowerupItem) {
        this.removedPowerupItems.add(powerup);
        this.powerupItems = this.powerupItems.filter(p => p !== powerup);
    }
}
