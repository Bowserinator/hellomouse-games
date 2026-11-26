import { Q, TICK_HZ } from '../fixed.js';

export const UNIT_STRIDE = 48;
export const UNIT = {
    kind: 0, tier: 1, hp: 2, width: 3, depth: 4, speed: 6, turnRate: 7,
    locomotion: 8, weaponCount: 9, weapons: 10, mountX: 14, mountZ: 18, stationary: 22,
    sonicRadius: 23, power: 24, drain: 25, recharge: 26, blocks: 27, armTicks: 28,
    triggerRadius: 29, projectile: 30, pushSpeed: 31, fireOnMove: 32, flightHeight: 33,
    runoverDamage: 34, mass: 35, buildRadius: 36, moneyCost: 37, powerCost: 38, buildTicks: 39, buildPower: 40,
    moneyIncome: 41, powerIncome: 42, moneyStorage: 43, powerStorage: 44, energyDrain: 45, drainWhenFiring: 46
} as const;
export type IconShape = 'square' | 'direct' | 'artillery' | 'armor' | 'beam' | 'sonic' | 'mine';
export interface EntityOptions {
    name: string;
    tier: number;
    maxHp: number;
    footprint: { width: number; depth: number };
    icon: IconShape;
    weapons?: ReadonlyArray<{ definition: number; x: number; z: number }>;
    speed?: number;
    turnRate?: number;
    fireOnMove?: boolean;
    flightHeight?: number;
    runoverDamage?: number;
    mass?: number;
    radius?: number;
    buildRadius?: number;
    pushSpeed?: number;
    power?: number;
    drain?: number;
    rechargeTicks?: number;
    armTicks?: number;
    triggerRadius?: number;
    projectile?: number;
    cost: { money: number; power: number };
    buildSeconds: number;
    buildPower?: number;
    income?: { money?: number; power?: number };
    storage?: { money?: number; power?: number };
    energyDrain?: { perSecond: number; whenFiring?: boolean };
    requirements?: ReadonlyArray<string>;
}
export abstract class EntityDef {
    abstract readonly kind: number;
    readonly name: string;
    readonly tier: number;
    readonly maxHp: number;
    readonly footprint: Readonly<{ width: number; depth: number }>;
    readonly icon: Readonly<{ shape: IconShape; tier: number }>;
    readonly weapons: ReadonlyArray<Readonly<{ definition: number; x: number; z: number }>>;
    constructor(readonly options: Readonly<EntityOptions>) {
        this.name = options.name; this.tier = options.tier; this.maxHp = options.maxHp;
        this.footprint = Object.freeze({ ...options.footprint });
        this.icon = Object.freeze({ shape: options.icon, tier: options.tier });
        this.weapons = Object.freeze((options.weapons ?? []).map(weapon => Object.freeze({ ...weapon })));
    }
    pack(): Int32Array {
        const o = this.options, row = new Int32Array(UNIT_STRIDE);
        row[UNIT.kind] = this.kind; row[UNIT.tier] = this.tier; row[UNIT.hp] = this.maxHp;
        row[UNIT.width] = this.footprint.width; row[UNIT.depth] = this.footprint.depth;
        row[UNIT.speed] = o.speed ?? 0; row[UNIT.turnRate] = o.turnRate ?? 1024;
        row[UNIT.locomotion] = this.kind === 2 ? 1 : 0; row[UNIT.weaponCount] = this.weapons.length;
        this.weapons.forEach((weapon, i) => {
            row[UNIT.weapons + i] = weapon.definition;
            row[UNIT.mountX + i] = weapon.x; row[UNIT.mountZ + i] = weapon.z;
        });
        row[UNIT.stationary] = Number(this.kind !== 2); row[UNIT.sonicRadius] = o.radius ?? 0;
        row[UNIT.power] = o.power ?? 0; row[UNIT.drain] = o.drain ?? 0;
        row[UNIT.recharge] = o.rechargeTicks ?? 0; row[UNIT.blocks] = Number(this.kind !== 5);
        row[UNIT.armTicks] = o.armTicks ?? 0; row[UNIT.triggerRadius] = o.triggerRadius ?? 0;
        row[UNIT.projectile] = o.projectile ?? -1;
        row[UNIT.pushSpeed] = o.pushSpeed ?? 0;
        row[UNIT.fireOnMove] = Number(o.fireOnMove ?? false);
        row[UNIT.flightHeight] = o.flightHeight ?? 0; row[UNIT.runoverDamage] = o.runoverDamage ?? 0;
        row[UNIT.mass] = o.mass ?? 2;
        row[UNIT.buildRadius] = o.buildRadius ?? 0;
        row[UNIT.moneyCost] = o.cost.money * 100; row[UNIT.powerCost] = o.cost.power * 100;
        row[UNIT.buildTicks] = Math.max(1, o.buildSeconds * 20);
        row[UNIT.buildPower] = o.buildPower ?? 0;
        row[UNIT.moneyIncome] = (o.income?.money ?? 0) * 5;
        row[UNIT.powerIncome] = (o.income?.power ?? 0) * 5;
        row[UNIT.moneyStorage] = (o.storage?.money ?? 0) * 100;
        row[UNIT.powerStorage] = (o.storage?.power ?? 0) * 100;
        row[UNIT.energyDrain] = (o.energyDrain?.perSecond ?? 0) * 100 / TICK_HZ;
        row[UNIT.drainWhenFiring] = Number(o.energyDrain?.whenFiring ?? false);
        if (o.flightHeight || this.kind === 6) row[UNIT.blocks] = 0;
        return row;
    }
}
export class StructureDef extends EntityDef {
    readonly kind: number = 1;
}
export class UnitDef extends EntityDef {
    readonly kind = 2;
}
export class TurretDef extends StructureDef {
    readonly kind: number = 3;
}
export class SonicEmitterDef extends StructureDef {
    readonly kind = 4;
}
export class MineDef extends StructureDef {
    readonly kind = 5;
}
export class StrikeDef extends EntityDef {
    readonly kind = 6;
}
export function defaults(tier: number): Pick<EntityOptions, 'cost' | 'buildSeconds'> {
    return { cost: { money: [25, 100, 400][tier - 1], power: [100, 800, 4000][tier - 1] },
        buildSeconds: [10, 30, 90][tier - 1] };
}
export const entities: Array<EntityDef> = [];

export function defineEntity(definition: EntityDef): number {
    const { width, depth } = definition.footprint, o = definition.options;
    if (!o.cost || ![o.cost.money, o.cost.power, o.buildSeconds, o.buildPower ?? 0,
        o.income?.money ?? 0, o.income?.power ?? 0, o.storage?.money ?? 0,
        o.storage?.power ?? 0, o.energyDrain?.perSecond ?? 0]
        .every(n => Number.isInteger(n) && n >= 0) ||
        o.cost.money > 100000 || o.cost.power > 100000 || o.buildSeconds > 7200 ||
        (o.buildPower ?? 0) > 96 || (o.income?.money ?? 0) > 2000 || (o.income?.power ?? 0) > 2000 ||
        (o.storage?.money ?? 0) > 8000 || (o.storage?.power ?? 0) > 8000 || (o.energyDrain?.perSecond ?? 0) > 100000)
        throw Error('Invalid economy definition');
    if (!definition.name || entities.some(entity => entity.name === definition.name) ||
        ![definition.tier, definition.maxHp, width, depth, o.speed ?? 0, o.turnRate ?? 1024,
            o.radius ?? 0, o.power ?? 0, o.drain ?? 0, o.rechargeTicks ?? 0, o.armTicks ?? 0,
            o.triggerRadius ?? 0, o.pushSpeed ?? 0, o.flightHeight ?? 0, o.runoverDamage ?? 0,
            o.mass ?? 2, o.buildRadius ?? 0]
            .every(n => Number.isInteger(n) && n >= 0 && n <= 2147483647) ||
        definition.tier < 1 || definition.tier > 3 || definition.maxHp < 1 ||
        width < 1 || width > 6 || depth < 1 || depth > 6 || definition.weapons.length > 4 ||
        (o.speed ?? 0) > 32 * Q || (o.turnRate ?? 1024) > 32768 ||
        (o.flightHeight ?? 0) > 64 * Q || (o.runoverDamage ?? 0) > 10000 || (o.mass ?? 2) < 1 || (o.mass ?? 2) > 100 ||
        (o.buildRadius ?? 0) > 20000 ||
        (o.radius ?? 0) > 256 * Q || (o.pushSpeed ?? 0) > 32 * Q ||
        (o.power ?? 0) > 1000000 || (o.drain ?? 0) > 1000 || (o.rechargeTicks ?? 0) > 10000 ||
        definition.weapons.some(weapon => !Number.isInteger(weapon.definition) || weapon.definition < 0 ||
            !Number.isInteger(weapon.x) || !Number.isInteger(weapon.z))) throw Error('Invalid entity definition');
    entities.push(Object.freeze(definition));
    return entities.length - 1;
}
