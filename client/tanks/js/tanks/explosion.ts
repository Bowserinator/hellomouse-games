import Vector from './vector2d.js';
import GameState from './gamestate.js';
import Particle from './particle.js';
import Camera from '../renderer/camera.js';
import { ExplosionGraphics, ParticleGraphics } from '../types.js';
import gradient from '../renderer/gradient.js';
import { playSoundAt, addSoundsToPreload } from '../sound/sound.js';

addSoundsToPreload([
    '/tanks/sound/explode2.mp3',
    '/tanks/sound/teleport.mp3'
]);

/**
 * On screen explosion
 * @author Bowserinator
 */
export default class Explosion {
    position: Vector;
    damageRadius: number;
    graphicsRadius: number;
    duration: number;
    firedBy: number;
    graphics: ExplosionGraphics;
    createdTimestep: number;
    firstRun: boolean;

    /**
     * Create a new explosion
     * @param {Vector} postion Center of explosion
     * @param {number} damageRadius Damage radius (counted from center of collider)
     * @param {number} graphicsRadius Radius to render the explosion
     * @param {number} duration Duration of explosion
     * @param {ExplosionGraphics} graphics What graphics type to display as
     */
    constructor(position: Vector, damageRadius: number, graphicsRadius: number,
        duration: number, graphics = ExplosionGraphics.SIMPLE) {
        this.position = position;
        this.damageRadius = damageRadius;
        this.graphicsRadius = graphicsRadius;
        this.duration = duration;
        this.graphics = graphics;
        this.createdTimestep = Date.now();
        this.firstRun = true;
        this.firedBy = -1;
    }

    /**
     * Set who is responsible for any kills by this explosion
     * @param firedBy Tank index
     */
    setFiredBy(firedBy: number) {
        this.firedBy = firedBy;
    }

    /**
     * Update tick
     * @param gameState GameState
     * @param timestep Timestep diff in s
     */
    update(gameState: GameState, timestep: number) {
        if (Date.now() - this.createdTimestep > this.duration)
            gameState.removeExplosion(this);

        // Perform damage to tanks only
        // (Not bullets since some explosions spawn bullets)
        if (this.damageRadius > 0)
            for (let tank of gameState.getAliveTanks())
                if (!gameState.isClientSide && tank.collider.collidesWithCircle(this.position, this.damageRadius)) {
                    if (tank.invincible)
                        continue;
                    gameState.scoreKill(tank, this.firedBy);
                    gameState.killTank(tank);
                }

        if (this.firstRun) {
            // Play sound on first tick
            if (![ExplosionGraphics.PARTICLES, ExplosionGraphics.SHOCKWAVE, ExplosionGraphics.TELE]
                .includes(this.graphics))
                playSoundAt('/tanks/sound/explode2.mp3', this.position, gameState);
            else if (this.graphics === ExplosionGraphics.TELE)
                playSoundAt('/tanks/sound/teleport.mp3', this.position, gameState);

            // Spawn particles on first tick
            switch (this.graphics) {
                case ExplosionGraphics.PARTICLES: {
                    this._spawnParticles(gameState, 10, this.position, 400,
                        ParticleGraphics.SIMPLE, 6, 300);
                    this._spawnParticles(gameState, 20, this.position, 200,
                        ParticleGraphics.SPARKS, 6, 500);
                    break;
                }
                case ExplosionGraphics.SIMPLE: {
                    this._spawnParticles(gameState, 40, this.position, 400,
                        ParticleGraphics.SIMPLE, 8, 600);
                    this._spawnParticles(gameState, 60, this.position, 200,
                        ParticleGraphics.SPARKS, 8, 800);
                    break;
                }
                case ExplosionGraphics.TELE: {
                    for (let i = 0; i < 5; i++) {
                        let speed = 30 * i;
                        gameState.addParticle(new Particle(
                            this.position.copy(), new Vector(0, speed), 40, 100 * (6 - i), ParticleGraphics.TELE));
                        gameState.addParticle(new Particle(
                            this.position.copy(), new Vector(0, -speed), 40, 100 * (6 - i), ParticleGraphics.TELE));
                    }
                    break;
                }
            }
            this.firstRun = false;
        }
    }

    /**
     * Spawn a number of particles from a center location
     * @param gameState GameState
     * @param count Number of particles to spawn
     * @param center Center to radiate particles
     * @param maxVelMag Max velocity magnitude of particles, randomized 0 to this
     * @param graphics Particle graphics
     * @param maxSize Max particle size, randomized 0 to this
     * @param maxDuration Max particle duration, randomized 0 to this
     */
    _spawnParticles(gameState: GameState, count: number, center: Vector, maxVelMag: number,
        graphics: ParticleGraphics, maxSize: number, maxDuration: number) {
        const RAND_OFFSET = Math.random() * Math.PI;
        for (let angle = 0; angle < Math.PI * 2; angle += Math.PI * 2 / count)
            gameState.addParticle(new Particle(
                center.copy(), Vector.vecFromRotation(angle + RAND_OFFSET,
                    Math.round(Math.random() * maxVelMag)),
                Math.round(Math.random() * maxSize),
                Math.round(Math.random() * maxDuration), graphics
            ));
    }

    /**
     * Draw a simple circular explosion
     * @param camera camera
     * @param gameState GameState
     * @param multi Radius multiplier (0 - 1)
     * @param radius Radius (static)
     * @param position Center of explosion
     */
    _drawCircularExplosion(camera: Camera, gameState: GameState, multi: number,
        radius: number, position: [number, number]) {
        let color1 = gradient([[[255, 235, 189], 0], [[255, 128, 102], 1]], 1 - multi);
        let color2 = gradient([[[255, 255, 255], 0], [[255, 118, 84], 1]], 1 - multi);
        let color3 = gradient([[[255, 167, 84], 0], [[255, 118, 84], 1]], 1 - multi);

        camera.ctx.globalAlpha = 0.8;
        camera.ctx.shadowColor = color1;
        camera.ctx.shadowBlur = 20;
        camera.ctx.globalCompositeOperation = 'screen';
        camera.fillCircle(position, 2 * multi * radius, color3);
        camera.fillCircle(position, multi * radius, color2);
        camera.ctx.globalCompositeOperation = 'source-over';
        camera.ctx.shadowBlur = 0;
        camera.ctx.globalAlpha = 1;
    }

    /**
    * Draw a simple smoke cloud
    * @param camera camera
    * @param gameState GameState
    * @param multi Radius multiplier (0 - 1)
    * @param radius Radius (static)
    * @param position Center of explosion
    */
    _drawCircularSmokeCloud(camera: Camera, gameState: GameState, multi: number,
        radius: number, position: [number, number]) {
        let color = gradient([[[180, 180, 180], 0], [[40, 40, 40], 1]], 1 - multi);

        camera.ctx.shadowColor = color;
        camera.ctx.globalAlpha = 0.8;
        camera.ctx.shadowBlur = 20;
        camera.ctx.globalCompositeOperation = 'multiply';
        camera.fillCircle(position, 2 * multi * radius, color);
        camera.ctx.globalCompositeOperation = 'source-over';
        camera.ctx.shadowBlur = 0;
        camera.ctx.globalAlpha = 1;
    }

    /**
     * Draw tick
     * @param camera Camera
     * @param gameState GameState
     */
    draw(camera: Camera, gameState: GameState) {
        let multi = (Date.now() - this.createdTimestep) / this.duration;
        multi = 1 - Math.min(1, multi);

        switch (this.graphics) {
            case ExplosionGraphics.SIMPLE: {
                this._drawCircularExplosion(camera, gameState, multi, this.graphicsRadius, this.position.l());
                break;
            }
            case ExplosionGraphics.CLUSTER: {
                // Add explosions in a spiral shape
                const CLUSTER_SIZE = 10;
                let angle = 0;
                let radius = this.graphicsRadius / 2;
                let offsetRadius = 0;

                for (let i = 0; i < CLUSTER_SIZE; i++) {
                    this._drawCircularExplosion(
                        camera, gameState, multi, radius,
                        this.position.add(Vector.vecFromRotation(angle, offsetRadius)).l());
                    angle += Math.PI / 1.2;
                    offsetRadius += this.graphicsRadius / CLUSTER_SIZE;
                    radius *= 0.95;
                }
                break;
            }
            case ExplosionGraphics.CIRCLE: {
                // Add explosions in an expanding ring shape
                const RINGS = 4;
                const RING_OFFSET = 0.2;

                let numPerCluster = 1;
                let radius = this.graphicsRadius / 2;
                let offsetRadius = 0;

                for (let i = 0; i < RINGS; i++) {
                    if (multi - i * RING_OFFSET < 0)
                        break;

                    const OFFSET = Math.random() * Math.PI;

                    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI * 2 / numPerCluster)
                        this._drawCircularExplosion(
                            camera, gameState, (multi - i * RING_OFFSET) / (1 - i * RING_OFFSET), radius,
                            this.position.add(Vector.vecFromRotation(OFFSET + angle, offsetRadius)).l());
                    offsetRadius += this.graphicsRadius / RINGS;
                    radius *= 0.95;
                    numPerCluster *= 2;
                }
                break;
            }
            case ExplosionGraphics.SHOCKWAVE: {
                camera.ctx.globalAlpha = multi * 0.15;
                camera.ctx.lineWidth = 30;
                camera.drawCircle(this.position.l(), (1 - multi) * this.graphicsRadius, 'white');
                camera.ctx.globalAlpha = 1;
                camera.ctx.lineWidth = 1;
                break;
            }
            case ExplosionGraphics.PARTICLES: {
                break;
            }
        }
    }
}
