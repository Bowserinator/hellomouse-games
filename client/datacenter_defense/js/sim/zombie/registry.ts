export abstract class ZombieAbility {
    abstract readonly kind: number;
    abstract pack(): Array<number>;
    abstract wgsl(): string;
}
export class MeleeAbility extends ZombieAbility {
    readonly kind = 0;
    pack() {
        return [0, 0, 0, 0];
    }
    wgsl() {
        return `let slot = p(P_emits) + id * 4u;
    atomicStore(&extra[slot], 1);
    atomicStore(&extra[slot + 1u], current(F_tgt, id));
    atomicStore(&extra[slot + 2u], target_tag(id));
    atomicStore(&extra[slot + 3u], defs[def + 7u]);
    set_cooldown(id, defs[def + 8u]);`;
    }
}
export class ProjectileAbility extends ZombieAbility {
    readonly kind = 1;
    constructor(readonly projectileDef: number) {
        super();
    }
    pack() {
        return [this.projectileDef, 0, 0, 0];
    }
    wgsl() {
        return `let slot = p(P_emits) + id * 4u;
    atomicStore(&extra[slot], 2);
    atomicStore(&extra[slot + 1u], current(F_tgt, id));
    atomicStore(&extra[slot + 2u], target_tag(id));
    atomicStore(&extra[slot + 3u], defs[def + 9u]);
    set_cooldown(id, defs[def + 8u]);`;
    }
}
export class SuicideAbility extends ZombieAbility {
    readonly kind = 2;
    constructor(readonly projectileDef: number) {
        super();
    }
    pack() {
        return [this.projectileDef, 0, 0, 0];
    }
    wgsl() {
        return `let slot = p(P_emits) + id * 4u;
    atomicStore(&extra[slot], 3);
    atomicStore(&extra[slot + 1u], current(F_tgt, id));
    atomicStore(&extra[slot + 2u], target_tag(id));
    atomicStore(&extra[slot + 3u], defs[def + 9u]);
    atomicAdd(&extra[p(P_damage) + id], defs[def]);
    set_cooldown(id, defs[def + 8u]);`;
    }
}
export interface ZombieDefinition {
    name: string;
    maxHp: number;
    speed: number;
    radius: number;
    height: number;
    locomotionClass: number;
    attackRange: number;
    attackCooldown: number;
    damage: number;
    structureDamagePct: number;
    targetClassMask: number;
    armor: number;
    ability: ZombieAbility;
    spawnWeight?: number;
    preferredRange?: number;
    color?: number;
    flashColor?: number;
    shield?: boolean;
}
export const zombies: Array<Readonly<ZombieDefinition>> = [];
export function defineZombie(definition: ZombieDefinition): Readonly<ZombieDefinition> {
    if (!definition.name || zombies.some(d => d.name === definition.name) || zombies.length >= 256 ||
        ![definition.maxHp, definition.speed, definition.radius, definition.height, definition.locomotionClass,
            definition.attackRange, definition.attackCooldown, definition.damage, definition.structureDamagePct,
            definition.targetClassMask, definition.armor, definition.ability.kind, ...definition.ability.pack(),
            definition.spawnWeight ?? 0, definition.preferredRange ?? 0, definition.color ?? 0,
            definition.flashColor ?? 0]
            .every(n => Number.isInteger(n) && n >= 0 && n <= 2147483647) ||
        definition.maxHp < 1 || definition.attackCooldown > 255 || definition.locomotionClass > 1 ||
        definition.ability.pack().length !== 4) throw Error('Invalid zombie definition');
    if (zombies.some(d => d.ability.kind === definition.ability.kind &&
        d.ability.wgsl() !== definition.ability.wgsl())) throw Error('Conflicting zombie ability kind');
    const value = Object.freeze({ ...definition });
    zombies.push(value);
    return value;
}
export function abilityWGSL(): string {
    const abilities = new Map(zombies.map(d => [d.ability.kind, d.ability]));
    return `fn attack(id: u32, def: u32) {
    switch defs[def + 5u] {
        ${[...abilities.values()].map(ability => `case ${ability.kind}: { ${ability.wgsl()} }`).join('\n')}
        default: {}
    }
}`;
}
