import { projectileFiringSpeedMultiplier, simulationTicksPerSecond, tankHullHeightInVoxels } from '../config.js';
import { arcCosine, cosineOfRadians, radiansPerDegree, sineOfRadians } from './math/deterministic-math.js';
import { Vector3, createVector3, dotProduct, normalizeVector, vectorLength } from './math/vector3.js';
import { Projectile } from './projectile.js';
import { Tank } from './tank.js';
import { raycastVoxels } from './world/voxel-raycast.js';
import { VoxelWorld } from './world/voxel-world.js';

export function steerProjectileVelocity(velocity: Vector3, targetDirection: Vector3,
    maximumAngleInRadians: number, speed: number): void {
    const desired = normalizeVector(createVector3(), targetDirection);
    if (vectorLength(desired) === 0) return;
    const current = normalizeVector(createVector3(), velocity);
    const alignment = Math.max(-1, Math.min(1, dotProduct(current, desired)));
    const angle = arcCosine(alignment);
    if (vectorLength(current) === 0 || angle <= maximumAngleInRadians) {
        velocity.x = desired.x * speed;
        velocity.y = desired.y * speed;
        velocity.z = desired.z * speed;
        return;
    }
    let perpendicular = createVector3(desired.x - current.x * alignment, desired.y - current.y * alignment,
        desired.z - current.z * alignment);
    if (vectorLength(perpendicular) < 1e-12) perpendicular = Math.abs(current.x) < .9
        ? createVector3(1 - current.x * current.x, -current.x * current.y, -current.x * current.z)
        : createVector3(-current.z * current.x, -current.z * current.y, 1 - current.z * current.z);
    normalizeVector(perpendicular, perpendicular);
    const cosine = cosineOfRadians(maximumAngleInRadians), sine = sineOfRadians(maximumAngleInRadians);
    velocity.x = (current.x * cosine + perpendicular.x * sine) * speed;
    velocity.y = (current.y * cosine + perpendicular.y * sine) * speed;
    velocity.z = (current.z * cosine + perpendicular.z * sine) * speed;
}

export function applyProjectileGuidance(world: VoxelWorld, projectile: Projectile, tanks: ReadonlyArray<Tank>): void {
    const guidance = projectile.definition.guidance;
    const wasActive = projectile.isGuidanceActive;
    projectile.isGuidanceActive = false;
    if (!guidance || projectile.ageInTicks < Math.ceil((guidance.delaySeconds ?? 0) * simulationTicksPerSecond) ||
        (guidance.onlyWhileInTerrain && !world.isSolid(Math.floor(projectile.position.x),
            Math.floor(projectile.position.y), Math.floor(projectile.position.z)))) return;
    let target: Tank | null = null, nearestDistance = Infinity;
    const ownerTeam = tanks.find(tank => tank.seatIndex === projectile.ownerSeatIndex)?.teamIndex;
    for (const candidate of tanks) {
        if (candidate.isWreck || candidate.seatIndex === projectile.ownerSeatIndex ||
            candidate.teamIndex === ownerTeam) continue;
        const direction = createVector3(candidate.position.x - projectile.position.x,
            candidate.position.y + tankHullHeightInVoxels / 2 - projectile.position.y,
            candidate.position.z - projectile.position.z);
        const distance = guidance.target === 'above'
            ? Math.sqrt(direction.x * direction.x + direction.z * direction.z) : vectorLength(direction);
        const alreadyLocked = guidance.requireLineOfSight && wasActive &&
            candidate.seatIndex === projectile.targetSeatIndex;
        if (!alreadyLocked && distance > guidance.acquisitionRangeInVoxels) continue;
        if (guidance.target === 'above' && direction.y <= 0) continue;
        if (!alreadyLocked && guidance.requireLineOfSight &&
            raycastVoxels(world, projectile.position, direction, vectorLength(direction))) continue;
        if (alreadyLocked || distance < nearestDistance || (distance === nearestDistance &&
            (!target || candidate.seatIndex < target.seatIndex))) {
            target = candidate;
            nearestDistance = distance;
            if (alreadyLocked) break;
        }
    }
    if (!target) return;
    projectile.isGuidanceActive = true;
    projectile.targetSeatIndex = target.seatIndex;
    const direction = guidance.target === 'above' ? createVector3(0, 1, 0) : createVector3(
        target.position.x - projectile.position.x,
        target.position.y + tankHullHeightInVoxels / 2 - projectile.position.y,
        target.position.z - projectile.position.z);
    steerProjectileVelocity(projectile.velocity, direction, guidance.turnRateInDegreesPerSecond === undefined
        ? Infinity : guidance.turnRateInDegreesPerSecond * radiansPerDegree / simulationTicksPerSecond,
    guidance.speedInVoxelsPerSecond * projectileFiringSpeedMultiplier);
}
