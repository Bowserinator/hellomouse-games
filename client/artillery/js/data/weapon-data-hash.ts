import { StateHash } from '../sim/math/hash.js';
import { TurretDefinition, WeaponDataFiles } from '../sim/weapon-types.js';

const cosmeticKeys = new Set(['displayName', 'description', 'aimPreviewMode', 'effectProfileIdentifier',
    'trailEffectIdentifier', 'recoilDistanceInVoxels', 'fireSoundIdentifier', 'modelIdentifier']);

function canonicalSimulationData(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonicalSimulationData).join(',')}]`;
    if (value && typeof value === 'object') {
        const fields = value as Record<string, unknown>;
        return `{${Object.keys(fields).filter(key => !cosmeticKeys.has(key))
            .sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
            .map(key => `${JSON.stringify(key)}:${canonicalSimulationData(fields[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

export function weaponDataHash(data: WeaponDataFiles): number {
    const turrets: Record<string, TurretDefinition> = {};
    const collisionModels = new Set(['tank_hull']);
    for (const weapon of data.weapons) {
        const turret = data.turrets[weapon.turretIdentifier];
        turrets[weapon.turretIdentifier] = turret;
        collisionModels.add(turret.turretModelIdentifier).add(turret.barrelModelIdentifier);
    }
    const models: Record<string, unknown> = {};
    for (const identifier of collisionModels) {
        const specification = data.models[identifier];
        models[identifier] = { size: specification.size, pivot: specification.pivot,
            voxels: specification.voxels.map(voxel => voxel.slice(0, 3)) };
    }
    const hash = new StateHash();
    hash.string(canonicalSimulationData({ ...data, models, turrets }));
    return hash.value;
}
