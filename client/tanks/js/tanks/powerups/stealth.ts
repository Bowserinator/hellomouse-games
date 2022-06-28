import Camera from '../../renderer/camera.js';
import Tank from '../tank.js';
import GameState from '../gamestate.js';
import { PowerupState } from './powerup.js';
import { Powerup, PowerupCategory } from '../../types.js';
import { playSound, addSoundsToPreload } from '../../sound/sound.js';

addSoundsToPreload(['/tanks/sound/stealth.ogg']);

const STEALTH_DURATION = 10000; // How long the stealth lasts
const STEALTH_WARNING = 1000; // Time (ms) before stealth begins to flicker

/** Stealth field around the tank */
export class StealthPowerup extends PowerupState {
    start: number; // Time created

    constructor(tank: Tank) {
        super(tank, Powerup.STEALTH, PowerupCategory.TANK);
        this.start = Date.now();
        this.tank.stealthed = true;

        playSound('/tanks/sound/stealth.ogg');
    }

    draw(camera: Camera) {
        // Do nothing
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
