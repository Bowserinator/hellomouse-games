import Vector from '../vector2d.js';
import Collider from '../collision.js';
import Tank from '../tank.js';
import GameState from '../gamestate.js';
import Explosion from '../explosion.js';

import { BulletType, ExplosionGraphics, ParticleGraphics } from '../../types.js';
import Camera from '../../renderer/camera.js';
import Renderable from '../../renderer/renderable.js';
import { drawShield } from '../powerups/shield.js';
import Particle from '../particle.js';
import { playSoundAt, addSoundsToPreload } from '../../sound/sound.js';

addSoundsToPreload([
    '/tanks/sound/beep.mp3',
    '/tanks/sound/bullet_bounce.ogg'
]);

interface BulletConfig {
    imageUrls: Array<string>; // Abs urls to image, ie /tanks/img/...
    size: Vector; // Size [w, h]
    speed: number; // () -> pixels/s
    despawnTime: number; // Time in ms to despawn
    type: BulletType;

    maxAmmo?: number; // (1 default) Max bullets that can be fired until one despawns
    imageSize?: Vector; // If different from size
    rotate?: boolean; // Rotate texture? (No for symmetric textures)
    allowBounce?: boolean; // Can bounce (otherwise dies on wall)
    bounceEnergy?: number; // 1 (default) = bounce with same, 2 = bounce = double velocity, 0.5 = halve, etc...
    bounceSound?: string; // Src to sound it plays when bounces, undefined = no sound
}


export class Bullet extends Renderable {
    velocity: Vector;
    collider: Collider;
    type: BulletType;
    createdTime: number;
    firedBy: number; // Tank id that fired the bullet, else -1
    config: BulletConfig;
    rotation: number;
    imageUrl: string; // Current image to display
    invincible: boolean; // Can be killed by other bullets?
    isDead: boolean;

    /**
     * Construct a bullet
     * @param {Vector} position Center of the bullet
     * @param {Vector} direction Dir to fire in, speed is dependent on config
     * @param {BulletConfig} config Bullet properties
     */
    constructor(position: Vector, direction: Vector, config: BulletConfig) {
        super(config.imageUrls.map(url => [url, config.imageSize || config.size]));

        if (this.constructor === Bullet)
            throw new Error('Bullet is Abstract');

        position = position.copy();
        position.x -= config.size.x / 2;
        position.y -= config.size.y / 2; // Center bullet

        this.velocity = direction.normalize().mul(config.speed);
        this.collider = new Collider(position, config.size);
        this.createdTime = Date.now();
        this.firedBy = -1;
        this.type = config.type;
        this.rotation = Math.atan2(this.velocity.y, this.velocity.x);
        this.isDead = false;

        this.config = config;
        this.imageUrl = config.imageUrls[0];
        this.invincible = false;

        // Config defaults
        if (this.config.rotate === undefined)
            this.config.rotate = false;
        if (this.config.allowBounce === undefined)
            this.config.allowBounce = true;
        if (this.config.bounceEnergy === undefined)
            this.config.bounceEnergy = 1;
        if (this.config.maxAmmo === undefined)
            this.config.maxAmmo = 1;
    }

    getExtra(): any {
    }

    syncExtra(extra: any) {
        // Extra info for special bullet sync
        // Override
    }

    /**
     * Perform movement updates, such as despawning, bouncing, rotating, etc...
     * Can be overwritten
     * @return {boolean} Resume? (If false update() terminates early)
     */
    updateMovement(gameState: GameState, timestep: number): boolean {
        if (!gameState.isClientSide && Date.now() - this.createdTime > this.config.despawnTime) {
            gameState.removeBullet(this);
            return false;
        }

        let bounces, _;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        [this.velocity, bounces, _] = this.collider.bounce(gameState, this.velocity, timestep,
            this.config.allowBounce, this.config.bounceEnergy);
        if (!gameState.isClientSide && !this.config.allowBounce && bounces > 0) {
            gameState.removeBullet(this);
            return false;
        }

        if (this.config.bounceSound && bounces)
            playSoundAt(this.config.bounceSound, this.collider.position, gameState, 0.5);

        if (this.config.rotate)
            this.rotation = Math.atan2(this.velocity.y, this.velocity.x);
        return true;
    }

    /**
     * Kill other bullets and tanks
     * @return {boolean} Resume? (If false update() terminates early)
     */
    killStuff(gameState: GameState, timestep: number): boolean {
        // Hit other bullets
        for (let bullet of gameState.bullets)
            if (!bullet.isDead && !bullet.invincible && bullet !== this &&
                this.collider.collidesWith(bullet.collider) && !gameState.isClientSide) {
                gameState.removeBullet(bullet);
                if (!this.invincible) {
                    gameState.removeBullet(this);
                    return false;
                }
            }

        // Hit tanks
        for (let tank of gameState.tanks.filter((t: Tank) => !t.isDead))
            if (this.collider.collidesWith(tank.collider) && !gameState.isClientSide) {
                if (tank.invincible)
                    continue;
                gameState.scoreKill(tank, this.firedBy);
                gameState.killTank(tank);
                gameState.removeBullet(this);
                return false;
            }
        return true;
    }

    update(gameState: GameState, timestep: number): boolean {
        if (!this.updateMovement(gameState, timestep)) return false;
        if (!this.killStuff(gameState, timestep)) return false;
        return true;
    }

    getCenter() {
        return new Vector(
            this.collider.position.x + this.collider.size.x / 2,
            this.collider.position.y + this.collider.size.y / 2
        );
    }

    setCenter(position: Vector) {
        position = position.copy();
        position.x -= this.config.size.x / 2;
        position.y -= this.config.size.y / 2; // Center bullet
        this.collider.position = position;
    }

    setVelocityFromDir(direction: Vector) {
        this.velocity = direction.normalize().mul(this.config.speed);
    }

    draw(camera: Camera, gameState: GameState) {
        if (!this.isLoaded()) return;

        const bulletCenter = this.getCenter();
        const imageUrl = this.imageUrl;
        const size = this.config.imageSize || this.collider.size;

        if (this.config.rotate)
            camera.drawImageRotated(this.images[imageUrl], bulletCenter.x, bulletCenter.y, this.rotation);
        else
            camera.drawImage(this.images[imageUrl],
                bulletCenter.x - size.x / 2,
                bulletCenter.y - size.y / 2);
    }

    /**
     * Called when fired by a tank, not when spawned by any other means
     * @param {GameState} gameState
     */
    onFire(gamestate: GameState) {
        // Override if needed
    }

    onRemove(gamestate: GameState) {
        this.isDead = true;
    }

    drawFirePreview(camera: Camera, gameState: GameState) {
        Bullet.drawFirePreview(camera, 2, 0.05, 9, '#777', this, gameState);
    }

    /**
     * Helper to draw the fire preview
     * @param {Camera} camera
     * @param {number} circleSize Size of each circle
     * @param {number} circleTime Time between each circle
     * @param {number} circleCount Number of circles to draw
     * @param {string} color Color of the circles
     * @param {Bullet} bullet
     * @param {GameState} gameState
     */
    static drawFirePreview(camera: Camera, circleSize: number, circleTime: number,
        circleCount: number, color: string, bullet: Bullet, gameState: GameState) {
        let collider = new Collider(bullet.collider.position.copy(), bullet.collider.size.copy());

        for (let i = 0; i < circleCount; i++) {
            let bounces = collider.bounce(gameState, bullet.velocity, circleTime)[1];
            if (!bullet.config.allowBounce && bounces > 0) return;

            camera.fillCircle([collider.position.x + collider.size.x / 2, collider.position.y + collider.size.y / 2],
                circleSize, color);
        }
    }

    /**
     * Get bullet class of a given type
     * @param {BulletType} type Type of the bullet
     * @return {Bullet} bullet
     */
    static bulletClassFromType(type: BulletType) {
        switch (type) {
                case BulletType.NORMAL:
                    return NormalBullet;
                case BulletType.FAST:
                    return HighSpeedBullet;
                case BulletType.MAGNET:
                    return MagneticMineBullet;
                case BulletType.LASER:
                    return LaserBullet;
                case BulletType.BOMB:
                    return BombBullet;
                case BulletType.SMALL:
                    return SmallBullet;
                case BulletType.ROCKET:
                    return RocketBullet;
        }
        throw new Error(`Unknown bullet type ${type}`);
    }

    /**
     * Create a bullet of a given type
     * @param {BulletType} type Type of the bullet
     * @param {Vector} position Position of bullet
     * @param {Vector} direction Direction of bullet
     * @return {Bullet} bullet
     */
    static bulletFromType(type: BulletType, position: Vector, direction: Vector): Bullet {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        const TypeBullet = Bullet.bulletClassFromType(type);
        return new TypeBullet(position, direction);
    }
}


/**
 * Standard bullet
 * @author Bowserinator
 */
export class NormalBullet extends Bullet {
    static config = {
        type: BulletType.NORMAL,
        imageUrls: ['/tanks/img/normal_bullet.png'],
        size: new Vector(7, 7),
        speed: 300,
        despawnTime: 10000,
        maxAmmo: 5,
        bounceSound: '/tanks/sound/bullet_bounce.ogg'
    };

    constructor(position: Vector, direction: Vector) {
        super(position, direction, NormalBullet.config);
    }
}


/**
 * A magnetic mine "smart bomb" that primes after 1 second
 * Once primed cannot be killed by other bullets, and gravitates
 * towards the nearest tank
 * @author Bowserinator
 */
export class MagneticMineBullet extends Bullet {
    static config = {
        type: BulletType.MAGNET,
        imageUrls: ['/tanks/img/magnet_bullet_1.png', '/tanks/img/magnet_bullet_2.png'],
        size: new Vector(14, 14),
        imageSize: new Vector(20, 20),
        speed: 160,
        despawnTime: 10000,
        bounceEnergy: 0.5
    };
    /* eslint-disable @typescript-eslint/naming-convention */
    static PRIME_TIME = 2000; // Time to prime before seeking
    static SEEK_TIME = 7000; // Time to follow before self destructing
    static FLICKER_RATE = 400; // Time in ms for each frame of the primed animation
    static MAX_VELOCITY_COMPONENT = 300; // Max component for velocity after seeking
    static ACCELERATION = 500; // Acceleration when seeking
    static BEEP_DELAY = 800; // Beep every this ms
    /* eslint-enable @typescript-eslint/naming-convention */

    createdTime: number;
    lastSoundPlayedTime: number;

    constructor(position: Vector, direction: Vector) {
        super(position, direction, MagneticMineBullet.config);
        this.createdTime = Date.now();
        this.lastSoundPlayedTime = 0;
    }

    getExtra(): any {
        return [this.createdTime, this.lastSoundPlayedTime];
    }

    syncExtra(extra: any) {
        this.createdTime = extra[0];
        this.lastSoundPlayedTime = extra[1];
    }

    draw(camera: Camera, gameState: GameState) {
        super.draw(camera, gameState);

        const deltaT = Date.now() - this.createdTime;
        if (deltaT > MagneticMineBullet.PRIME_TIME) { // Primed
            // 8x the flciker rate 500ms before it explodes
            const FLICKER_RATE = (MagneticMineBullet.PRIME_TIME + MagneticMineBullet.SEEK_TIME - deltaT) < 1000
                ? MagneticMineBullet.FLICKER_RATE / 8 : MagneticMineBullet.FLICKER_RATE;
            this.imageUrl = this.config.imageUrls[Math.floor(deltaT / FLICKER_RATE) % 2];
            let imgSize = this.config.imageSize ? this.config.imageSize.x : this.config.size.x;

            drawShield(camera, this.getCenter().l(), {
                radius: imgSize / 2 + 1,
                color: 'red', // TODO: color of the tank being targetted
                shadowColor: 'red'
            });
        }
    }

    onRemove(gameState: GameState) {
        super.onRemove(gameState);
        gameState.addExplosion(new Explosion(this.getCenter(), 70, 70, 300, ExplosionGraphics.CLUSTER))
            .setFiredBy(this.firedBy);
    }

    update(gameState: GameState, timestep: number) {
        if (!super.update(gameState, timestep)) return false;

        const deltaT = Date.now() - this.createdTime;
        if (deltaT > MagneticMineBullet.PRIME_TIME + MagneticMineBullet.SEEK_TIME)
            gameState.removeBullet(this);
        else if (deltaT > MagneticMineBullet.PRIME_TIME) {
            // Beep
            if (Date.now() - this.lastSoundPlayedTime > MagneticMineBullet.BEEP_DELAY) {
                this.lastSoundPlayedTime = Date.now();
                playSoundAt('/tanks/sound/beep.mp3', this.collider.position, gameState, 0.5);
            }

            // Primed, accelerate towards nearest tank
            // Also becomes invincible to other bullets
            this.invincible = true;
            let closest = gameState.getNearestTank(this.getCenter());
            if (!closest) return false;

            // Accelerate towards tank
            let tank = closest;
            let v1 = new Vector(
                tank.position.x - this.collider.position.x,
                tank.position.y - this.collider.position.y);
            v1 = v1.normalize().mul(MagneticMineBullet.ACCELERATION);

            this.velocity.x += v1.x * timestep;
            this.velocity.y += v1.y * timestep;

            // Limit max velocity
            const limitAbs = (abs: number, vel: number) => Math.abs(vel) > abs
                ? (vel < 0 ? -abs : abs) : vel;
            this.velocity.x = limitAbs(MagneticMineBullet.MAX_VELOCITY_COMPONENT, this.velocity.x);
            this.velocity.y = limitAbs(MagneticMineBullet.MAX_VELOCITY_COMPONENT, this.velocity.y);
        }
        return true;
    }
}


/**
 * A bomb that explodes when destroyed
 * Fires many small bullets in explosion
 * @author Bowserinator
 */
export class BombBullet extends Bullet {
    static config = {
        type: BulletType.BOMB,
        imageUrls: ['/tanks/img/bomb_bullet.png'],
        size: new Vector(16, 16),
        speed: 150,
        despawnTime: 10000,
        imageSize: new Vector(24, 24),
        bounceSound: '/tanks/sound/bullet_bounce.ogg'
    };

    static bulletsToFire = 50; // Bullets to spawn in explosion

    constructor(position: Vector, direction: Vector) {
        super(position, direction, BombBullet.config);
    }

    onRemove(gameState: GameState) {
        super.onRemove(gameState);
        gameState.addExplosion(new Explosion(this.getCenter(), 40, 60, 500, ExplosionGraphics.CIRCLE));

        for (let angle = 0; angle < Math.PI * 2; angle += Math.PI * 2 / BombBullet.bulletsToFire) {
            let bullet = new SmallBullet(
                this.getCenter().add(Vector.vecFromRotation(angle, 10)),
                Vector.vecFromRotation(angle, 1));
            bullet.firedBy = this.firedBy;
            gameState.addBullet(bullet);
        }
    }
}


/**
 * A hypervelocity railgun slug. Explodes on impact
 * @author Bowserinator
 */
export class HighSpeedBullet extends Bullet {
    static config = {
        type: BulletType.FAST,
        imageUrls: ['/tanks/img/fast_bullet.png'],
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

    update(gameState: GameState, timestep: number) {
        if (!super.update(gameState, timestep)) return false;
        gameState.addExplosion(new Explosion(this.getCenter(), 0, 80, 400, ExplosionGraphics.SHOCKWAVE));
        return true;
    }

    onRemove(gameState: GameState) {
        super.onRemove(gameState);
        gameState.addExplosion(new Explosion(this.getCenter(), 5, 6, 100, ExplosionGraphics.PARTICLES))
            .setFiredBy(this.firedBy);
    }
}


/**
 * A laser beam that bounces around
 * @author Bowserinator
 */
export class LaserBullet extends Bullet {
    static config = {
        type: BulletType.LASER,
        size: new Vector(0, 0),
        speed: 500,
        despawnTime: 200,
        imageUrls: []
    };
    static repeatPerUpdate = 100; // Adjust length of laser

    previousPositions: Array<Vector>;
    fired: boolean;

    constructor(position: Vector, direction: Vector) {
        super(position, direction, LaserBullet.config);
        this.previousPositions = [];
        this.fired = false;
        this.invincible = true;
    }

    getExtra(): any {
        return this.previousPositions.map(v => v.l());
    }

    syncExtra(extra: any) {
        this.previousPositions = extra.map((v: [number, number]) => new Vector(...v));
    }

    updateMovement(gameState: GameState, timestep: number) {
        if (!gameState.isClientSide && Date.now() - this.createdTime > this.config.despawnTime) {
            gameState.removeBullet(this);
            return false;
        }

        if (!this.fired) {
            const repeatPerUpdate = LaserBullet.repeatPerUpdate;

            if (!gameState.isClientSide) {
                this.previousPositions.push(this.collider.position.copy());
                let bounce = 0;
                let bouncePos: Array<Vector> = [];

                for (let i = 0; i < repeatPerUpdate; i++) {
                    [this.velocity, bounce, bouncePos] =
                        this.collider.bounce(gameState, this.velocity, 0.035,
                            this.config.allowBounce, this.config.bounceEnergy);
                    if (bounce)
                        this.previousPositions = this.previousPositions.concat(bouncePos);
                }
            }
            this.velocity = new Vector(0, 0);
            this.fired = true;
        }

        if (this.firedBy > -1)
            this.previousPositions[0] = gameState.tanks[this.firedBy].getFiringPositionAndDirection()[0];
        return true;
    }

    killStuff(gameState: GameState, timestep: number) {
        let p = [...this.previousPositions, this.getCenter()];
        for (let i = 0; i < p.length - 1; i++) {
            let [start, end] = [p[i], p[i + 1]];

            // Hit other bullets
            for (let bullet of gameState.bullets)
                if (!bullet.isDead && !bullet.invincible && bullet !== this &&
                    bullet.collider.collidesWithLine(start, end) && !gameState.isClientSide)
                    gameState.removeBullet(bullet);

            // Hit tanks
            for (let tank of gameState.tanks.filter((t: Tank) => !t.isDead))
                if (!gameState.isClientSide && tank.collider.collidesWithLine(start, end)) {
                    if (tank.invincible)
                        continue;
                    gameState.scoreKill(tank, this.firedBy);
                    gameState.killTank(tank);
                    return false;
                }
        }
        return true;
    }

    draw(camera: Camera, gameState: GameState) {
        let p = [...this.previousPositions, this.getCenter()];
        const rand = (pt: [number, number]): [number, number] => [
            Math.round(pt[0] + (Math.random() - 0.5) * 8),
            Math.round(pt[1] + (Math.random() - 0.5) * 8)];

        for (let i = 0; i < p.length - 1; i++) {
            camera.drawLine(p[i].l(), p[i + 1].l(), 1, 'red');
            camera.drawLine(rand(p[i].l()), rand(p[i + 1].l()), 1, '#ff3333');
            camera.drawLine(rand(p[i].l()), rand(p[i + 1].l()), 1, '#ff3333');
        }
    }

    drawFirePreview(camera: Camera, gameState: GameState) {
        Bullet.drawFirePreview(camera, 1, 0.02, 100, 'red', this, gameState);
    }
}


/**
 * A small shotgun pellet. Slows down over time and has
 * randomized decay time
 * @author Bowserinator
 */
export class SmallBullet extends Bullet {
    static config = {
        type: BulletType.SMALL,
        size: new Vector(4, 4),
        speed: 1000,
        despawnTime: 200,
        imageUrls: ['/tanks/img/small_bullet.png']
    };

    static despawnTimeRange: [number, number] = [400, 800];
    static velocityMulRange: [number, number] = [0.5, 1.5];
    static velocityMultiplier = 0.9; // Velocity decay per tick
    static firePreviewBullets = Array(6).fill(0).map(_ =>
        new SmallBullet(new Vector(0, 0), new Vector(1, 1))); // For preview
    static angleRange = Math.PI / 3; // Fire range
    static bulletsToFire = 16;

    constructor(position: Vector, direction: Vector) {
        super(position, direction, { ...SmallBullet.config });

        const randBetween = (a: number, b: number) => (Math.random() * (b - a)) + a;
        this.config.despawnTime = randBetween(...SmallBullet.despawnTimeRange);
        this.velocity = this.velocity.mul(randBetween(...SmallBullet.velocityMulRange));
    }

    getExtra(): any {
        return [this.config.despawnTime];
    }

    syncExtra(extra: any) {
        this.config.despawnTime = extra[0];
    }

    update(gameState: GameState, timestep: number) {
        if (!super.update(gameState, timestep)) return false;
        if (!gameState.isClientSide)
            this.velocity = this.velocity.mul(SmallBullet.velocityMultiplier);
        return true;
    }

    onFire(gameState: GameState) {
        const thisAngle = this.velocity.angle();
        const halfAngle = SmallBullet.angleRange / 2;

        for (let angleOffset = -halfAngle; angleOffset < halfAngle; angleOffset +=
            SmallBullet.angleRange / SmallBullet.bulletsToFire) {
            let bullet = new SmallBullet(
                this.getCenter(),
                Vector.vecFromRotation(thisAngle + angleOffset, 1));
            bullet.firedBy = this.firedBy;
            gameState.addBullet(bullet);
        }
    }

    drawFirePreview(camera: Camera, gameState: GameState) {
        let angleOffset = -SmallBullet.angleRange / 2;

        // Shotgun fire preview, show multiple paths
        for (let bullet of SmallBullet.firePreviewBullets) {
            bullet.collider.position = this.collider.position.copy();
            bullet.velocity = Vector.vecFromRotation(
                this.velocity.angle() + angleOffset,
                bullet.velocity.magnitude()
            );
            angleOffset += SmallBullet.angleRange / SmallBullet.firePreviewBullets.length;
            Bullet.drawFirePreview(camera, 1.5, 0.02, 14, '#aaa', bullet, gameState);
        }
    }
}


/**
 * A spawner for rocket artillery, not exactly a "bullet", but
 * just an invisible entity
 * @author Bowserinator
 */
export class RocketBullet extends Bullet {
    static config = {
        type: BulletType.ROCKET,
        size: new Vector(0, 0),
        speed: 0,
        despawnTime: 999999, // Manual despawn
        imageUrls: [],
        maxAmmo: 9999
    };

    static warningTime = 1500; // Warning labels in ms
    static attackRadius = 100; // Radius rockets can fall on
    static rocketCount = 3;    // Number of rockets to fall in radius
    static rocketRadius = 24;  // Radius of rocket explosion
    static warningRadius = 24; // Radius of warning marker

    // Hacky thing for client-side sync
    static spawnedWarnings = new Set<number>();

    fireTime: number;
    targetCenter: Vector;
    randomID: number; // Used for map
    lastDrawUpdate: number; // Client side only, rate limits getNearestTank

    // Where to launch rockets to (relative to this.targetCenter)
    offsetLocations: Array<Vector>;

    constructor(position: Vector, direction: Vector) {
        super(position, direction, { ...RocketBullet.config });
        this.fireTime = 0;
        this.targetCenter = position; // Temp, will change in update
        this.randomID = Math.round(Math.random() * 100000);
        this.lastDrawUpdate = 0;
    }

    /**
     * Generate where the rockets fall in the circle
     * Evenly spaces angle and radii, but randomizes radii order
     */
    generateOffsetLocations() {
        this.offsetLocations = [];

        const ANGLE_OFFSET = Math.random() * Math.PI;
        const ANGLE_SIZE = Math.PI * 2 / RocketBullet.rocketCount;
        const RADII = Array(RocketBullet.rocketCount).fill(0)
            .map((x, i) => (i + 1) * RocketBullet.attackRadius / RocketBullet.rocketCount)
            .sort(() => Math.random() - 0.5);

        for (let i = 0; i < RocketBullet.rocketCount; i++)
            this.offsetLocations.push(Vector.vecFromRotation(ANGLE_SIZE * i + ANGLE_OFFSET, RADII[i]));
    }

    /**
     * Update where to target (nearest tank that's not self, or if none, then self)
     * @param {GameState} gameState
     */
    updateTargetCenter(gameState: GameState) {
        let nearest = gameState.getNearestTank(this.getCenter(), [gameState.tanks[this.firedBy]]);
        if (!nearest && this.firedBy > -1) nearest = gameState.tanks[this.firedBy]; // No other tanks, target self
        if (!nearest) return;
        this.targetCenter = nearest.position.copy();
    }

    getExtra(): any {
        return [this.offsetLocations.map(d => d.l()), this.randomID, this.targetCenter.l()];
    }

    syncExtra(extra: any) {
        this.offsetLocations = extra[0].map((d: [number, number]) => new Vector(...d));
        this.randomID = extra[1];
        this.targetCenter = new Vector(...(extra[2] as [number, number]));
    }

    killStuff(gameState: GameState, timestep: number) {
        return true; // The spawner has no effect
    }

    draw(camera: Camera, gameState: GameState) {
        // Don't draw, invisible
    }

    update(gameState: GameState, timestep: number) {
        if (!super.update(gameState, timestep)) return false;

        // Clean up map
        if (this.isDead) {
            RocketBullet.spawnedWarnings.delete(this.randomID);
            return false;
        }

        // (Client-side) Spawn warnings if not already
        if (gameState.isClientSide && !RocketBullet.spawnedWarnings.has(this.randomID)) {
            for (let delta of this.offsetLocations)
                gameState.addParticle(new Particle(
                    this.targetCenter.add(delta),
                    new Vector(0, 0), RocketBullet.warningRadius,
                    RocketBullet.warningTime, ParticleGraphics.WARNING));

            let center = this.getCenter();
            gameState.addExplosion(new Explosion(center, 0, 60, 300, ExplosionGraphics.SHOCKWAVE))
                .setFiredBy(this.firedBy);
            gameState.addExplosion(new Explosion(center, 0, 120, 300, ExplosionGraphics.PARTICLES))
                .setFiredBy(this.firedBy);
            RocketBullet.spawnedWarnings.add(this.randomID);
        }

        let elapsed = Date.now() - this.fireTime;
        if (!gameState.isClientSide && elapsed > RocketBullet.warningTime) {
            for (let delta of this.offsetLocations)
                gameState.addExplosion(new Explosion(
                    this.targetCenter.add(delta),
                    RocketBullet.rocketRadius, RocketBullet.rocketRadius,
                    800, ExplosionGraphics.SIMPLE))
                    .setFiredBy(this.firedBy);
            gameState.removeBullet(this);
            return false;
        }
        return true;
    }

    onFire(gameState: GameState) {
        this.fireTime = Date.now();

        // (Server-side) generate offsets
        if (!gameState.isClientSide && !RocketBullet.spawnedWarnings.has(this.randomID)) {
            this.updateTargetCenter(gameState);
            this.generateOffsetLocations();
            RocketBullet.spawnedWarnings.add(this.randomID);
        }
    }

    drawFirePreview(camera: Camera, gameState: GameState) {
        // Rate limit update target to every 50 ms
        if (Date.now() - this.lastDrawUpdate > 50) {
            this.updateTargetCenter(gameState);
            this.lastDrawUpdate = Date.now();
        }
        camera.ctx.globalCompositeOperation = 'screen';
        camera.ctx.globalAlpha = 0.2;
        camera.fillCircle(this.targetCenter.l(), RocketBullet.attackRadius, 'red');
        camera.ctx.globalAlpha = 1;
        camera.ctx.globalCompositeOperation = 'source-over';
    }
}
