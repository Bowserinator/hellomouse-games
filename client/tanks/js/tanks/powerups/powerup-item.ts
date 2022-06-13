import Camera from '../../renderer/camera.js';
import Renderable from '../../renderer/renderable.js';
import GameState from '../gamestate.js';
import { Powerup } from '../../types.js';
import Vector from '../vector2d.js';
import Collider from '../collision.js';
import { createPowerupFromType } from './powerups.js';

const POWERUP_ITEM_SIZE = new Vector(36, 36); // Move to global config?

// @ts-expect-error TS is stupid
const POWERUP_TEXTURE_MAP: Record<Powerup, string> = {};
POWERUP_TEXTURE_MAP[Powerup.LASER] = '/tanks/img/items/laser.png';
POWERUP_TEXTURE_MAP[Powerup.SHOTGUN] = '/tanks/img/items/shotgun.png';
POWERUP_TEXTURE_MAP[Powerup.BOMB] = '/tanks/img/items/bomb.png';
POWERUP_TEXTURE_MAP[Powerup.MAGNET] = '/tanks/img/items/magnet.png';
POWERUP_TEXTURE_MAP[Powerup.FAST] = '/tanks/img/items/fast.png';
POWERUP_TEXTURE_MAP[Powerup.ROCKET] = '/tanks/img/items/rocket.png';
POWERUP_TEXTURE_MAP[Powerup.SHIELD] = '/tanks/img/items/shield.png';
POWERUP_TEXTURE_MAP[Powerup.STEALTH] = '/tanks/img/items/stealth.png';

export class PowerupItem extends Renderable {
    powerup: Powerup;
    position: Vector;
    collider: Collider;
    randomID: number;

    constructor(position: Vector, powerup: Powerup) {
        // eslint-disable-next-line @typescript-eslint/no-shadow
        super(Object.values(POWERUP_TEXTURE_MAP).map(powerup => [powerup, POWERUP_ITEM_SIZE]));
        this.position = position;
        this.powerup = powerup;
        this.collider = new Collider(position, POWERUP_ITEM_SIZE);
        this.randomID = Math.round(Math.random() * 100000);
    }

    draw(camera: Camera, gameState: GameState) {
        // Draw image
        if (this.images[POWERUP_TEXTURE_MAP[this.powerup]])
            camera.drawImage(this.images[POWERUP_TEXTURE_MAP[this.powerup]], ...this.position.l());
        else
            camera.fillRect(this.position.l(), POWERUP_ITEM_SIZE.l(), 'red');
    }

    update(gameState: GameState, timestep: number) {
        // If collide with tank give powerup
        for (let tank of gameState.tanks)
            if (tank.collider.collidesWith(this.collider)) {
                gameState.giveTankPowerup(tank, this.powerup);
                gameState.removePowerupItem(this);
                return;
            }
    }
}
