import { BulletType } from '../types.js';
import { BULLET_LIFE, BULLET_SPEED, LANDMINE_HIT_HEIGHT, LANDMINE_MAX_ACTIVE, LANDMINE_RADIUS, MAX_NORMAL_AMMO,
    METEOR_BLAST_RADIUS, ROCKET_BLAST_RADIUS, ROCKET_COUNT, SEISMIC_MAX_ACTIVE, SEISMIC_SPEED,
    SEISMIC_START_RADIUS } from '../vars.js';
import { advance } from './math/sphere.js';
import { V3, copy, scale, vec } from './math/vec3.js';
export interface BulletConfig {
    speed: number; life: number; radius: number; maxAmmo: number;
}
export const BULLETS: Record<BulletType, BulletConfig> = {
    [BulletType.NORMAL]: { speed: BULLET_SPEED, life: BULLET_LIFE, radius: 0.22, maxAmmo: MAX_NORMAL_AMMO },
    [BulletType.FAST]: { speed: 86, life: 3.2, radius: 0.16, maxAmmo: 5 },
    [BulletType.LASER]: { speed: 0, life: 0.16, radius: 0.12, maxAmmo: 3 },
    [BulletType.SMALL]: { speed: 32, life: 0.5 * 2, radius: 0.12, maxAmmo: 25 },
    [BulletType.BOMB]: { speed: 14, life: 1.4 * 3, radius: 0.5, maxAmmo: 2 },
    [BulletType.MAGNET]: { speed: 14, life: 12, radius: 0.55, maxAmmo: 3 },
    [BulletType.ROCKET]: { speed: 0, life: 2, radius: ROCKET_BLAST_RADIUS, maxAmmo: ROCKET_COUNT },
    [BulletType.TELEPORT]: { speed: 0, life: 0, radius: 0, maxAmmo: 3 },
    [BulletType.METEOR]: { speed: 0, life: 2, radius: METEOR_BLAST_RADIUS, maxAmmo: 20 },
    [BulletType.LANDMINE]: { speed: 0, life: Infinity, radius: LANDMINE_RADIUS, maxAmmo: LANDMINE_MAX_ACTIVE },
    [BulletType.SEISMIC]: { speed: 0, life: 0, radius: 0.12, maxAmmo: SEISMIC_MAX_ACTIVE }
};
/** Bullets that drop from the sky onto a marked impact zone */
export const isStrike = (type: BulletType): boolean => type === BulletType.ROCKET || type === BulletType.METEOR;
export class Bullet {
    age = 0;
    dir: V3;
    vel: V3;
    previous = vec();
    constructor(readonly id: number, readonly owner: number, readonly planet: number, dir: V3,
        heading: V3, readonly altitude: number, readonly type: BulletType, readonly color: number) {
        this.dir = { ...dir };
        this.vel = scale(vec(), heading, BULLETS[type].speed);
        copy(this.previous, dir);
    }
    lifetime(radius: number): number {
        if (this.type === BulletType.SEISMIC)
            return (Math.PI * (radius + this.altitude) - SEISMIC_START_RADIUS) / SEISMIC_SPEED;
        const config = BULLETS[this.type];
        const life = this.type === BulletType.NORMAL || this.type === BulletType.FAST
            ? 2 * Math.max(config.life, 2 * Math.PI * (radius + this.altitude) / config.speed + .1) : config.life;
        return this.type === BulletType.NORMAL ? life * .8 : life;
    }
    update(dt: number, radius: number): void {
        this.age += dt;
        copy(this.previous, this.dir);
        advance(this.dir, this.vel, dt, radius + this.altitude);
    }
}
/** Distance along the surface from a shockwave's origin to its leading edge */
export const shockwaveArc = (bullet: Bullet): number => SEISMIC_START_RADIUS + SEISMIC_SPEED * bullet.age;
/** Whether two bullets are at heights where they can touch. Mines are hit anywhere along their height */
export function sharesAltitude(a: Bullet, b: Bullet): boolean {
    const mine = a.type === BulletType.LANDMINE ? a : b.type === BulletType.LANDMINE ? b : undefined;
    if (!mine) return Math.abs(a.altitude - b.altitude) <= 0.5;
    const other = mine === a ? b : a;
    return other.altitude >= mine.altitude - 0.1 && other.altitude <= mine.altitude + LANDMINE_HIT_HEIGHT;
}
/** Height of a falling strike bullet above its impact point */
export function strikeAltitude(bullet: Bullet): number {
    if (bullet.type === BulletType.METEOR) return 40 * (1 - Math.min(1, bullet.age / BULLETS[bullet.type].life) ** 2);
    return 20 * (1 - Math.max(0, Math.min(1, (bullet.age - 1.3) / 0.7)));
}
export interface PowerupItem {
    id: number; planet: number; dir: V3; powerup: number;
}
