import { weaponRayContactSearchIterations } from '../config.js';
import { DamageProfile, DamageQueue, DamageTarget } from './damage.js';
import { Vector3, createVector3, dotProduct, normalizeVector } from './math/vector3.js';
import { distanceFromSegmentToModel, raycastModel } from './model-collision.js';
import { Tank } from './tank.js';
import { applyTerrainProfile } from './terrain-profiles.js';
import { TerrainProfile } from './weapon-types.js';
import { TerrainEditResult } from './world/terrain-edit.js';
import { raycastVoxels } from './world/voxel-raycast.js';
import { VoxelWorld } from './world/voxel-world.js';

export interface WeaponRay {
    origin: Vector3;
    direction: Vector3;
    lengthInVoxels: number;
    radiusInVoxels: number;
    passesThroughTerrain: boolean;
    stopsAtFirstTank?: boolean;
    damageProfile: DamageProfile;
    terrainProfile?: TerrainProfile;
    randomSeed: number;
}

export interface WeaponRayResult {
    endpoint: Vector3;
    hitSeatIndices: Array<number>;
    terrainEdit: TerrainEditResult | null;
}

export function fireWeaponRay(world: VoxelWorld, ray: WeaponRay, targets: ReadonlyArray<DamageTarget>,
    source: Tank | null, damage: DamageQueue): WeaponRayResult {
    if (!Number.isFinite(ray.lengthInVoxels) || ray.lengthInVoxels < 0 ||
        !Number.isFinite(ray.radiusInVoxels) || ray.radiusInVoxels < 0) throw new RangeError('Invalid weapon ray');
    const direction = normalizeVector(createVector3(), ray.direction);
    const terrainHit = ray.passesThroughTerrain ? null
        : raycastVoxels(world, ray.origin, direction, ray.lengthInVoxels);
    let length = terrainHit?.distance ?? ray.lengthInVoxels;
    const endpoint = createVector3(ray.origin.x + direction.x * length, ray.origin.y + direction.y * length,
        ray.origin.z + direction.z * length);
    if (direction.x === 0 && direction.y === 0 && direction.z === 0)
        return { endpoint, hitSeatIndices: [], terrainEdit: null };
    let hits: Array<DamageTarget> = [];
    let firstDistance = Infinity;
    for (const target of [...targets].sort((first, second) => first.tank.seatIndex - second.tank.seatIndex)) {
        const tank = target.tank;
        const pose = { position: tank.position, yawInRadians: tank.hullYawInRadians, pitchInRadians: 0 };
        const models = [{ model: target.hullModel, pose }, ...target.additionalModels ?? []];
        const distanceToSegment = (end: Vector3): number => Math.min(...models.map(instance =>
            distanceFromSegmentToModel(instance.model, instance.pose, ray.origin, end)));
        const thinDistance = ray.radiusInVoxels === 0
            ? Math.min(...models.map(instance => raycastModel(instance.model, instance.pose,
                ray.origin, direction, length)?.distance ?? Infinity)) : Infinity;
        const hit = ray.radiusInVoxels === 0 ? thinDistance < Infinity
            : distanceToSegment(endpoint) <= ray.radiusInVoxels;
        if (!hit) continue;
        if (!ray.stopsAtFirstTank) {
            hits.push(target);
            continue;
        }
        let distance = thinDistance < Infinity ? thinDistance : length;
        if (ray.radiusInVoxels > 0) {
            let lower = 0, upper = length;
            const candidate = createVector3();
            for (let iteration = 0; iteration < weaponRayContactSearchIterations; iteration++) {
                const middle = (lower + upper) / 2;
                candidate.x = ray.origin.x + direction.x * middle;
                candidate.y = ray.origin.y + direction.y * middle;
                candidate.z = ray.origin.z + direction.z * middle;
                if (distanceToSegment(candidate) <= ray.radiusInVoxels)
                    upper = middle;
                else lower = middle;
            }
            distance = upper;
        }
        if (distance < firstDistance) {
            firstDistance = distance;
            hits = [target];
        }
    }
    if (ray.stopsAtFirstTank && hits.length) {
        length = firstDistance;
        endpoint.x = ray.origin.x + direction.x * length;
        endpoint.y = ray.origin.y + direction.y * length;
        endpoint.z = ray.origin.z + direction.z * length;
    }
    const result: WeaponRayResult = { endpoint, hitSeatIndices: [], terrainEdit: ray.terrainProfile
        ? applyTerrainProfile(world, ray.terrainProfile, ray.origin, direction, ray.randomSeed,
            { lengthInVoxels: length, radiusInVoxels: ray.radiusInVoxels }) : null };
    for (const target of hits) {
        const tank = target.tank;
        const projection = Math.max(0, Math.min(length, dotProduct(direction, createVector3(
            tank.position.x - ray.origin.x, tank.position.y - ray.origin.y, tank.position.z - ray.origin.z))));
        const impact = createVector3(ray.origin.x + direction.x * projection,
            ray.origin.y + direction.y * projection, ray.origin.z + direction.z * projection);
        damage.enqueueExplosion(impact, { ...ray.damageProfile, splashDamage: 0, splashRadiusInVoxels: 0 },
            [target], source, tank.seatIndex);
        result.hitSeatIndices.push(tank.seatIndex);
    }
    return result;
}
