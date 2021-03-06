import Camera from '../../renderer/camera.js';
import Renderable from '../../renderer/renderable.js';
import GameState from '../gamestate.js';
import { Powerup, TankSync } from '../../types.js';
import Vector from '../vector2d.js';
import Collider from '../collision.js';
import { POWERUP_ITEM_SIZE } from '../../vars.js';

const POWERUP_ITEM_SIZE_VECTOR = new Vector(POWERUP_ITEM_SIZE, POWERUP_ITEM_SIZE);

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
POWERUP_TEXTURE_MAP[Powerup.TELEPORT] = '/tanks/img/items/teleport.png';

export class PowerupItem extends Renderable {
    powerup: Powerup;
    position: Vector;
    collider: Collider;
    randomID: number;

    constructor(position: Vector, powerup: Powerup) {
        // eslint-disable-next-line @typescript-eslint/no-shadow
        super(Object.values(POWERUP_TEXTURE_MAP).map(powerup => [powerup, POWERUP_ITEM_SIZE_VECTOR]));
        this.position = position;
        this.powerup = powerup;
        this.collider = new Collider(position, POWERUP_ITEM_SIZE_VECTOR);
        this.randomID = Math.round(Math.random() * 100000);
    }

    /**
     * Get sync message for when this item is added
     * @returns A sync message that can be directly broadcast
     */
    toAddedSyncMessage() {
        return {
            type: TankSync.ADD_POWERUP_ITEM,
            position: this.position.l(),
            powerup: this.powerup,
            id: this.randomID
        };
    }

    draw(camera: Camera, gameState: GameState) {
        if (!gameState.isVisible(this.collider))
            return;

        // Draw image
        if (this.images[POWERUP_TEXTURE_MAP[this.powerup]])
            camera.drawImage(this.images[POWERUP_TEXTURE_MAP[this.powerup]], ...this.position.l());
        else
            camera.fillRect(this.position.l(), POWERUP_ITEM_SIZE_VECTOR.l(), 'red');
    }

    update(gameState: GameState, timestep: number) {
        // If collide with tank give powerup
        for (let tank of gameState.tanks)
            if (!tank.isDead && tank.collider.collidesWith(this.collider)) {
                gameState.giveTankPowerup(tank, this.powerup);
                gameState.removePowerupItem(this);
                return;
            }
    }
}
