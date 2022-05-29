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

    constructor(position: Vector, damageRadius: number, graphicsRadius: number,
        duration: number, graphics = ExplosionGraphics.SIMPLE) {
        this.position = position;
        this.damageRadius = damageRadius;
        this.graphicsRadius = graphicsRadius;
        this.duration = duration;
        this.graphics = graphics;
        this.createdTimestep = Date.now();
    }

    update(gamestate: GameState, timestep: number) {
        if (Date.now() - this.createdTimestep > this.duration)
            gamestate.removeExplosion(this);
    }

    draw(camera: Camera, gamestate: GameState) {
        let multi = (Date.now() - this.createdTimestep) / this.duration;
        multi = 1 - Math.min(1, multi);

        let color1 = gradient([[[255, 235, 189], 0], [[255, 128, 102], 1]], 1 - multi);
        let color2 = gradient([[[255, 255, 255], 0], [[255, 118, 84], 1]], 1 - multi);
        let color3 = gradient([[[255, 167, 84], 0], [[255, 118, 84], 1]], 1 - multi);

        camera.ctx.shadowColor = color1;
        camera.ctx.shadowBlur = 20;
        camera.ctx.globalCompositeOperation = 'screen';
        camera.fillCircle(this.position.l(), 2 * multi * this.graphicsRadius, color3);
        camera.fillCircle(this.position.l(), multi * this.graphicsRadius, color2);
        camera.ctx.globalCompositeOperation = 'source-over';
        camera.ctx.shadowBlur = 0;

        // TODO: smoke n shit
    }
}
