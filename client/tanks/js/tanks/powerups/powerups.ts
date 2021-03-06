import { Powerup } from '../../types.js';
import Tank from '../tank.js';
import Vector2D from '../vector2d.js';
import { BombPowerup, FastBulletPowerup, LaserPowerup, MagnetPowerup, RocketPowerup, ShotgunPowerup, TeleportPowerup } from './bullet-powerups.js';
import { PowerupItem } from './powerup-item.js';
import { ShieldPowerup } from './shield.js';
import { StealthPowerup } from './stealth.js';

export { PowerupState as PowerupSingleton } from './powerup.js';
export { ShieldPowerup } from './shield.js';
export { StealthPowerup } from './stealth.js';
export { FastBulletPowerup, LaserPowerup, ShotgunPowerup, BombPowerup, MagnetPowerup, RocketPowerup, TANK_TURRET_IMAGE_URLS } from './bullet-powerups.js';
export { PowerupItem } from './powerup-item.js';

/**
 * Construct a new powerup obj (not item) (for the tank)
 * @param powerup Powerup type
 * @param tank Tank to give powerup to
 * @returns The powerup obj
 */
export function createPowerupFromType(powerup: Powerup, tank: Tank) {
    switch (powerup) {
        case Powerup.BOMB:
            return new BombPowerup(tank);
        case Powerup.FAST:
            return new FastBulletPowerup(tank);
        case Powerup.LASER:
            return new LaserPowerup(tank);
        case Powerup.MAGNET:
            return new MagnetPowerup(tank);
        case Powerup.ROCKET:
            return new RocketPowerup(tank);
        case Powerup.SHIELD:
            return new ShieldPowerup(tank);
        case Powerup.SHOTGUN:
            return new ShotgunPowerup(tank);
        case Powerup.STEALTH:
            return new StealthPowerup(tank);
        case Powerup.TELEPORT:
            return new TeleportPowerup(tank);
    }
    throw new Error('Unknown powerup type ' + powerup);
}


// Create a powerup item to preload all images
new PowerupItem(new Vector2D(0, 0), Powerup.BOMB);
