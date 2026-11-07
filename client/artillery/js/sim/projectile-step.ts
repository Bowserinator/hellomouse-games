import { simulationTicksPerSecond, tankHullHeightInVoxels, tankHullLengthInVoxels,
    tankHullWidthInVoxels, worldHeightInVoxels } from '../config.js';
import { DamageTarget } from './damage.js';
import { arcTangent2, cosineOfRadians, sineOfRadians } from './math/deterministic-math.js';
import { stepProjectileBallistics } from './math/projectile-ballistics.js';
import { Vector3, createVector3, dotProduct, vectorLength } from './math/vector3.js';
import { CollisionModel, ModelPose, raycastModel } from './model-collision.js';
import { Projectile } from './projectile.js';
import { Tank } from './tank.js';
import { applyProjectileGuidance } from './projectile-guidance.js';
import { Material, materialTable } from './world/material-table.js';
import { VoxelRayHit, raycastVoxels } from './world/voxel-raycast.js';
import { VoxelWorld } from './world/voxel-world.js';

export interface ProjectileTarget extends DamageTarget {
    additionalModels?: ReadonlyArray<{ model: CollisionModel; pose: ModelPose }>;
}

export type ProjectileHook = 'onFlightTick' | 'onTimer' | 'onApex' | 'onTerrainImpact' | 'onTankImpact' |
'onBounce' | 'onExpire';
export interface ProjectileHookContext {
    targetSeatIndex?: number;
    normal?: Vector3;
}
export type RunProjectileHook = (projectile: Projectile, hook: ProjectileHook,
    context: ProjectileHookContext) => void;

const surfaceSeparation = .0001;

function nearestEnemy(projectile: Projectile, owner: Tank | undefined,
    targets: ReadonlyArray<ProjectileTarget>): Tank | null {
    let nearest: Tank | null = null, nearestDistance = Infinity;
    for (const { tank } of targets) {
        if (tank.isWreck || tank.seatIndex === projectile.ownerSeatIndex ||
            owner && tank.teamIndex === owner.teamIndex) continue;
        const offsetX = tank.position.x - projectile.position.x, offsetZ = tank.position.z - projectile.position.z;
        const distance = offsetX * offsetX + offsetZ * offsetZ;
        if (distance < nearestDistance) {
            nearest = tank;
            nearestDistance = distance;
        }
    }
    return nearest;
}

export function stepProjectile(world: VoxelWorld, projectile: Projectile, targets: ReadonlyArray<ProjectileTarget>,
    runHook: RunProjectileHook, worldMarginInVoxels = 0): void {
    if (!projectile.isAlive) return;
    const orderedTargets = [...targets].sort((first, second) => first.tank.seatIndex - second.tank.seatIndex);
    const expire = (): void => {
        if (!projectile.isAlive) return;
        runHook(projectile, 'onExpire', {});
        projectile.isAlive = false;
    };
    projectile.ageInTicks++;
    applyProjectileGuidance(world, projectile, orderedTargets.map(target => target.tank));
    const flight = projectile.definition.onFlightTick;
    if (flight && projectile.ageInTicks % flight.everyTicks === 0) runHook(projectile, 'onFlightTick', {});
    const timer = projectile.definition.onTimer;
    if (projectile.isAlive && timer && !projectile.hasFiredTimer &&
        projectile.ageInTicks >= Math.ceil(timer.afterSeconds * simulationTicksPerSecond)) {
        projectile.hasFiredTimer = true;
        runHook(projectile, 'onTimer', {});
    }
    if (!projectile.isAlive) return;
    const owner = orderedTargets.find(target => target.tank.seatIndex === projectile.ownerSeatIndex)?.tank;
    let hasLeftOwnerHull = projectile.hasClearedOwner;
    if (!projectile.hasClearedOwner && owner) {
        const offsetX = projectile.position.x - owner.position.x, offsetZ = projectile.position.z - owner.position.z;
        const sine = sineOfRadians(owner.hullYawInRadians), cosine = cosineOfRadians(owner.hullYawInRadians);
        hasLeftOwnerHull = Math.abs(offsetX * cosine - offsetZ * sine) > tankHullWidthInVoxels / 2 ||
            Math.abs(offsetX * sine + offsetZ * cosine) > tankHullLengthInVoxels / 2 ||
            projectile.position.y < owner.position.y ||
            projectile.position.y > owner.position.y + tankHullHeightInVoxels;
    }
    const bounceFrom = (surfaceNormal: Vector3): void => {
        const bounce = projectile.definition.bounce!;
        const normal = vectorLength(surfaceNormal) === 0 ? createVector3(0, 1, 0) : surfaceNormal;
        const incident = dotProduct(projectile.velocity, normal);
        projectile.velocity.x -= (1 + bounce.restitution) * incident * normal.x;
        projectile.velocity.y -= (1 + bounce.restitution) * incident * normal.y;
        projectile.velocity.z -= (1 + bounce.restitution) * incident * normal.z;
        if (bounce.verticalSpeedInVoxelsPerSecond !== undefined)
            projectile.velocity.y = bounce.verticalSpeedInVoxelsPerSecond;
        if (bounce.horizontalSpeedScale !== undefined) {
            projectile.velocity.x *= bounce.horizontalSpeedScale;
            projectile.velocity.z *= bounce.horizontalSpeedScale;
        }
        if (bounce.randomHeading) {
            let heading = projectile.random.range(-1, 1) * 3.141592653589793;
            const bias = bounce.nearestTankHeadingBias ?? 0;
            const enemy = bias > 0 ? nearestEnemy(projectile, owner, orderedTargets) : null;
            if (enemy) heading = arcTangent2(enemy.position.x - projectile.position.x,
                enemy.position.z - projectile.position.z) + heading * (1 - bias);
            const speed = bounce.horizontalSpeedInVoxelsPerSecond ?? Math.sqrt(
                projectile.velocity.x * projectile.velocity.x + projectile.velocity.z * projectile.velocity.z);
            projectile.velocity.x = sineOfRadians(heading) * speed;
            projectile.velocity.z = cosineOfRadians(heading) * speed;
        }
        projectile.position.x += normal.x * surfaceSeparation;
        projectile.position.y += normal.y * surfaceSeparation;
        projectile.position.z += normal.z * surfaceSeparation;
        projectile.bounceCount++;
        runHook(projectile, 'onBounce', { normal });
    };
    const sweep = (previous: Vector3, next: Vector3, ignoresTerrain = false): boolean => {
        const direction = createVector3(next.x - previous.x, next.y - previous.y, next.z - previous.z);
        const distance = vectorLength(direction);
        let terrain: VoxelRayHit | null = null;
        const isTunnelExit = projectile.terrainContact === 'tunnel' && projectile.hasEnteredTerrain;
        const isBedrock = (material: Material): boolean => materialTable[material].isIndestructible;
        if (ignoresTerrain) terrain = null;
        else if (projectile.terrainContact === 'pass') terrain = raycastVoxels(world, previous, direction, distance,
            isBedrock);
        else terrain = isTunnelExit
            ? raycastVoxels(world, previous, direction, distance, material => material === Material.AIR ||
                isBedrock(material))
            : raycastVoxels(world, previous, direction, distance);
        const bodyHits: Array<{ hit: VoxelRayHit; targetSeatIndex: number }> = [];
        for (const target of orderedTargets) {
            const tank = target.tank;
            const isOwner = tank.seatIndex === projectile.ownerSeatIndex;
            if (isOwner && !hasLeftOwnerHull ||
                projectile.tankHitBounce.get(tank.seatIndex) === projectile.bounceCount) continue;
            const body = raycastModel(target.hullModel, { position: tank.position,
                yawInRadians: tank.hullYawInRadians, pitchInRadians: 0 }, previous, direction, distance);
            const hits = [body];
            for (const part of target.additionalModels ?? [])
                hits.push(raycastModel(part.model, part.pose, previous, direction, distance));
            let nearest: VoxelRayHit | null = null;
            for (const hit of hits) if (hit && (!nearest || hit.distance < nearest.distance)) nearest = hit;
            if (isOwner && !projectile.hasClearedOwner) {
                // The muzzle can sit inside the owner's own barrel, so ignore the owner until a sweep misses it
                if (!nearest) projectile.hasClearedOwner = true;
                continue;
            }
            if (nearest) bodyHits.push({ hit: nearest, targetSeatIndex: tank.seatIndex });
        }
        bodyHits.sort((first, second) => first.hit.distance - second.hit.distance ||
            first.targetSeatIndex - second.targetSeatIndex);
        for (const { hit, targetSeatIndex } of bodyHits) {
            if (terrain && hit.distance >= terrain.distance) break;
            projectile.position.x = hit.position.x;
            projectile.position.y = hit.position.y;
            projectile.position.z = hit.position.z;
            projectile.tankHitBounce.set(targetSeatIndex, projectile.bounceCount);
            runHook(projectile, 'onTankImpact', { targetSeatIndex, normal: hit.normal });
            if (projectile.definition.tankContact !== 'pass') {
                projectile.travelDistanceInVoxels += hit.distance;
                projectile.isAlive = false;
                return false;
            }
            if (!projectile.isAlive) return false;
            if (projectile.terrainContact === 'bounce' && projectile.definition.bounce?.bouncesOffTanks) {
                if (projectile.bounceCount >= projectile.definition.bounce.maximumCount) {
                    expire();
                    return false;
                }
                bounceFrom(hit.normal);
                return false;
            }
        }
        if (!terrain) {
            projectile.travelDistanceInVoxels += distance;
            return true;
        }
        projectile.travelDistanceInVoxels += terrain.distance;
        projectile.position.x = terrain.position.x;
        projectile.position.y = terrain.position.y;
        projectile.position.z = terrain.position.z;
        if (isBedrock(terrain.material)) {
            projectile.hasEnteredTerrain = true;
            if (projectile.terrainContact === 'explode' || !projectile.definition.onExpire)
                runHook(projectile, 'onTerrainImpact', { normal: terrain.normal });
            else expire();
            projectile.isAlive = false;
            return false;
        }
        if (isTunnelExit) {
            expire();
            return false;
        }
        const firstContact = !projectile.hasEnteredTerrain;
        projectile.hasEnteredTerrain = true;
        if (firstContact || (projectile.terrainContact !== 'tunnel' && projectile.terrainContact !== 'roll'))
            runHook(projectile, 'onTerrainImpact', { normal: terrain.normal });
        if (!projectile.isAlive) return false;
        switch (projectile.terrainContact) {
            case 'tunnel': return false;
            case 'pass': return true;
            case 'stick': projectile.isStuck = true; return false;
            case 'roll': {
                projectile.isRolling = true;
                projectile.position.y += surfaceSeparation;
                const speed = vectorLength(projectile.velocity);
                const horizontalSpeed = Math.sqrt(projectile.velocity.x * projectile.velocity.x +
                    projectile.velocity.z * projectile.velocity.z);
                if (horizontalSpeed > 0) {
                    projectile.velocity.x *= speed / horizontalSpeed;
                    projectile.velocity.z *= speed / horizontalSpeed;
                }
                projectile.velocity.y = 0;
                return false;
            }
            case 'explode': projectile.isAlive = false; return false;
            case 'bounce': {
                const bounce = projectile.definition.bounce!;
                if (projectile.bounceCount >= bounce.maximumCount) {
                    expire();
                    return false;
                }
                bounceFrom(terrain.normal);
                return false;
            }
        }
    };
    const previousVerticalSpeed = projectile.velocity.y;
    if (!projectile.isStuck && projectile.isRolling) {
        const next = createVector3(projectile.position.x + projectile.velocity.x / simulationTicksPerSecond,
            projectile.position.y, projectile.position.z + projectile.velocity.z / simulationTicksPerSecond);
        // Rolling hugs the surface of whatever column it enters, however steep, so it never collides with terrain
        const surface = world.highestSolidY(Math.floor(next.x), Math.floor(next.z));
        if (surface < 0) projectile.isRolling = false;
        else {
            next.y = surface + 1 + surfaceSeparation;
            if (sweep(projectile.position, next, true)) {
                projectile.position.x = next.x;
                projectile.position.y = next.y;
                projectile.position.z = next.z;
            } else if (projectile.isAlive) expire();
        }
    } else if (!projectile.isStuck) stepProjectileBallistics(projectile,
        projectile.isGuidanceActive ? 0 : projectile.gravityScale, sweep);
    if (!projectile.isAlive) return;
    if (!projectile.hasReachedApex && previousVerticalSpeed > 0 && projectile.velocity.y <= 0) {
        projectile.hasReachedApex = true;
        runHook(projectile, 'onApex', {});
    }
    const edge = world.mapEdgeLengthInVoxels;
    if (projectile.position.x < 0 || projectile.position.z < 0 || projectile.position.x >= edge ||
        projectile.position.z >= edge) {
        projectile.isAlive = false;
        return;
    }
    if (projectile.position.y < -worldMarginInVoxels ||
        projectile.position.y >= worldHeightInVoxels + worldMarginInVoxels) {
        runHook(projectile, 'onTerrainImpact', {});
        projectile.isAlive = false;
        return;
    }
    projectile.remainingLifetimeInTicks--;
    if (projectile.remainingLifetimeInTicks <= 0 ||
        projectile.travelDistanceInVoxels >= projectile.maximumTravelDistanceInVoxels) expire();
}
