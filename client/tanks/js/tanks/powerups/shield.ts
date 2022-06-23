import Camera from '../../renderer/camera.js';
import Tank from '../tank.js';
import GameState from '../gamestate.js';
import { TANK_SIZE } from '../../vars.js';
import { PowerupState } from './powerup.js';
import { Powerup, PowerupCategory } from '../../types.js';
import { playSound, addSoundsToPreload } from '../../sound/sound.js';

addSoundsToPreload(['/tanks/sound/shield.ogg']);

const SHIELD_DURATION = 6000; // How long the shield lasts
const SHIELD_WARNING = 1000; // Time (ms) before shield goes down to flicker
const HIT_FLICKER_TIME = 60;

export const SHIELD_RADIUS = TANK_SIZE * 0.72;

interface ShieldConfig {
    radius: number;
    offsets?: Array<number>; // Phase offsets, all should be < PI/2 (default: [0, Math.PI / 5])
    freq?: number;           // (default: 0.0002 (slow))
    color?: string;          // (default: '#529cff')
    shadowColor?: string;    // Blur (glow) color (default: blue)
    shadowBlur?: number;     // Shadow blur radius (outer edge) (default: 10)
    maxAlpha?: number;       // Max alpha for the pulses (default: 0.6)
    flicker?: boolean;
    flickerRate?: number;    // in ms (half a period) (default: 60ms)
}

/**
 * Draw a energy shield at a given location
 * @param {Camera} camera
 * @param {[number, number]} center [x,y] center of the force field
 * @param {ShieldConfig} config Other shield config options
 */
export function drawShield(camera: Camera, center: [number, number], config: ShieldConfig) {
    if (config.flicker && Math.floor(Date.now() / (config.flickerRate || 60)) % 2 === 0)
        return;

    let offsets = config.offsets || [0, Math.PI / 5];
    let shieldRadius = config.radius;
    let shieldFreq = config.freq || 0.0002;

    let color = config.color || '#529cff';
    let shadowColor = config.shadowColor || 'blue';
    let shadowBlur = config.shadowBlur === undefined ? 10 : config.shadowBlur;

    for (let offset of offsets) {
        // This function scales from y=0 to 1 along x = 0 to pi/2, slowing down as
        // the value approaches y=1
        let scale = Math.sin((shieldFreq * Date.now() + offset) % (Math.PI / 2));
        camera.ctx.globalAlpha = Math.min(config.maxAlpha || 0.6, 1 - scale);
        camera.fillCircle(center, shieldRadius * scale, color);
    }

    camera.ctx.globalAlpha = 1;
    camera.ctx.shadowColor = shadowColor;
    camera.ctx.shadowBlur = shadowBlur;
    camera.drawCircle(center, shieldRadius, color);
    camera.ctx.shadowBlur = 0;
}

/** Force field around the tank */
export class ShieldPowerup extends PowerupState {
    start: number; // Time created
    flicker: boolean; // Is shield flickering?
    lastHitTime: number; // Time last projectile hit

    constructor(tank: Tank) {
        super(tank, Powerup.SHIELD, PowerupCategory.TANK);
        this.start = Date.now();
        this.flicker = false;
        this.lastHitTime = 0;
        this.tank.invincible = true;

        playSound('/tanks/sound/shield.ogg');
    }

    draw(camera: Camera) {
        drawShield(camera, this.tank.position.l(), {
            radius: SHIELD_RADIUS,
            flicker: this.flicker,
            color: Date.now() - this.lastHitTime < HIT_FLICKER_TIME ? '#b3d3ff' : '#529cff'
        });
    }

    update(gameState: GameState, timestep: number) {
        let now = Date.now();

        // Deflect bullets is done in collision
        // Duration check
        if (now - this.start > SHIELD_DURATION)
            this.stop();
        else if (now - this.start > SHIELD_DURATION - SHIELD_WARNING)
            this.flicker = true;
    }

    stop(isRecursive = false) {
        this.tank.invincible = false;
        super.stop(isRecursive);
    }
}
