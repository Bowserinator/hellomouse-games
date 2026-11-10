import { powerCentipercentMaximum, projectileDefaultLifetimeInSeconds, projectileFiringSpeedMultiplier,
    projectileGravityInVoxelsPerSecondSquared, resolveMaximumDurationInSeconds, simulationTicksPerSecond,
    tankHullHeightInVoxels, turretPitchMaximumDegrees, turretPitchMinimumDegrees,
    turretPitchQuantizationSteps } from '../config.js';
import { arcTangent2, arcTangentOfRatio, radiansPerDegree } from './math/deterministic-math.js';
import { decodePitch, decodeYaw, quantizePitch, quantizeYaw } from './math/fixed-quantize.js';
import { launchVelocity, stepProjectileBallistics } from './math/projectile-ballistics.js';
import { Vector3, createVector3, vectorLength } from './math/vector3.js';
import { rotateModelVector } from './model-collision.js';
import { Tank } from './tank.js';
import { WeaponDataFiles, WeaponDefinition } from './weapon-types.js';
import { raycastVoxels } from './world/voxel-raycast.js';
import { VoxelWorld } from './world/voxel-world.js';

export interface AutoAimSolution {
    yawQuantized: number;
    pitchQuantized: number;
    powerCentipercent: number;
}

export type AutoAimResult =
    { kind: 'solved'; solution: AutoAimSolution } | { kind: 'unsupported' } | { kind: 'unreachable' };

const hitToleranceInVoxels = 2;
const powerSearchStepCentipercent = 250;
const pitchSearchWindowInDegrees = 1.5;
const coarsePitchStep = 6;
const fineSearchRadiusInSteps = coarsePitchStep;
const originIterations = 3;

const degreesPerPitchStep = (turretPitchMaximumDegrees - turretPitchMinimumDegrees) /
    (turretPitchQuantizationSteps - 1);

function planarLength(x: number, z: number): number {
    return Math.sqrt(x * x + z * z);
}

function distanceToSegment(point: Vector3, start: Vector3, end: Vector3): number {
    const x = end.x - start.x, y = end.y - start.y, z = end.z - start.z;
    const lengthSquared = x * x + y * y + z * z;
    const fraction = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
        ((point.x - start.x) * x + (point.y - start.y) * y + (point.z - start.z) * z) / lengthSquared));
    return vectorLength(createVector3(start.x + x * fraction - point.x, start.y + y * fraction - point.y,
        start.z + z * fraction - point.z));
}

/** Finds a bearing, elevation and power that makes the selected weapon's shot reach the target tank. */
export function solveAutoAim(world: VoxelWorld, data: WeaponDataFiles, tank: Tank, target: Tank,
    weapon: WeaponDefinition): AutoAimResult {
    if (weapon.aimPreviewMode !== 'ballistic' && weapon.aimPreviewMode !== 'straight') return { kind: 'unsupported' };
    const turret = data.turrets[weapon.turretIdentifier];
    const aimPoint = createVector3(target.position.x, target.position.y + tankHullHeightInVoxels / 2,
        target.position.z);
    const muzzleAt = (yaw: number, pitch: number): Vector3 => {
        const pivot = createVector3(...turret.turretPivot);
        const barrel = rotateModelVector(createVector3(...turret.barrelPivot), yaw, 0);
        const muzzle = rotateModelVector(createVector3(...turret.muzzleOffset), yaw, pitch);
        return createVector3(tank.position.x + pivot.x + barrel.x + muzzle.x,
            tank.position.y + pivot.y + barrel.y + muzzle.y, tank.position.z + pivot.z + barrel.z + muzzle.z);
    };
    const initialYaw = decodeYaw(tank.turretYawQuantized), initialPitch = decodePitch(tank.turretPitchQuantized);
    const withinPitchLimits = (pitch: number): boolean => pitch >= turretPitchMinimumDegrees * radiansPerDegree &&
        pitch <= turretPitchMaximumDegrees * radiansPerDegree;

    if (weapon.aimPreviewMode === 'straight') {
        let yaw = initialYaw, pitch = initialPitch;
        for (let iteration = 0; iteration < originIterations; iteration++) {
            const origin = muzzleAt(yaw, pitch);
            const dx = aimPoint.x - origin.x, dz = aimPoint.z - origin.z;
            yaw = arcTangent2(dx, dz);
            pitch = arcTangent2(aimPoint.y - origin.y, planarLength(dx, dz));
            if (!withinPitchLimits(pitch)) return { kind: 'unreachable' };
        }
        return { kind: 'solved', solution: { yawQuantized: quantizeYaw(yaw), pitchQuantized: quantizePitch(pitch),
            powerCentipercent: tank.powerCentipercent } };
    }

    const launch = weapon.onFire.find(action => action.action === 'launchProjectile' ||
        action.action === 'spawnProjectiles');
    if (!launch || (launch.action !== 'launchProjectile' && launch.action !== 'spawnProjectiles') ||
        launch.action === 'launchProjectile' && launch.velocity) return { kind: 'unsupported' };
    const definition = weapon.projectiles[launch.projectileIdentifier];
    const fixedSpeed = launch.speedInVoxelsPerSecond ?? definition.speedInVoxelsPerSecond;
    const massClass = definition.massClass ?? weapon.massClass ?? 1;
    const speedScale = (definition.speedScale ?? 1) * (launch.action === 'launchProjectile' ?
        launch.speedScale ?? 1 : 1);
    const gravity = projectileGravityInVoxelsPerSecondSquared * (definition.gravityScale ?? 1);
    const tickLimit = Math.ceil(Math.min(resolveMaximumDurationInSeconds,
        definition.lifetimeSeconds ?? projectileDefaultLifetimeInSeconds) * simulationTicksPerSecond);
    const speedAt = (power: number): number => fixedSpeed !== undefined ? fixedSpeed * projectileFiringSpeedMultiplier
        : vectorLength(launchVelocity(0, 0, power, massClass, speedScale));

    /** Closest the shot gets to the target before it hits terrain, using the real stepping. */
    const missDistance = (yaw: number, pitch: number, power: number): number => {
        const direction = launchVelocity(yaw, pitch, powerCentipercentMaximum, 1);
        const scale = speedAt(power) / vectorLength(direction);
        const state = { position: muzzleAt(yaw, pitch),
            velocity: createVector3(direction.x * scale, direction.y * scale, direction.z * scale) };
        let closest = Infinity;
        const sample = (previous: Vector3, next: Vector3): boolean => {
            const hit = raycastVoxels(world, previous, createVector3(next.x - previous.x, next.y - previous.y,
                next.z - previous.z), vectorLength(createVector3(next.x - previous.x, next.y - previous.y,
                next.z - previous.z)));
            closest = Math.min(closest, distanceToSegment(aimPoint, previous, hit ? hit.position : next));
            return hit === null && next.y > 0;
        };
        for (let tick = 0; tick < tickLimit; tick++)
            if (!stepProjectileBallistics(state, definition.gravityScale ?? 1, sample)) break;
        return closest;
    };

    /** The pitch that lands on the target in a vacuum for the low or high arc. */
    const analyticPitch = (origin: Vector3, speed: number, highArc: boolean): number | null => {
        const horizontal = planarLength(aimPoint.x - origin.x, aimPoint.z - origin.z);
        const rise = aimPoint.y - origin.y;
        if (gravity === 0) return arcTangent2(rise, horizontal);
        if (horizontal < .5) return highArc ? turretPitchMaximumDegrees * radiansPerDegree : null;
        const speedSquared = speed * speed;
        const discriminant = speedSquared * speedSquared - gravity * (gravity * horizontal * horizontal +
            2 * rise * speedSquared);
        if (discriminant < 0) return null;
        return arcTangentOfRatio((speedSquared + (highArc ? 1 : -1) * Math.sqrt(discriminant)) /
            (gravity * horizontal));
    };

    const powers: Array<number> = [];
    if (fixedSpeed !== undefined) powers.push(tank.powerCentipercent);
    else {
        for (let power = tank.powerCentipercent; power < powerCentipercentMaximum;
            power += powerSearchStepCentipercent) powers.push(power);
        powers.push(powerCentipercentMaximum);
    }
    const windowSteps = Math.ceil(pitchSearchWindowInDegrees / degreesPerPitchStep);
    for (const power of powers) {
        const speed = speedAt(power);
        for (const highArc of [false, true]) {
            let yaw = initialYaw, pitch = initialPitch;
            let valid = true;
            for (let iteration = 0; iteration < originIterations && valid; iteration++) {
                const origin = muzzleAt(yaw, pitch);
                yaw = arcTangent2(aimPoint.x - origin.x, aimPoint.z - origin.z);
                const guess = analyticPitch(origin, speed, highArc);
                if (guess === null) valid = false;
                else pitch = Math.max(turretPitchMinimumDegrees * radiansPerDegree,
                    Math.min(turretPitchMaximumDegrees * radiansPerDegree, guess));
            }
            if (!valid) continue;
            const yawQuantized = quantizeYaw(yaw), centre = quantizePitch(pitch);
            const quantizedYaw = decodeYaw(yawQuantized);
            const miss = (step: number): number => step < 0 || step >= turretPitchQuantizationSteps ? Infinity :
                missDistance(quantizedYaw, decodePitch(step), power);
            let best = centre, bestMiss = miss(centre);
            for (let step = centre - windowSteps; step <= centre + windowSteps; step += coarsePitchStep) {
                const candidate = miss(step);
                if (candidate < bestMiss) { best = step; bestMiss = candidate; }
            }
            const coarseBest = best;
            for (let step = coarseBest - fineSearchRadiusInSteps; step <= coarseBest + fineSearchRadiusInSteps;
                step++) {
                const candidate = miss(step);
                if (candidate < bestMiss) { best = step; bestMiss = candidate; }
            }
            if (bestMiss <= hitToleranceInVoxels) return { kind: 'solved', solution: {
                yawQuantized, pitchQuantized: best, powerCentipercent: power } };
        }
    }
    return { kind: 'unreachable' };
}
