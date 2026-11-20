import { hashWords, Q } from './fixed.js';
import { defineZombie, MeleeAbility, ProjectileAbility, SuicideAbility, zombies } from './zombie/registry.js';

import { BOMBER_BLAST, FIREWORK_SHOT } from './content/weapons.js';
import { BALANCE } from './balance.js';

export enum AttackKind {
    Melee = 0, Projectile = 1
}
export const walker = defineZombie({
    name: 'walker',
    maxHp: 100,
    speed: 6 * Q,
    radius: Math.round(0.35 * Q),
    height: 2 * Q,
    locomotionClass: 0,
    attackRange: Math.round(1.5 * Q),
    damage: 2,
    attackCooldown: 20,
    structureDamagePct: 100,
    targetClassMask: 15,
    armor: 0,
    ability: new MeleeAbility(),
    spawnWeight: 1000 - (BALANCE.fireworks.percent + BALANCE.giant.percent) * 10 - BALANCE.bomber.permille,
    color: 0xd43b3b
});
export const fireworks = defineZombie({
    ...walker, name: 'fireworks', maxHp: BALANCE.fireworks.hp, speed: BALANCE.fireworks.speed * Q,
    attackRange: BALANCE.fireworks.range * Q, damage: BALANCE.fireworks.damage,
    attackCooldown: BALANCE.fireworks.cooldown, ability: new ProjectileAbility(FIREWORK_SHOT),
    spawnWeight: BALANCE.fireworks.percent * 10, preferredRange: BALANCE.fireworks.range * Q * 9 / 10,
    color: 0x9949ce
});
export const giant = defineZombie({
    ...walker,
    name: 'giant',
    maxHp: 400,
    speed: Math.round(walker.speed * 0.95),
    attackRange: 3 * Q,
    spawnWeight: BALANCE.giant.percent * 10,
    color: 0xe8731a,
    shield: true
});
export const bomber = defineZombie({
    ...walker, name: 'bomber', maxHp: BALANCE.bomber.hp, speed: BALANCE.bomber.speed * Q,
    attackRange: BALANCE.bomber.range * Q, ability: new SuicideAbility(BOMBER_BLAST),
    spawnWeight: BALANCE.bomber.permille, color: 0xff2a2a, flashColor: 0x5c0b0b
});
export const VARIANTS = zombies;
export const VARIANT_STRIDE = 20;
export function variantTable(): Int32Array {
    return Int32Array.from(VARIANTS.flatMap(v => {
        const packed = v.ability.pack();
        return [v.maxHp, v.speed, v.radius, v.height, v.locomotionClass, v.ability.kind,
            v.attackRange, v.damage, v.attackCooldown, packed[0], v.structureDamagePct,
            v.targetClassMask, v.armor, packed[1], packed[2], packed[3],
            v.spawnWeight ?? 0, v.preferredRange ?? 0, v.color ?? 0xd43b3b, v.flashColor ?? 0];
    }));
}
export const VARIANT_HASH = hashWords(variantTable());
export const VARIANT_WGSL = `const VARIANT_STRIDE: u32 = ${VARIANT_STRIDE}u;
const ATTACK_MELEE: i32 = ${AttackKind.Melee};`;
