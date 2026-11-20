import { Q } from '../fixed.js';
import { BALANCE } from '../balance.js';
import { defineEntity, defaults, entities, MineDef, SonicEmitterDef, StructureDef, TurretDef, UnitDef, StrikeDef } from '../entity/registry.js';
import { APC_WEAPON, BEAM_WEAPON, GAS_WEAPON, HOWITZER_WEAPON, MG_WEAPON, MINE_BLAST,
    MINE_WEAPON, TANK_WEAPON, HEAVY_TANK_WEAPON, TRUCK_WEAPON, WATER_WEAPON,
    POLICE_WEAPON, SNIPER_WEAPON, GUNSHIP_WEAPON, TOMAHAWK_SHOT, CWIS_WEAPON } from './weapons.js';

export const BARRIER = defineEntity(new StructureDef({
    name: 'Barrier', tier: 1, ...defaults(1), maxHp: BALANCE.barrierHp, footprint: { width: 1, depth: 1 }, icon: 'square'
}));
export const WATER_CANNON = defineEntity(new TurretDef({
    name: 'Water cannon', tier: 1, ...defaults(1), maxHp: BALANCE.water.hp, footprint: { width: 2, depth: 2 },
    icon: 'direct', weapons: [{ definition: WATER_WEAPON, x: 0, z: 0 }]
}));
export const MG_NEST = defineEntity(new TurretDef({
    name: 'MG nest', tier: 1, ...defaults(1), maxHp: BALANCE.machineGun.hp, footprint: { width: 2, depth: 2 },
    icon: 'direct', weapons: [{ definition: MG_WEAPON, x: 0, z: 0 }]
}));
export const HOWITZER = defineEntity(new TurretDef({
    name: 'Howitzer', tier: 2, ...defaults(2), maxHp: BALANCE.howitzer.hp, footprint: { width: 2, depth: 2 },
    icon: 'artillery', weapons: [{ definition: HOWITZER_WEAPON, x: 0, z: 0 }]
}));
export const TEAR_GAS = defineEntity(new TurretDef({
    name: 'Tear gas', tier: 2, ...defaults(2), maxHp: BALANCE.gas.hp, footprint: { width: 2, depth: 2 },
    icon: 'artillery', weapons: [{ definition: GAS_WEAPON, x: 0, z: 0 }]
}));
export const MICROWAVE = defineEntity(new TurretDef({
    name: 'Microwave', tier: 3, ...defaults(3), maxHp: BALANCE.beam.hp, footprint: { width: 2, depth: 2 },
    icon: 'beam', weapons: [{ definition: BEAM_WEAPON, x: 0, z: 0 }]
}));
export const WATER_TRUCK = defineEntity(new UnitDef({
    name: 'Water truck', tier: 1, ...defaults(1), maxHp: BALANCE.water.mobileHp, footprint: { width: 2, depth: 2 },
    icon: 'direct', speed: BALANCE.water.moveSpeed * Q, turnRate: 2048,
    weapons: [{ definition: TRUCK_WEAPON, x: 0, z: 0 }]
}));
export const APC = defineEntity(new UnitDef({
    name: 'APC', tier: 1, ...defaults(1), maxHp: BALANCE.machineGun.mobileHp, footprint: { width: 2, depth: 2 },
    icon: 'direct', speed: BALANCE.machineGun.moveSpeed * Q, turnRate: 1536,
    weapons: [{ definition: APC_WEAPON, x: 0, z: 0 }]
}));
export const TANK = defineEntity(new UnitDef({
    name: 'Tank', tier: 2, ...defaults(2), maxHp: BALANCE.tank.hp, footprint: { width: 2, depth: 2 },
    icon: 'armor', speed: BALANCE.tank.moveSpeed * Q, turnRate: BALANCE.tank.turnRate, fireOnMove: true,
    weapons: [{ definition: TANK_WEAPON, x: 0, z: 0 }]
}));
export const SONIC_SMALL = defineEntity(new SonicEmitterDef({
    name: 'Sonic emitter', tier: 2, ...defaults(2), maxHp: BALANCE.sonic.hp, footprint: { width: 3, depth: 3 },
    icon: 'sonic', radius: BALANCE.sonic.radius * Q, power: BALANCE.sonic.power,
    drain: BALANCE.sonic.drain, rechargeTicks: BALANCE.sonic.rechargeTicks, pushSpeed: BALANCE.sonic.pushSpeed * Q
}));
export const SONIC_LARGE = defineEntity(new SonicEmitterDef({
    name: 'Heavy sonic emitter', tier: 3, ...defaults(3), maxHp: BALANCE.sonic.hp * 2, footprint: { width: 3, depth: 3 },
    icon: 'sonic', radius: BALANCE.sonic.radius * 2 * Q, power: BALANCE.sonic.largePower,
    drain: BALANCE.sonic.drain, rechargeTicks: BALANCE.sonic.rechargeTicks,
    pushSpeed: BALANCE.sonic.pushSpeed * Q
}));
export const LANDMINE = defineEntity(new MineDef({
    name: 'Landmine', tier: 1, ...defaults(1), maxHp: BALANCE.mine.hp, footprint: { width: 1, depth: 1 }, icon: 'mine',
    armTicks: BALANCE.mine.armTicks, triggerRadius: Math.round(BALANCE.mine.trigger * Q),
    projectile: MINE_BLAST, weapons: [{ definition: MINE_WEAPON, x: 0, z: 0 }]
}));
export const POLICEMAN = defineEntity(new UnitDef({
    name: 'Police man', tier: 1, ...defaults(1), maxHp: BALANCE.police.hp, footprint: { width: 1, depth: 1 },
    icon: 'direct', speed: BALANCE.police.speed * Q, turnRate: 4096, fireOnMove: true,
    weapons: [{ definition: POLICE_WEAPON, x: 0, z: 0 }]
}));
export const SNIPER = defineEntity(new UnitDef({
    name: 'Sniper', tier: 3, ...defaults(3), maxHp: BALANCE.sniper.hp, footprint: { width: 1, depth: 1 },
    icon: 'direct', speed: BALANCE.sniper.speed * Q, turnRate: 4096,
    weapons: [{ definition: SNIPER_WEAPON, x: 0, z: 0 }]
}));
export const HELI_GUNSHIP = defineEntity(new UnitDef({
    name: 'Heli gunship', tier: 2, ...defaults(2), maxHp: BALANCE.helicopter.hp, footprint: { width: 2, depth: 3 },
    icon: 'direct', speed: BALANCE.helicopter.speed * Q, turnRate: 2048, fireOnMove: true,
    flightHeight: BALANCE.helicopter.height * Q, weapons: [{ definition: GUNSHIP_WEAPON, x: 0, z: 0 }]
}));
export const STEAMROLLER = defineEntity(new UnitDef({
    name: 'Steamroller', tier: 2, ...defaults(2), maxHp: BALANCE.steamroller.hp, footprint: { width: 2, depth: 3 },
    icon: 'armor', speed: BALANCE.steamroller.speed * Q, turnRate: 1024, fireOnMove: true,
    runoverDamage: BALANCE.steamroller.damage, mass: BALANCE.steamroller.mass
}));
export const TOMAHAWK = defineEntity(new StrikeDef({
    name: 'Tomahawk missile', tier: 3, ...defaults(3), maxHp: 1, footprint: { width: 1, depth: 1 },
    icon: 'artillery', projectile: TOMAHAWK_SHOT
}));
export const CWIS = defineEntity(new TurretDef({
    name: 'CWIS', tier: 2, ...defaults(2), maxHp: BALANCE.cwis.hp, footprint: { width: 2, depth: 2 },
    icon: 'direct', weapons: [{ definition: CWIS_WEAPON, x: 0, z: 0 }]
}));
export const HEAVY_TANK = defineEntity(new UnitDef({
    ...entities[TANK].options, name: 'Heavy tank', tier: 3, ...defaults(3), maxHp: BALANCE.heavyTank.hp,
    weapons: [{ definition: HEAVY_TANK_WEAPON, x: 0, z: 0 }]
}));

export const CRANE_T1 = defineEntity(new StructureDef({
    name: 'Crane T1', tier: 1, ...defaults(1), maxHp: BALANCE.construction.hp[0], footprint: { width: 2, depth: 2 },
    icon: 'square', buildPower: BALANCE.construction.power[0], buildRadius: BALANCE.construction.crane[0]
}));
export const CRANE_T2 = defineEntity(new StructureDef({
    name: 'Crane T2', tier: 2, ...defaults(2), maxHp: BALANCE.construction.hp[1], footprint: { width: 3, depth: 3 },
    icon: 'square', buildPower: BALANCE.construction.power[1], buildRadius: BALANCE.construction.crane[1]
}));
export const CRANE_T3 = defineEntity(new StructureDef({
    name: 'Crane T3', tier: 3, ...defaults(3), maxHp: BALANCE.construction.hp[2], footprint: { width: 4, depth: 4 },
    icon: 'square', buildPower: BALANCE.construction.power[2], buildRadius: BALANCE.construction.crane[2]
}));

export const MONEY_STORAGE = defineEntity(new StructureDef({
    name: 'Money storage', tier: 1, ...defaults(1), maxHp: 300, footprint: { width: 2, depth: 2 },
    icon: 'square', storage: { money: 800 }
}));
export const POWER_STORAGE = defineEntity(new StructureDef({
    name: 'Power storage', tier: 1, ...defaults(1), maxHp: 300, footprint: { width: 2, depth: 2 },
    icon: 'square', storage: { power: 8000 }
}));
export const STORE_T1 = defineEntity(new StructureDef({
    name: 'Store T1', tier: 1, ...defaults(1), maxHp: 200, footprint: { width: 2, depth: 2 },
    icon: 'square', income: { money: 1 }
}));
export const STORE_T2 = defineEntity(new StructureDef({
    name: 'Store T2', tier: 2, ...defaults(2), maxHp: 600, footprint: { width: 3, depth: 3 },
    icon: 'square', income: { money: 4 }
}));
export const STORE_T3 = defineEntity(new StructureDef({
    name: 'Store T3', tier: 3, ...defaults(3), maxHp: 1500, footprint: { width: 4, depth: 4 },
    icon: 'square', income: { money: 7 }
}));
export const GENERATOR_T1 = defineEntity(new StructureDef({
    name: 'Generator T1', tier: 1, ...defaults(1), maxHp: 300, footprint: { width: 2, depth: 2 },
    icon: 'square', income: { power: 20 }
}));
export const GENERATOR_T2 = defineEntity(new StructureDef({
    name: 'Generator T2', tier: 2, ...defaults(2), maxHp: 1000, footprint: { width: 4, depth: 4 },
    icon: 'square', income: { power: 500 }
}));
export const GENERATOR_T3 = defineEntity(new StructureDef({
    name: 'Generator T3', tier: 3, ...defaults(3), maxHp: 3000, footprint: { width: 6, depth: 6 },
    icon: 'square', income: { power: 2000 }
}));
export const BUILD_ORDER = [CRANE_T1, CRANE_T2, CRANE_T3, STORE_T1, STORE_T2, STORE_T3,
    GENERATOR_T1, GENERATOR_T2, GENERATOR_T3, MONEY_STORAGE, POWER_STORAGE,
    POLICEMAN, WATER_TRUCK, APC, WATER_CANNON, MG_NEST, BARRIER, LANDMINE,
    TEAR_GAS, TANK, STEAMROLLER, HOWITZER, CWIS, SONIC_SMALL, HELI_GUNSHIP,
    HEAVY_TANK, SNIPER, MICROWAVE, SONIC_LARGE, TOMAHAWK];
