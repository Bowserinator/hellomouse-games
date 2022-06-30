import { Powerup, Direction, BulletType, ExplosionGraphics, TankSync } from '../types.js';
import Collider from './collision.js';
import Vector from './vector2d.js';
import GameState from './gamestate.js';
import Explosion from './explosion.js';
import { Bullet } from './bullets/bullets.js';
import {
    TANK_SPEED, TANK_SIZE, TANK_TURRET_SIZE, TANK_FIRE_DELAY,
    TANK_BASE_ROTATION_RATE, TANK_TURRET_ROTATION_RATE, UPDATE_EVERY_N_MS, MAX_LATENCY_COMP_MS, SYNC_DISTANCE_THRESHOLD, MAX_PREV_TANK_POS, MAX_LERP_DISTANCE_THRESHOLD, POS_SMOOTHING_RATE } from '../vars.js';

import { PowerupSingleton, TANK_TURRET_IMAGE_URLS } from './powerups/powerups.js';

import Camera from '../renderer/camera.js';
import Renderable from '../renderer/renderable.js';
import { playSoundAt, addSoundsToPreload } from '../sound/sound.js';
import performStateDiff from '../util/diff.js';
import { interpol, invInterlop } from '../util/interp.js';

addSoundsToPreload([
    '/tanks/sound/tank_fire_normal.mp3'
]);

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
    tint: [number, number, number];
    tintPrefix: string;
    username: string;

    movement: [Direction, Direction];
    isFiring: boolean;
    isDead: boolean;
    firedThisTick: boolean; // Has it fired this tick?
    missingPlayer: boolean; // If true player has disconnected
    id: number;
    score: number;
    invincible: boolean;
    ready: boolean; // Lobby only
    stealthed: boolean;
    firedBullets: Array<Bullet>; // Only used for tracking ammo count, may not match bullets on screen
    turretImageUrl: string;

    syncDataDiff: Array<any>;

    speed: number;
    oldSpeed: number;
    dirMapCache: Record<Direction, number>;

    // Lag comp
    previousLocations: Array<[number, Vector]>;
    targetLocation: Vector; // Client only

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
        this.firedThisTick = false;
        this.missingPlayer = false;

        // Other
        this.speed = TANK_SPEED;
        this.oldSpeed = 0; // Used to sync dirmap
        // @ts-expect-error
        this.dirMapCache = {};
        this.previousLocations = []; // Used for lag comp
        this.targetLocation = this.position;

        this.username = `Player${Math.floor(Math.random() * 100000)}`;
        this.score = 0;
        this.ready = false;

        this.updateCollider();
        this.tint = [0, 0, 0];
        this.tintPrefix = '';
    }

    /** (Server + client side) reset relevant properties for a round */
    reset() {
        this.turretImageUrl = TANK_TURRET_IMAGE_URLS[Powerup.NONE];
        this.changeBulletType(BulletType.NORMAL);
        this.powerups = [];

        this.velocity = new Vector(0, 0);
        this.lastFired = 0; // UNIX timestamp last fired a bullet
        this.invincible = false;
        this.stealthed = false;
        this.firedBullets = [];
        this.movement = [Direction.NONE, Direction.NONE];
        this.isFiring = false;
        this.isDead = false;
        this.firedThisTick = false;

        this.speed = TANK_SPEED;
        this.oldSpeed = 0;
        this.previousLocations = [];
    }

    /**
     * Set a new username
     * @param username New username
     */
    setUsername(username: string) {
        this.username = username;
    }

    /**
     * Set a new tint color for the tank
     * @param color Color as an RGB array
     */
    setTint(color: [number, number, number]) {
        if (this.imageUrls)
            this.loadTintVariants(color);
        this.tint = color;
        this.tintPrefix = Renderable.rgbToStr(color);
    }

    /**
     * Get a message that can be directly broadcasted
     * @returns Sync message to broadcast, {} if no delta
     */
    toSyncMessage() {
        let syncMessage = this.sync();
        if (syncMessage.length)
            return {
                type: TankSync.GENERIC_TANK_SYNC,
                id: this.id,
                data: syncMessage
            };
        return {};
    }

    /**
     * Returns parameters to sync to clients
     * @param {boolean} diff If false will force send all data
     * @returns Object to send
     */
    sync(diff = true) {
        let truthyStuff =
            (this.isDead ? 1 : 0) +
            (this.invincible ? 2 : 0) +
            (this.stealthed ? 4 : 0) +
            (this.ready ? 8 : 0) +
            (this.missingPlayer ? 16 : 0);

        let data = [
            this.position.l()         // 0
                .map(x => Math.round(x)).join('|'),
            this.rotation.toFixed(2), // 1
            this.movement.join('|'),  // 2
            truthyStuff.toString(36), // 3
            this.score,               // 4
            this.tint.join('|'),      // 5
            this.username             // 6
        ];
        const diffResult = performStateDiff(data, diff, this.syncDataDiff);
        this.syncDataDiff = diffResult[1];
        return diffResult[0];
    }

    /**
     * Sync client given data
     * @param {any} data Data from sync()
     */
    fromSync(id: number, data: any, gameState: GameState) {
        if (!data.length) return;
        let arr = data.split(',');

        if (arr[0] !== '') {
            const newPos = new Vector(...(arr[0].split('|').map((x: string) => +x)) as [number, number]);
            const dis = newPos.distance(this.position);
            if (dis > SYNC_DISTANCE_THRESHOLD)
                this.targetLocation = newPos;
            if (dis > MAX_LERP_DISTANCE_THRESHOLD)
                this.position = newPos;
        }
        if (arr[2] !== '' && gameState.tankIndex !== this.id)
            this.movement = arr[2].split('|').map((x: string) => parseInt(x));
        if (arr[4] !== '')
            this.score = parseInt(arr[4]);
        if (arr[5] !== '')
            this.setTint(arr[5].split('|').map((x: string) => parseInt(x)));
        if (arr[6] !== '')
            this.username = arr[6];

        // Process truthy stuff
        if (arr[3] !== '') {
            let truthyStuff = parseInt(arr[3], 36);
            this.isDead = (truthyStuff & 1) !== 0;
            this.invincible = (truthyStuff & 2) !== 0;
            this.stealthed = (truthyStuff & 4) !== 0;
            this.ready = (truthyStuff & 8) !== 0;
            this.missingPlayer = (truthyStuff & 16) !== 0;
        }

        // Client is free to lie about own rotation since you can rotate
        // instantly anyways, so this prevents rotation stuttering
        if (id !== gameState.tankIndex && arr[1] !== '')
            this.rotation = +arr[1];
    }

    /**
     * Update the collider of the tank
     * If there is no collider create it
     */
    updateCollider() {
        let [x, y] = this.position.l();
        x -= TANK_SIZE / 2;
        y -= TANK_SIZE / 2;
        if (!this.collider)
            this.collider = new Collider(new Vector(x, y), new Vector(TANK_SIZE, TANK_SIZE));
        else {
            this.collider.position.x = x;
            this.collider.position.y = y;
        }
    }

    /**
     * Change the bullet type of the tank, updates
     * firing indicator + bullet type
     * @param bulletType New bullet type
     */
    changeBulletType(bulletType: BulletType) {
        this.bulletType = bulletType;
        this.fakeBullet = Bullet.bulletFromType(this.bulletType,
            ...this.getFiringPositionAndDirection());
    }

    draw(camera: Camera, gamestate: GameState) {
        if (this.isDead) return;
        if (!this.isLoaded(this.tintPrefix)) return;
        if (!gamestate.isVisible(this.collider, 60)) return;

        const isOwnTank = gamestate.tanks[gamestate.tankIndex] === this;
        if (this.stealthed)
            camera.ctx.globalAlpha = isOwnTank ? 0.2 : 0;

        camera.drawImageRotated(this.images[this.tintPrefix + this.imageUrls[0][0]],
            this.position.x, this.position.y, this.realBaseRotation);
        camera.drawImageRotated(this.images[this.tintPrefix + this.turretImageUrl],
            this.position.x, this.position.y, this.visualTurretRotation);
        if (this.stealthed) camera.ctx.globalAlpha = 1;

        if (isOwnTank) {
            let [pos, vel] = this.getFiringPositionAndDirection();

            // If its going to fire through a wall don't render (not allowed)
            if (this.fakeBullet.config.alwaysDrawFirePreview ||
                !gamestate.walls.some(wall => wall.collider.collidesWithLine(this.position, pos))) {
                this.fakeBullet.firedBy = this.id;
                this.fakeBullet.setCenter(pos);
                this.fakeBullet.setVelocityFromDir(vel);
                this.fakeBullet.drawFirePreview(camera, gamestate);
            }
        }
        this.powerups.forEach(powerup => powerup.draw(camera));

        // Draw nametag
        if (!this.stealthed && !this.isDead) {
            let tx = this.position.x;
            let ty = this.position.y - TANK_SIZE / 2 - 10;
            const WIDTH = 120; // Width of nametag

            camera.fillRect([tx - WIDTH / 2, ty - 13], [WIDTH, 20], 'rgba(0, 0, 0, 0.3)');
            camera.ctx.textAlign = 'center';
            camera.ctx.fillStyle = 'white';
            camera.ctx.font = '10pt Rajdhani';

            let slicedusername = this.username;
            while (camera.ctx.measureText(slicedusername).width > WIDTH)
                slicedusername = slicedusername.slice(0, slicedusername.length - 1);
            camera.ctx.fillText(slicedusername, ...camera.worldToScreen(tx, ty));
        }
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
        // Also add bullet size to avoid shield collisions
        let rot = Vector.vecFromRotation(this.rotation, 0.73 * TANK_SIZE +
            Math.max(...Bullet.bulletClassFromType(this.bulletType).config.size.l()));
        let pos = this.position.add(rot);
        let dir = rot;
        return [pos, dir];
    }

    /**
     * Helper to change tank rotation
     * @param target End up rotating here
     * @param visual Current visual rotation
     * @param rate How fast (rad / s) to rotate at most
     * @param timestep Timestep since last update tick (s)
     */
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

    /**
     * Update the base (not the turret) rotation to match velocity
     * @param timestep Timestep since last delta
     */
    updateBaseRotation(timestep: number) {
        // Update current target base rotation
        if (!this.velocity.isZero())
            this.targetBaseRotation = Math.atan2(this.velocity.y, this.velocity.x);
        this.updateRotation('targetBaseRotation', 'realBaseRotation', TANK_BASE_ROTATION_RATE, timestep);
    }

    /**
     * Called when the tank is fired client side
     * @param gameState GameState
     */
    onFireClientSide(gameState: GameState) {
        // Only normal plays this, all other bullets play from the powerup
        if (this.bulletType === BulletType.NORMAL)
            playSoundAt('/tanks/sound/tank_fire_normal.mp3', this.position, gameState);

        // Sync client side powerups
        this.powerups.forEach(p => p.onFire(gameState));
    }

    /**
     * Get a direction map of Direction: velocity component
     * @returns Dirmap
     */
    getDirMap() {
        if (this.oldSpeed !== this.speed) {
            this.oldSpeed = this.speed;
            // @ts-ignore:next-line
            let dirMap: Record<Direction, number> = {};
            dirMap[Direction.LEFT] = -this.speed;
            dirMap[Direction.UP] = -this.speed;
            dirMap[Direction.RIGHT] = this.speed;
            dirMap[Direction.DOWN] = this.speed;
            dirMap[Direction.NONE] = 0;
            this.dirMapCache = dirMap;
            return dirMap;
        }
        return this.dirMapCache;
    }

    /**
     * Client only move the tank, used to move the tank immediately
     * to create an illusion of no latency
     * @param gameState GameState
     * @param movement Movement for [x, y] dir
     */
    clientSideMove(gameState: GameState, movement: [Direction, Direction]) {
        if (!gameState.isClientSide || gameState.shouldInhibitMovement()) return;

        const dirMap = this.getDirMap();
        let [xDir, yDir] = [dirMap[movement[0]], dirMap[movement[1]]];
        this.movement = movement;
        this.velocity = new Vector(xDir, yDir);
        this.updateBaseRotation(UPDATE_EVERY_N_MS / 1000);
    }

    /**
     * Perform a movement in a given direction as well as perform collision
     * @param gameState GameState
     * @param movement Movement direction in [x, y] Direction enums
     * @param timestep Timestep passed, negative = move backwards
     */
    performMove(gameState: GameState, movement: [Direction, Direction], timestep: number, updateRotation: boolean) {
        const dirMap = this.getDirMap();
        let [xDir, yDir] = [dirMap[movement[0]], dirMap[movement[1]]];

        if (updateRotation) {
            this.updateBaseRotation(timestep);
            this.updateRotation('rotation', 'visualTurretRotation', TANK_TURRET_ROTATION_RATE, timestep);
        }

        this.velocity = new Vector(xDir, yDir);
        if (!gameState.shouldInhibitMovement()) {
            this.position.x += timestep * this.velocity.x;
            this.position.y += timestep * this.velocity.y;
        }
        this.updateCollider();

        // Wall + tank collisions
        for (let collider of [
            ...gameState.walls,
            ...gameState.tanks.filter(tank => !tank.isDead && tank.id !== this.id)
        ].map(x => x.collider))
            if (collider.collidesWith(this.collider)) {
                this.position = this.collider.getSnapPosition(collider)[0];
                this.position.x += TANK_SIZE / 2;
                this.position.y += TANK_SIZE / 2;
                this.velocity = new Vector(0, 0);
                this.updateCollider();
            }
    }

    /**
     * Perform movement lag compensation on the server side
     * @param gameState GameState
     * @param time Time the move was passed (A Date.now(), must be before now)
     * @param desiredMovement Desired movement direction [x, y] in Direction enums
     */
    performMovementLagCompensation(gameState: GameState, time: number | undefined,
        desiredMovement: [Direction, Direction]) {
        if (!time) return;
        let timestep = Date.now() - time;

        if (timestep < 0) return; // Not possible, hacking
        if (gameState.shouldInhibitMovement()) return;

        timestep = Math.min(MAX_LATENCY_COMP_MS / 1000, timestep / 1000);

        // Perform rollback, interpolate between previous positions
        for (let i = this.previousLocations.length - 1; i >= 0; i--) {
            const [t, prevLoc] = this.previousLocations[i];
            if (t < time || i === 0) {
                const nextLoc = this.previousLocations[i + 1] || [Date.now(), this.position];
                const timePercent = invInterlop(time, t, nextLoc[0]);

                this.position.x = interpol(prevLoc.x, nextLoc[1].x, timePercent);
                this.position.y = interpol(prevLoc.y, nextLoc[1].y, timePercent);
                this.updateCollider();
                break;
            }
        }

        // Perform current move
        this.performMove(gameState, desiredMovement, timestep, false);
    }

    update(gameState: GameState, timestep: number) {
        if (this.isDead) return;
        if (this.missingPlayer) {
            gameState.killTank(this);
            return;
        }

        // If client ease to target location
        if (gameState.isClientSide) {
            this.position.x = interpol(this.position.x, this.targetLocation.x, POS_SMOOTHING_RATE);
            this.position.y = interpol(this.position.y, this.targetLocation.y, POS_SMOOTHING_RATE);
        }

        // Store previous locations
        this.previousLocations.push([Date.now(), this.position.copy()]);
        if (this.previousLocations.length > MAX_PREV_TANK_POS)
            this.previousLocations.shift();

        // Move + collisions
        this.performMove(gameState, this.movement, timestep, true);

        // Firing
        if (!gameState.shouldInhibitMovement() && this.isFiring && (Date.now() - this.lastFired) > TANK_FIRE_DELAY) {
            this.firedBullets = this.firedBullets.filter(b => !b.isDead && b.type === this.bulletType);
            if (this.firedBullets.length < (this.fakeBullet.config.maxAmmo || 1)) {
                // Check if firing would collide with a wall
                // Only fire if it doesn't
                let [pos, vel] = this.getFiringPositionAndDirection();
                if (!gameState.walls.some(wall => wall.collider.collidesWithLine(this.position, pos))) {
                    let bullet = Bullet.bulletFromType(this.bulletType, pos, vel);
                    bullet.firedBy = this.id;
                    bullet.onFire(gameState);
                    this.powerups.forEach(powerup => powerup.onFire(gameState));

                    gameState.addBullet(bullet);
                    this.firedBullets.push(bullet);
                    this.lastFired = Date.now();
                    this.firedThisTick = true; // Removed by server
                }
            }
        }

        this.powerups.forEach(powerup => powerup.update(gameState, timestep));
    }
}
