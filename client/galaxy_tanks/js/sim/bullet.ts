import { BulletType } from '../types.js';
import { BULLET_LIFE, BULLET_SPEED, MAX_NORMAL_AMMO, METEOR_BLAST_RADIUS, ROCKET_BLAST_RADIUS } from '../vars.js';
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
    [BulletType.ROCKET]: { speed: 0, life: 2, radius: ROCKET_BLAST_RADIUS, maxAmmo: 3 },
    [BulletType.TELEPORT]: { speed: 0, life: 0, radius: 0, maxAmmo: 3 },
    [BulletType.METEOR]: { speed: 0, life: 2, radius: METEOR_BLAST_RADIUS, maxAmmo: 20 }
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
/** Height of a falling strike bullet above its impact point */
export function strikeAltitude(bullet: Bullet): number {
    if (bullet.type === BulletType.METEOR) return 40 * (1 - Math.min(1, bullet.age / BULLETS[bullet.type].life) ** 2);
    return 20 * (1 - Math.max(0, Math.min(1, (bullet.age - 1.3) / 0.7)));
}
export interface PowerupItem {
    id: number; planet: number; dir: V3; powerup: number;
}
