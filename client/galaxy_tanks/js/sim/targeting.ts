import { TankState } from '../types.js';
import { advance, angDist } from './math/sphere.js';
import type { Bullet } from './bullet.js';
import { distance, rotate, scale, tangentBasis, vec } from './math/vec3.js';
import { Tank } from './tank.js';
import { World } from './world/planet.js';
import { MAGNET_ARM_TIME } from '../vars.js';

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

export function rocketTargets(tank: Tank, tanks: Array<Tank>, world: World) {
    const target = nearestTarget(tank, tanks, world);
    if (!target) return [];
    const [axis] = tangentBasis(target.dir);
    return [0, 1, 2].map(i => {
        const dir = { ...target.dir }, heading = vec();
        rotate(heading, axis, dir, i * Math.PI * 2 / 3);
        scale(heading, heading, 2.5);
        advance(dir, heading, 1, world.desc.planets[target.planet].radius);
        return { planet: target.planet, dir };
    });
}
