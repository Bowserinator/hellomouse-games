import { BulletType, TankState } from '../types.js';
import { CHRONO_RADIUS, CHRONO_TIME_SCALE } from '../vars.js';
import type { Bullet } from './bullet.js';
import { angDist } from './math/sphere.js';
import { V3 } from './math/vec3.js';
import { Tank } from './tank.js';
import { World } from './world/planet.js';

/** How fast time runs at a spot, given the chrono fields of every tank except `owner` */
export function timeScaleAt(tanks: Array<Tank>, world: World, planet: number, dir: V3, owner: number): number {
    const radius = world.desc.planets[planet].radius;
    for (const tank of tanks)
        if (tank.id !== owner && tank.chrono > 0 && !tank.isDead && tank.planet === planet &&
            tank.state !== TankState.FLYING && tank.state !== TankState.FALLING &&
            angDist(tank.dir, dir) * radius < CHRONO_RADIUS) return CHRONO_TIME_SCALE;
    return 1;
}

/** Time scale for a bullet. Mines and shockwaves are unaffected */
export function bulletTimeScale(bullet: Bullet, tanks: Array<Tank>, world: World): number {
    if (bullet.type === BulletType.LANDMINE || bullet.type === BulletType.SEISMIC) return 1;
    return timeScaleAt(tanks, world, bullet.planet, bullet.dir, bullet.owner);
}
