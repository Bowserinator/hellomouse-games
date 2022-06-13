import Camera from '../../renderer/camera.js';
import Tank from '../tank.js';
import GameState from '../gamestate.js';
import { TANK_SIZE } from '../../vars.js';
import { PowerupState } from './powerup.js';
import { Powerup, PowerupCategory } from '../../types.js';

const STEALTH_DURATION = 10000; // How long the stealth lasts
const STEALTH_WARNING = 1000; // Time (ms) before stealth begins to flicker
const STEALTH_RADIUS = TANK_SIZE * 0.72;

interface StealthConfig {
    radius: number;
    thickness?: number;      // Thickness of the ring (default: 10)
    freq?: number;           // (default: 0.002)
    color?: string;          // (default: purple)
    shadowColor?: string;    // Blur (glow) color (default: violet)
    shadowBlur?: number;     // Shadow blur radius (outer edge) (default: 10)
    maxAlpha?: number;       // Max alpha for the pulses (default: 0.02)
}

/**
 * Draw a stealth field at a given location
 * @param {Camera} camera
 * @param {[number, number]} center [x,y] center of the force field
 * @param {StealthConfig} config Other shield config options
 */
export function drawStealth(camera: Camera, center: [number, number], config: StealthConfig) {
    let radius = config.radius;
    let freq = config.freq || 0.002;
    let thickness = config.thickness || 10;

    let color = config.color || 'purple';
    let shadowColor = config.shadowColor || 'violet';
    let shadowBlur = config.shadowBlur === undefined ? 10 : config.shadowBlur;

    let scale = Math.sin((freq * Date.now()) % (Math.PI / 2));
    camera.ctx.shadowColor = shadowColor;
    camera.ctx.shadowBlur = shadowBlur;
    camera.ctx.globalAlpha = Math.min(config.maxAlpha || 0.02, 1 - scale);
    camera.ctx.lineWidth = thickness;
    camera.drawCircle(center, radius * scale, color);

    camera.ctx.globalAlpha = 1;
    camera.ctx.lineWidth = 1;
    camera.ctx.shadowBlur = 0;
}


/** Stealth field around the tank */
export class StealthPowerup extends PowerupState {
    start: number; // Time created

    constructor(tank: Tank) {
        super(tank, Powerup.STEALTH, PowerupCategory.TANK);
        this.start = Date.now();
        this.tank.stealthed = true;
    }

    draw(camera: Camera) {
        drawStealth(camera, this.tank.position.l(), {
            radius: STEALTH_RADIUS
        });
    }

    update(gameState: GameState, timestep: number) {
        let now = Date.now();

        // Duration check
        if (now - this.start > STEALTH_DURATION)
            this.stop();
        else if (now - this.start > STEALTH_DURATION - STEALTH_WARNING)
            // Flicker stealth, flicker rate = 60
            this.tank.stealthed = Math.floor(Date.now() / 60) % 2 === 0;
    }

    stop(isRecursive = false) {
        this.tank.stealthed = false;
        super.stop(isRecursive);
    }
}
