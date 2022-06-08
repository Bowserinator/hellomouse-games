import Vector from './vector2d.js';
import GameState from './gamestate.js';
import Camera from '../renderer/camera.js';
import { ParticleGraphics } from '../types.js';

/**
 * On screen particle (client side only)
 * @author Bowserinator
 */
export default class Particle {
    position: Vector;
    velocity: Vector;
    radius: number;
    duration: number;
    graphics: ParticleGraphics;
    createdTimestep: number;
    random: number;

    /**
     * Create a new particle
     * @param {Vector} postion Center of particle
     * @param {Vector} velocity Velocity
     * @param {number} radius Radius to render the particle
     * @param {number} duration Duration of particle
     * @param {ParticleGraphics} graphics What graphics type to display as
     */
    constructor(position: Vector, velocity: Vector, radius: number,
        duration: number, graphics = ParticleGraphics.SIMPLE) {
        this.position = position;
        this.velocity = velocity;
        this.radius = radius;
        this.duration = duration;
        this.graphics = graphics;
        this.random = Math.round(Math.random() * 1000000);
        this.createdTimestep = Date.now();
    }

    update(gameState: GameState, timestep: number) {
        if (Date.now() - this.createdTimestep > this.duration)
            gameState.removeParticle(this);
        this.position = this.position.add(this.velocity.mul(timestep));
    }

    draw(camera: Camera, gameState: GameState) {
        let multi = (Date.now() - this.createdTimestep) / this.duration;
        multi = 1 - Math.min(1, multi);

        switch (this.graphics) {
                case ParticleGraphics.SIMPLE: {
                    camera.fillCircle(this.position.l(), multi * this.radius, '#333');
                    break;
                }
                case ParticleGraphics.SPARKS: {
                    let color = `hsl(${30 + this.random % 30},100%,${50 + this.random % 50}%)`;
                    camera.ctx.globalCompositeOperation = 'lighter';
                    camera.ctx.globalAlpha = multi;
                    camera.fillCircle(this.position.l(), multi * this.radius, color);
                    camera.ctx.globalCompositeOperation = 'source-over';
                    camera.ctx.globalAlpha = 1;
                }
        }
    }
}
