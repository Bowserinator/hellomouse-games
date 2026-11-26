import { Q } from '../fixed.js';
import { BALANCE as B } from '../balance.js';
import { defineProjectile, GasEffect, Motion, projectiles } from '../projectile/registry.js';
import { BeamBurstFire, defineWeapon, ProjectileFire, ProximityFuse, InterceptFire, weapons } from '../weapon/registry.js';

const projectile = { motion: Motion.Direct, gravity: 0, splashRadius: 0, splashFalloff: 0 };
export const WATER_SHOT = defineProjectile({ ...projectile, name: 'Water', motion: Motion.Stream,
    speed: B.water.speed * Q, ttl: B.water.ttl, damage: B.water.damage, splashRadius: B.water.splash * Q,
    muzzleFx: 'water', trailFx: 'water', impactFx: 'water' });
export const BULLET = defineProjectile({ ...projectile, name: 'Bullet', speed: B.machineGun.speed * Q,
    ttl: B.machineGun.ttl, damage: B.machineGun.damage,
    muzzleFx: 'muzzle', trailFx: 'tracer', impactFx: 'bullet' });
export const SHELL = defineProjectile({ ...projectile, name: 'Howitzer shell', motion: Motion.Arc,
    speed: B.howitzer.speed * Q, gravity: B.howitzer.gravity * Q, ttl: B.howitzer.ttl,
    damage: B.howitzer.damage, splashRadius: B.howitzer.splash * Q, splashFalloff: 100,
    launchAngle: Math.round(B.howitzer.launchDegrees * 65536 / 360),
    muzzleFx: 'muzzle', trailFx: 'shell', impactFx: 'explosion' });
export const GAS_SHELL = defineProjectile({ ...projectile, name: 'Gas shell', motion: Motion.Arc,
    speed: B.gas.speed * Q, gravity: B.gas.gravity * Q, ttl: B.gas.ttl, damage: B.gas.damage,
    splashRadius: B.gas.splash * Q, effects: [new GasEffect(B.gas.duration, B.gas.cloudDamage, B.gas.slowPct)],
    muzzleFx: 'muzzle', trailFx: 'gas', impactFx: 'gas' });
export const TANK_SHELL = defineProjectile({ ...projectile, name: 'Tank shell', motion: Motion.Arc,
    speed: B.tank.speed * Q, gravity: B.tank.gravity * Q, ttl: B.tank.ttl, damage: B.tank.damage,
    splashRadius: B.tank.splash * Q, splashFalloff: 100,
    muzzleFx: 'muzzle', trailFx: 'shell', impactFx: 'explosion' });
export const HEAVY_TANK_SHELL = defineProjectile({ ...projectiles[TANK_SHELL], name: 'Heavy tank shell',
    damage: B.heavyTank.damage });
export const BEAM_SHOT = defineProjectile({ ...projectile, name: 'Microwave', motion: Motion.Beam,
    speed: 0, ttl: 1, damage: B.beam.damage, splashRadius: Math.round(B.beam.radius * Q) });
export const MINE_BLAST = defineProjectile({ ...projectile, name: 'Mine blast', speed: 0, ttl: 1,
    damage: B.mine.damage, splashRadius: B.mine.splash * Q, splashFalloff: 100, impactFx: 'explosion' });

const weapon = { fire: new ProjectileFire(), minRange: 0, turnRate: 4096, traverseArc: 65536,
    targetClassMask: 1, spread: 0, damageScalePct: B.stationaryDamagePct };
export const WATER_WEAPON = defineWeapon({ ...weapon, name: 'Water cannon', projectile: WATER_SHOT,
    maxRange: B.water.range * Q, cooldown: B.water.cooldown });
export const TRUCK_WEAPON = defineWeapon({ ...weapons[WATER_WEAPON], name: 'Water truck',
    maxRange: B.water.mobileRange * Q, damageScalePct: 100 });
export const MG_WEAPON = defineWeapon({ ...weapon, name: 'Machine gun', projectile: BULLET,
    maxRange: B.machineGun.range * Q, cooldown: B.machineGun.cooldown });
export const APC_WEAPON = defineWeapon({ ...weapons[MG_WEAPON], name: 'APC',
    maxRange: B.machineGun.mobileRange * Q, damageScalePct: 100 });
export const HOWITZER_WEAPON = defineWeapon({ ...weapon, name: 'Howitzer', projectile: SHELL,
    minRange: B.howitzer.minRange * Q, maxRange: B.howitzer.range * Q, cooldown: B.howitzer.cooldown,
    turnRate: 1024 });
export const GAS_WEAPON = defineWeapon({ ...weapon, name: 'Tear gas', projectile: GAS_SHELL,
    minRange: B.gas.minRange * Q, maxRange: B.gas.range * Q, cooldown: B.gas.cooldown, turnRate: 2048 });
export const TANK_WEAPON = defineWeapon({ ...weapon, name: 'Tank', projectile: TANK_SHELL,
    maxRange: B.tank.range * Q, cooldown: B.tank.cooldown, turnRate: 1024, damageScalePct: 100 });
export const HEAVY_TANK_WEAPON = defineWeapon({ ...weapons[TANK_WEAPON], name: 'Heavy tank',
    projectile: HEAVY_TANK_SHELL, cooldown: B.heavyTank.cooldown });
export const BEAM_WEAPON = defineWeapon({ ...weapon, name: 'Microwave laser', projectile: BEAM_SHOT,
    fire: new BeamBurstFire(B.beam.charge, B.beam.duration, B.beam.arc, B.beam.recharge),
    maxRange: B.beam.range * Q, cooldown: B.beam.cooldown, turnRate: B.beam.turnRate });
export const MINE_WEAPON = defineWeapon({ ...weapon, name: 'Proximity fuse', projectile: MINE_BLAST,
    fire: new ProximityFuse(), maxRange: Math.round(B.mine.trigger * Q), cooldown: 20,
    damageScalePct: 100 });
export const SNIPER_SHOT = defineProjectile({ ...projectile, name: 'Sniper bullet', speed: 300 * Q,
    ttl: 20, damage: 10000, execute: true, muzzleFx: 'muzzle', trailFx: 'tracer', impactFx: 'sniper' });
export const FIREWORK_SHOT = defineProjectile({ ...projectile, name: 'Firework', speed: 40 * Q,
    ttl: 60, damage: B.fireworks.damage, splashRadius: B.tank.splash * Q, splashFalloff: 100,
    trailFx: 'sparkler', impactFx: 'firework' });
export const BOMBER_BLAST = defineProjectile({ ...projectile, name: 'Bomber blast', speed: 0, ttl: 1,
    damage: B.bomber.damage, splashRadius: Math.round(B.mine.splash * B.bomber.blastPct * Q / 100), splashFalloff: 100,
    impactFx: 'explosion' });
export const TOMAHAWK_SHOT = defineProjectile({ ...projectile, name: 'Tomahawk blast', motion: Motion.Plunge,
    speed: 0, ttl: B.tomahawk.flightTicks, damage: B.tomahawk.damage,
    splashRadius: B.tomahawk.radius * Q, splashFalloff: 100, altitude: B.tomahawk.altitude * Q,
    startX: Math.round(B.tomahawk.altitude * Math.tan(B.tomahawk.tilt * Math.PI / 180) *
        Math.sin(B.tomahawk.bearing * Math.PI / 180) * Q),
    startZ: Math.round(B.tomahawk.altitude * Math.tan(B.tomahawk.tilt * Math.PI / 180) *
        Math.cos(B.tomahawk.bearing * Math.PI / 180) * Q), trailFx: 'missile', impactFx: 'tomahawk' });
export const POLICE_SHOT = defineProjectile({ ...projectiles[BULLET], name: 'Police bullet', damage: B.police.damage });
export const GUNSHIP_SHOT = defineProjectile({ ...projectiles[BULLET], name: 'Gunship bullet', damage: B.helicopter.damage });
export const POLICE_WEAPON = defineWeapon({ ...weapon, name: 'Police pistol', projectile: POLICE_SHOT,
    maxRange: B.police.range * Q, cooldown: B.police.cooldown, damageScalePct: 100 });
export const SNIPER_WEAPON = defineWeapon({ ...weapon, name: 'Sniper rifle', projectile: SNIPER_SHOT,
    maxRange: B.sniper.range * Q, cooldown: B.sniper.cooldown, damageScalePct: 100 });
export const GUNSHIP_WEAPON = defineWeapon({ ...weapon, name: 'Gunship machine gun', projectile: GUNSHIP_SHOT,
    maxRange: B.helicopter.range * Q, cooldown: B.helicopter.cooldown, damageScalePct: 100 });
export const CWIS_WEAPON = defineWeapon({ ...weapon, name: 'CWIS interceptor', projectile: BULLET,
    fire: new InterceptFire(B.cwis.maxIntercepts), targetClassMask: 0, damageScalePct: 100,
    maxRange: B.cwis.range * Q, cooldown: B.cwis.cooldown });
