import Vector from './vector2d.js';
import GameState from './gamestate.js';
import Camera from '../renderer/camera.js';
import { ExplosionGraphics } from '../types.js';
import gradient from '../renderer/gradient.js';

/**
 * On screen explosion
 * @author Bowserinator
 */
export default class Explosion {
    position: Vector;
    damageRadius: number;
    graphicsRadius: number;
    duration: number;
    graphics: ExplosionGraphics;
    createdTimestep: number;

    /**
     * Create a new explosion
     * @param {Vector} postion Center of explosion
     * @param {number} damageRadius Damage radius (counted from center of collider)
     * @param {number} graphicsRadius Radius to render the explosion
     * @param {number} duration Duration of explosin
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
    }

    update(gameState: GameState, timestep: number) {
        if (Date.now() - this.createdTimestep > this.duration)
            gameState.removeExplosion(this);
    }

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
        }
    }
}
