import { TankState } from '../types.js';
import { advance, angDist } from './math/sphere.js';
import type { Rng } from './math/rng.js';
import type { Bullet } from './bullet.js';
import { distance, rotate, scale, tangentBasis, vec } from './math/vec3.js';
import { Tank } from './tank.js';
import { World } from './world/planet.js';
import { MAGNET_ARM_TIME, ROCKET_COUNT, ROCKET_SCATTER_RANGE } from '../vars.js';

export function nearestTarget(tank: Tank, tanks: Array<Tank>, world: World): Tank | undefined {
    const origin = world.position(tank.planet, tank.dir, tank.h), pos = vec();
    let nearest: Tank | undefined, best = Infinity;
    for (const other of tanks) {
        if (other === tank || other.isDead || other.stealth > 0 ||
            other.state === TankState.FLYING || other.state === TankState.FALLING) continue;
        const d = distance(origin, world.position(other.planet, other.dir, other.h, pos));
        if (d < best) {
            best = d;
            nearest = other;
        }
    }
    return nearest;
}

export function magnetTarget(bullet: Bullet, tanks: Array<Tank>): Tank | undefined {
    if (bullet.age < MAGNET_ARM_TIME) return undefined;
    let target: Tank | undefined, best = Infinity;
    for (const tank of tanks) {
        if (tank.isDead || tank.stealth > 0 || tank.planet !== bullet.planet ||
            tank.state === TankState.FLYING || tank.state === TankState.FALLING) continue;
        const d = angDist(tank.dir, bullet.dir);
        if (d < best) {
            best = d;
            target = tank;
        }
    }
    return target;
}

/** Impact points around the nearest target. Without an `rng` only the guaranteed hit on the target is returned */
export function rocketTargets(tank: Tank, tanks: Array<Tank>, world: World, rng?: Rng) {
    const target = nearestTarget(tank, tanks, world);
    if (!target) return [];
    const [axis] = tangentBasis(target.dir), radius = world.desc.planets[target.planet].radius;
    const strikes = [{ planet: target.planet, dir: { ...target.dir } }];
    for (let i = 1; rng && i < ROCKET_COUNT; i++) {
        const dir = { ...target.dir }, heading = vec();
        rotate(heading, axis, dir, rng.range(0, Math.PI * 2));
        scale(heading, heading, rng.range(ROCKET_SCATTER_RANGE[0], ROCKET_SCATTER_RANGE[1]));
        advance(dir, heading, 1, radius);
        strikes.push({ planet: target.planet, dir });
    }
    return strikes;
}

/** Planet a meteor shower falls on: the shooter's own if an enemy is on it, else a random enemy's */
export function meteorPlanet(tank: Tank, tanks: Array<Tank>, rng: Rng): number {
    const enemies = tanks.filter(other => other !== tank && !other.isDead && other.stealth <= 0 &&
        other.state !== TankState.FLYING && other.state !== TankState.FALLING);
    if (!enemies.length || enemies.some(other => other.planet === tank.planet)) return tank.planet;
    return rng.pick(enemies).planet;
}
