import { Q } from '../fixed.js';

export abstract class Effect {
    abstract readonly kind: number;
    abstract pack(): Array<number>;
    abstract wgsl(): string;
}
export class GasEffect extends Effect {
    readonly kind = 1;
    constructor(readonly ticks: number, readonly damage: number, readonly slowPct: number) {
        super();
        if (![ticks, damage, slowPct].every(n => Number.isInteger(n) && n >= 0) ||
            ticks < 1 || ticks > 10000 || damage > 10000 || slowPct > 100) throw Error('Invalid gas effect');
    }
    pack() {
        return [this.ticks, this.damage, this.slowPct, 0];
    }
    wgsl() {
        return 'gas_damage(shot, definition);';
    }
}
export enum Motion {
    Direct, Arc, Stream, Beam, Plunge
}
export interface ProjectileDef {
    name: string;
    motion: Motion;
    speed: number;
    gravity: number;
    ttl: number;
    damage: number;
    splashRadius: number;
    splashFalloff: number;
    effects?: ReadonlyArray<Effect>;
    launchAngle?: number;
    execute?: boolean;
    altitude?: number;
    startX?: number;
    startZ?: number;
    muzzleFx?: string;
    trailFx?: string;
    impactFx?: string;
    model?: string;
}
export const PROJECTILE_STRIDE = 20;
export const PROJECTILE = { motion: 0, speed: 1, gravity: 2, ttl: 3, damage: 4,
    radius: 5, falloff: 6, effect: 7, effectParams: 8, launchAngle: 12, execute: 13,
    altitude: 14, startX: 15, startZ: 16 } as const;
export const projectiles: Array<Readonly<ProjectileDef>> = [];
export function defineProjectile(definition: ProjectileDef): number {
    if (!definition.name || projectiles.some(value => value.name === definition.name) ||
        ![definition.motion, definition.speed, definition.gravity, definition.ttl, definition.damage,
            definition.splashRadius, definition.splashFalloff, definition.launchAngle ?? 0]
            .every(n => Number.isInteger(n) && n >= 0) ||
        definition.motion > Motion.Plunge || definition.speed > 1024 * Q || definition.gravity > 64 * Q ||
        definition.ttl < 1 || definition.ttl > 512 || definition.damage > 15000 ||
        definition.splashRadius > 256 * Q || definition.splashFalloff > 100 ||
        (definition.launchAngle ?? 0) > 14563 ||
        (definition.launchAngle && (definition.motion !== Motion.Arc || definition.gravity <= 0)) ||
        ![definition.altitude ?? 0, definition.startX ?? 0, definition.startZ ?? 0]
            .every(n => Number.isInteger(n) && Math.abs(n) <= 1024 * Q) ||
        (definition.effects?.length ?? 0) > 1) throw Error('Invalid projectile definition');
    for (const effect of definition.effects ?? []) {
        const values = effect.pack();
        if (!Number.isInteger(effect.kind) || effect.kind < 1 || effect.kind > 255 || values.length !== 4 ||
            values.some(n => !Number.isInteger(n) || n < 0 || n > 2147483647) ||
            projectiles.some(value => value.effects?.some(other =>
                other.kind === effect.kind && other.wgsl() !== effect.wgsl()))) throw Error('Invalid projectile effect');
    }
    projectiles.push(Object.freeze({ ...definition, effects: Object.freeze([...(definition.effects ?? [])]) }));
    return projectiles.length - 1;
}
export function projectileTable(): Int32Array {
    const words = new Int32Array(projectiles.length * PROJECTILE_STRIDE);
    projectiles.forEach((definition, i) => words.set([definition.motion, definition.speed, definition.gravity,
        definition.ttl, definition.damage, definition.splashRadius, definition.splashFalloff,
        definition.effects?.[0]?.kind ?? 0, ...(definition.effects?.[0]?.pack() ?? [0, 0, 0, 0]),
        definition.launchAngle ?? 0, Number(definition.execute ?? false), definition.altitude ?? 0,
        definition.startX ?? 0, definition.startZ ?? 0],
    i * PROJECTILE_STRIDE));
    return words;
}
export function effectsWGSL(): string {
    const effects = new Map(projectiles.flatMap(definition => definition.effects ?? [])
        .map(effect => [effect.kind, effect]));
    return `fn projectile_effect(shot: u32, definition: u32) {
        switch defs[definition + 7u] {
            ${[...effects.values()].map(effect => `case ${effect.kind}: { ${effect.wgsl()} }`).join('\n')}
            default: {}
        }
    }`;
}
