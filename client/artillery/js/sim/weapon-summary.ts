import { DamageProfile } from './damage.js';
import { WeaponAction, WeaponDataFiles, WeaponDefinition } from './weapon-types.js';

function profileDamage(profile: DamageProfile | undefined): number {
    if (!profile) return 0;
    const burn = profile.damageOverTime ? profile.damageOverTime.amountPerSecond * profile.damageOverTime.durationSeconds : 0;
    return Math.max(profile.directHitDamage ?? 0, profile.splashDamage ?? 0, burn);
}

interface Damage {
    total: number;
    perHit: number;
}

/** Weapons that fire more projectiles than this just list the damage of one. */
const maximumListedHits = 10;

const none: Damage = { total: 0, perHit: 0 };

function sum(parts: ReadonlyArray<Damage>): Damage {
    return { total: parts.reduce((total, part) => total + part.total, 0),
        perHit: Math.max(0, ...parts.map(part => part.perHit)) };
}

function strongest(parts: ReadonlyArray<Damage>): Damage {
    return parts.reduce((best, part) => part.total > best.total ? part : best, none);
}

function scale(damage: Damage, count: number): Damage {
    return { total: damage.total * count, perHit: damage.perHit };
}

/** Damage a tank takes if everything the weapon fires lands on it once. */
function weaponDamage(weapon: WeaponDefinition, data: WeaponDataFiles): Damage {
    const active = new Set<string>();
    const projectileDamage = (identifier: string): Damage => {
        const definition = weapon.projectiles[identifier];
        if (!definition || active.has(identifier)) return none;
        active.add(identifier);
        const result = strongest(Object.values(definition).map(visit));
        active.delete(identifier);
        return result;
    };
    const visit = (value: unknown): Damage => {
        if (!value || typeof value !== 'object') return none;
        if (Array.isArray(value)) return sum(value.map(visit));
        const record = value as Record<string, unknown>;
        if (typeof record.action !== 'string')
            return strongest(Object.values(record).map(visit));
        const action = record as unknown as WeaponAction;
        const hit = (identifier: string | undefined): Damage => {
            const damage = identifier ? profileDamage(data.damageProfiles[identifier]) : 0;
            return { total: damage, perHit: damage };
        };
        const own = 'damageProfileIdentifier' in action ? hit(action.damageProfileIdentifier) : none;
        if (action.action === 'launchProjectile') return projectileDamage(action.projectileIdentifier);
        if (action.action === 'spawnProjectiles')
            return scale(projectileDamage(action.projectileIdentifier), action.count);
        if (action.action === 'repeat') return scale(visit(action.actions), action.count);
        if (action.action === 'schedule') return visit(action.actions);
        if (action.action === 'deployEntity')
            return sum([own, hit(action.definition.damageProfileIdentifier),
                strongest(Object.values(action.definition).map(visit))]);
        return own;
    };
    return visit(weapon.onFire);
}

const sumOf = (values: ReadonlyArray<number>): number => values.reduce((total, value) => total + value, 0);

/** Total mass of all fired payloads whose mass class is not exactly one. */
function weaponPayloadMass(weapon: WeaponDefinition): number {
    const active = new Set<string>();
    const projectileMass = (identifier: string): number => {
        const definition = weapon.projectiles[identifier];
        if (!definition || active.has(identifier)) return 0;
        active.add(identifier);
        const mass = definition.massClass ?? weapon.massClass;
        const own = mass !== null && mass !== 1 ? mass : 0;
        const nested = sumOf(Object.values(definition).map(visit));
        active.delete(identifier);
        return own + nested;
    };
    const visit = (value: unknown): number => {
        if (!value || typeof value !== 'object') return 0;
        if (Array.isArray(value)) return sumOf(value.map(visit));
        const record = value as Record<string, unknown>;
        if (typeof record.action !== 'string') return sumOf(Object.values(record).map(visit));
        const action = record as unknown as WeaponAction;
        if (action.action === 'launchProjectile') return projectileMass(action.projectileIdentifier);
        if (action.action === 'spawnProjectiles') return projectileMass(action.projectileIdentifier) * action.count;
        if (action.action === 'repeat') return visit(action.actions) * action.count;
        if (action.action === 'schedule') return visit(action.actions);
        if (action.action === 'deployEntity') return sumOf(Object.values(action.definition).map(visit));
        return 0;
    };
    return visit(weapon.onFire);
}

/** The most damage a single hit from the weapon can do to a tank. */
export function weaponTankDamage(weapon: WeaponDefinition, data: WeaponDataFiles): number {
    return weaponDamage(weapon, data).perHit;
}

export function describeWeapon(weapon: WeaponDefinition, data: WeaponDataFiles): string {
    const { total, perHit } = weaponDamage(weapon, data);
    const round = (value: number): string | number => value === 0 ? 'No' : Math.round(value * 100) / 100;
    const hits = perHit > 0 ? Math.round(total / perHit) : 1;
    const isUniform = hits > 1 && hits <= maximumListedHits && Math.abs(hits * perHit - total) < 1e-6;
    const text = isUniform ? `${hits}x ${round(perHit)}, ${round(total)} damage` : `${round(perHit)} damage`;
    const weight = weaponPayloadMass(weapon);
    return `${weapon.description} (${text}${weight > 0 ? `, weight ${round(weight)}` : ''})`;
}
