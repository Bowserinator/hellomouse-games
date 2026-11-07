import { powerCentipercentMaximum, projectileFiringSpeedMultiplier, projectileGravityInVoxelsPerSecondSquared,
    projectileMaximumMuzzleSpeedInVoxelsPerSecond,
    projectileMaximumSubstepDistanceInVoxels, projectileReferenceMass, simulationTicksPerSecond } from '../../config.js';
import { cosineOfRadians, sineOfRadians } from './deterministic-math.js';
import { Vector3, createVector3, vectorLength } from './vector3.js';

export interface BallisticState {
    position: Vector3;
    velocity: Vector3;
}

export function launchVelocity(yawInRadians: number, pitchInRadians: number, powerCentipercent: number,
    massClass: number, speedScale = 1): Vector3 {
    if (!Number.isFinite(massClass) || massClass <= 0 || !Number.isFinite(speedScale) || speedScale < 0)
        throw new RangeError('Invalid projectile mass or speed scale');
    const speed = powerCentipercent / powerCentipercentMaximum * projectileMaximumMuzzleSpeedInVoxelsPerSecond *
        Math.sqrt(projectileReferenceMass / massClass) * speedScale * projectileFiringSpeedMultiplier;
    const horizontalSpeed = speed * cosineOfRadians(pitchInRadians);
    return createVector3(horizontalSpeed * sineOfRadians(yawInRadians), speed * sineOfRadians(pitchInRadians),
        horizontalSpeed * cosineOfRadians(yawInRadians));
}

export function stepProjectileBallistics(state: BallisticState, gravityScale: number,
    onSubstep?: (previous: Vector3, next: Vector3) => boolean): boolean {
    const tickDuration = 1 / simulationTicksPerSecond;
    state.velocity.y -= projectileGravityInVoxelsPerSecondSquared * gravityScale * tickDuration;
    const substepCount = Math.max(1, Math.ceil(vectorLength(state.velocity) * tickDuration /
        projectileMaximumSubstepDistanceInVoxels));
    const stepDuration = tickDuration / substepCount;
    const next = createVector3();
    for (let step = 0; step < substepCount; step++) {
        next.x = state.position.x + state.velocity.x * stepDuration;
        next.y = state.position.y + state.velocity.y * stepDuration;
        next.z = state.position.z + state.velocity.z * stepDuration;
        if (onSubstep && !onSubstep(state.position, next)) return false;
        state.position.x = next.x;
        state.position.y = next.y;
        state.position.z = next.z;
    }
    return true;
}
