import { BulletType, Powerup, PowerupCategory } from '../types.js';
import { CHRONO_DURATION, CROSS_FIRE_SHOTS, LANDMINE_COUNT, STEALTH_DURATION } from '../vars.js';
import { Tank } from './tank.js';
export interface PowerupDef {
    category: PowerupCategory; bullet: BulletType; ammo: number; duration: number; icon: string;
}
const gun = (bullet: BulletType, ammo: number, icon: string): PowerupDef =>
    ({ category: PowerupCategory.BULLET, bullet, ammo, duration: 0, icon });
export const POWERUPS: Record<Powerup, PowerupDef> = {
    [Powerup.NONE]: gun(BulletType.NORMAL, 5, ''),
    [Powerup.FAST]: gun(BulletType.FAST, 1, 'fast'),
    [Powerup.LASER]: gun(BulletType.LASER, 1, 'laser'),
    [Powerup.SHOTGUN]: gun(BulletType.SMALL, 1, 'shotgun'),
    [Powerup.BOMB]: gun(BulletType.BOMB, 1, 'bomb'),
    [Powerup.MAGNET]: gun(BulletType.MAGNET, 1, 'magnet'),
    [Powerup.ROCKET]: gun(BulletType.ROCKET, 1, 'rocket'),
    [Powerup.TELEPORT]: gun(BulletType.TELEPORT, 1, 'teleport'),
    [Powerup.METEOR_RAIN]: gun(BulletType.METEOR, 1, 'meteor_rain'),
    [Powerup.CROSS_FIRE]: gun(BulletType.NORMAL, CROSS_FIRE_SHOTS, '360'),
    [Powerup.LANDMINE]: gun(BulletType.LANDMINE, LANDMINE_COUNT, 'landmine'),
    [Powerup.SEISMIC_SHOCKWAVE]: gun(BulletType.SEISMIC, 1, 'seismic_shockwave'),
    [Powerup.SHIELD]: { category: PowerupCategory.TANK, bullet: BulletType.NORMAL, ammo: 0, duration: 6, icon: 'shield' },
    [Powerup.STEALTH]: { category: PowerupCategory.TANK, bullet: BulletType.NORMAL, ammo: 0,
        duration: STEALTH_DURATION, icon: 'stealth' },
    [Powerup.CHRONO_DAMPENER]: { category: PowerupCategory.TANK, bullet: BulletType.NORMAL, ammo: 0,
        duration: CHRONO_DURATION, icon: 'chrono_dampener' }
};
/** Powerups that can appear as pickups on the map */
export const SPAWNABLE_POWERUPS = (Object.keys(POWERUPS).map(Number) as Array<Powerup>)
    .filter(p => p !== Powerup.NONE && p !== Powerup.TELEPORT);
/** Directions, relative to the aim, that a cross fire shot is released in */
export const CROSS_FIRE_ANGLES = [0, 1, 2, 3].map(i => i * Math.PI / 2);
export function givePowerup(tank: Tank, powerup: Powerup): void {
    if (POWERUPS[powerup].category === PowerupCategory.BULLET) {
        tank.bulletPowerup = powerup;
        tank.ammo = POWERUPS[powerup].ammo;
    } else {
        tank.shield = powerup === Powerup.SHIELD ? POWERUPS[powerup].duration : 0;
        tank.stealth = powerup === Powerup.STEALTH ? POWERUPS[powerup].duration : 0;
        tank.chrono = powerup === Powerup.CHRONO_DAMPENER ? POWERUPS[powerup].duration : 0;
    }
}
