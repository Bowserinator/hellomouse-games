import { Q } from '../fixed.js';
import { projectiles } from '../projectile/registry.js';

export abstract class FireBehavior {
    abstract readonly kind: number;
    abstract pack(): Array<number>;
    abstract wgsl(): string;
}
export class ProjectileFire extends FireBehavior {
    readonly kind = 0;
    pack() {
        return [0, 0, 0, 0];
    }
    wgsl() {
        return 'return launch_projectile(id, definition);';
    }
}
export class BeamBurstFire extends FireBehavior {
    readonly kind = 1;
    constructor(readonly charge: number, readonly duration: number, readonly arc: number, readonly recharge: number) {
        super();
        if (![charge, duration, arc, recharge].every(n => Number.isInteger(n) && n >= 0) ||
            charge > 10000 || duration < 1 || duration > 512 || arc > 32768 || recharge > 10000)
            throw Error('Invalid beam burst');
    }
    pack() {
        return [this.charge, this.duration, this.arc, this.recharge];
    }
    wgsl() {
        return 'return launch_beam(id, definition);';
    }
}
export class ProximityFuse extends FireBehavior {
    readonly kind = 2;
    pack() {
        return [0, 0, 0, 0];
    }
    wgsl() {
        return 'return launch_mine(id, definition);';
    }
}
export class InterceptFire extends FireBehavior {
    readonly kind = 3;
    constructor(readonly maxIntercepts: number) {
        super();
        if (!Number.isInteger(maxIntercepts) || maxIntercepts < 1 || maxIntercepts > 2048)
            throw Error('Invalid interception count');
    }
    pack() {
        return [this.maxIntercepts, 0, 0, 0];
    }
    wgsl() {
        return 'return false;';
    }
}
export interface WeaponDef {
    name: string;
    fire: FireBehavior;
    minRange: number;
    maxRange: number;
    cooldown: number;
    turnRate: number;
    traverseArc: number;
    projectile: number;
    targetClassMask: number;
    spread: number;
    damageScalePct: number;
}
export const WEAPON_STRIDE = 24;
export const WEAPON = { fire: 0, minRange: 1, maxRange: 2, cooldown: 3, turnRate: 4,
    traverseArc: 5, projectile: 6, targetMask: 7, spread: 8, damageScale: 9, slots: 10, fireParams: 11 } as const;
export const weapons: Array<Readonly<WeaponDef>> = [];
export function defineWeapon(definition: WeaponDef): number {
    if (!definition.name || weapons.some(value => value.name === definition.name) ||
        ![definition.fire.kind, definition.minRange, definition.maxRange, definition.cooldown,
            definition.turnRate, definition.traverseArc, definition.projectile, definition.targetClassMask,
            definition.spread, definition.damageScalePct, ...definition.fire.pack()]
            .every(n => Number.isInteger(n) && n >= 0 && n <= 2147483647) ||
        definition.fire.kind > 255 || definition.minRange > definition.maxRange || definition.maxRange > 256 * Q ||
        definition.cooldown < 1 || definition.cooldown > 10000 || definition.turnRate > 32768 ||
        definition.traverseArc > 65536 || definition.projectile >= projectiles.length ||
        definition.spread > 32768 || definition.damageScalePct > 1000 || definition.fire.pack().length !== 4 ||
        weapons.some(value => value.fire.kind === definition.fire.kind &&
            value.fire.wgsl() !== definition.fire.wgsl())) throw Error('Invalid weapon definition');
    weapons.push(Object.freeze({ ...definition }));
    return weapons.length - 1;
}
export function weaponTable(): Int32Array {
    const words = new Int32Array(weapons.length * WEAPON_STRIDE);
    weapons.forEach((definition, i) => {
        const projectile = projectiles[definition.projectile];
        const lifetime = projectile.ttl + (projectile.effects?.[0]?.pack()[0] ?? 0);
        const slots = definition.fire.kind === 3 ? 1 : Math.ceil(lifetime / definition.cooldown) + 1;
        words.set([definition.fire.kind, definition.minRange, definition.maxRange, definition.cooldown,
            definition.turnRate, definition.traverseArc, definition.projectile, definition.targetClassMask,
            definition.spread, definition.damageScalePct, slots, ...definition.fire.pack()], i * WEAPON_STRIDE);
    });
    return words;
}
export function fireWGSL(): string {
    const behaviors = new Map(weapons.map(definition => [definition.fire.kind, definition.fire]));
    return `fn fire_weapon(id: u32, definition: u32) -> bool {
        switch defs[definition] {
            ${[...behaviors.values()].map(fire => `case ${fire.kind}: { ${fire.wgsl()} }`).join('\n')}
            default: { return false; }
        }
    }`;
}
