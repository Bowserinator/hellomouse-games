import { Powerup } from '../../types.js';
import Tank from '../tank.js';
import { BombPowerup, FastBulletPowerup, LaserPowerup, MagnetPowerup, RocketPowerup, ShotgunPowerup } from './bullet-powerups.js';
import { ShieldPowerup } from './shield.js';
import { StealthPowerup } from './stealth.js';

export { PowerupState as PowerupSingleton } from './powerup.js';
export { ShieldPowerup } from './shield.js';
export { StealthPowerup } from './stealth.js';
export { FastBulletPowerup, LaserPowerup, ShotgunPowerup, BombPowerup, MagnetPowerup, RocketPowerup, TANK_TURRET_IMAGE_URLS } from './bullet-powerups.js';
export { PowerupItem } from './powerup-item.js';

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
    }
    throw new Error('Unknown powerup type ' + powerup);
}
