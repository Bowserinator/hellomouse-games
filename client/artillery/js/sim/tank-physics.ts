import { simulationTicksPerSecond, tankAirborneHorizontalDrag, tankBuriedSnapMaximumInVoxels,
    tankClimbSpeedInVoxelsPerSecond, tankCollisionInsetInVoxels,
    tankFallDamagePerVoxelBeyondSafeHeight, tankFallDamageSafeHeightInVoxels,
    tankGravityInVoxelsPerSecondSquared, tankHullLengthInVoxels,
    tankHullTurnRateInDegreesPerSecond, tankHullWidthInVoxels, tankMaximumClimbSlopeTangent,
    tankMovementSpeedInVoxelsPerSecond, tankSlopeBaselineInVoxels, tankStepDownMaximumInVoxels,
    tankStepUpMaximumInVoxels, tankWaterDamagePerTurn, worldWaterSurfaceHeightInVoxels } from '../config.js';
import { MovementInput } from '../types.js';
import { fullCircleInRadians, radiansPerDegree, sineOfRadians, cosineOfRadians } from './math/deterministic-math.js';
import { Vector3, createVector3 } from './math/vector3.js';
import { findSupportHeight, isTankEnvelopeClear } from './tank-collision.js';
import { Tank } from './tank.js';
import { VoxelWorld } from './world/voxel-world.js';

const tickDuration = 1 / simulationTicksPerSecond;

function footprintSupport(world: VoxelWorld, position: Vector3, _yaw: number): number | null {
    const halfLength = tankHullLengthInVoxels / 2 - tankCollisionInsetInVoxels;
    const halfWidth = tankHullWidthInVoxels / 2 - tankCollisionInsetInVoxels;
    let highest = -Infinity;
    for (let z = Math.floor(position.z - halfLength); z < Math.ceil(position.z + halfLength); z++)
        for (let x = Math.floor(position.x - halfWidth); x < Math.ceil(position.x + halfWidth); x++) {
            const support = findSupportHeight(world, x + .5, z + .5,
                position.y + tankStepUpMaximumInVoxels, position.y - tankStepDownMaximumInVoxels);
            if (support !== null) highest = Math.max(highest, support);
        }
    return highest === -Infinity ? null : highest;
}

export function resolveTankTerrainOverlap(world: VoxelWorld, tank: Tank, tanks: ReadonlyArray<Tank>): boolean {
    const standing = createVector3(tank.position.x, tank.isGrounded
        ? Math.max(tank.position.y, tank.standingSupportHeight) : tank.position.y, tank.position.z);
    if (isTankEnvelopeClear(world, standing, tank.hullYawInRadians, tanks, tank.seatIndex)) {
        tank.isBuried = false;
        return true;
    }
    for (let rise = 1; rise <= tankBuriedSnapMaximumInVoxels; rise++) {
        standing.y++;
        if (!isTankEnvelopeClear(world, standing, tank.hullYawInRadians, tanks, tank.seatIndex)) continue;
        tank.position.y = standing.y;
        tank.standingSupportHeight = standing.y;
        tank.isBuried = false;
        tank.velocity.y = 0;
        return true;
    }
    tank.isBuried = true;
    return false;
}

function moveGroundedTank(world: VoxelWorld, tank: Tank, inputMask: number, tanks: ReadonlyArray<Tank>): void {
    const forward = ((inputMask & MovementInput.FORWARD) !== 0 ? 1 : 0) -
        ((inputMask & MovementInput.BACKWARD) !== 0 ? 1 : 0);
    const standing = createVector3(tank.position.x, Math.max(tank.position.y, tank.standingSupportHeight),
        tank.position.z);
    if (forward === 0) return;
    const directionX = sineOfRadians(tank.hullYawInRadians) * forward;
    const directionZ = cosineOfRadians(tank.hullYawInRadians) * forward;
    const next = createVector3(standing.x + directionX * tankMovementSpeedInVoxelsPerSecond * tickDuration,
        standing.y, standing.z + directionZ * tankMovementSpeedInVoxelsPerSecond * tickDuration);
    const support = footprintSupport(world, next, tank.hullYawInRadians);
    const ahead = findSupportHeight(world, next.x + directionX * tankSlopeBaselineInVoxels,
        next.z + directionZ * tankSlopeBaselineInVoxels,
        standing.y + tankMaximumClimbSlopeTangent * tankSlopeBaselineInVoxels + 1,
        standing.y - tankStepDownMaximumInVoxels);
    if (ahead !== null && ahead - standing.y > Math.max(tankStepUpMaximumInVoxels,
        tankMaximumClimbSlopeTangent * tankSlopeBaselineInVoxels)) return;
    next.y = support ?? standing.y;
    if (!isTankEnvelopeClear(world, next, tank.hullYawInRadians, tanks, tank.seatIndex)) return;
    tank.position.x = next.x;
    tank.position.z = next.z;
    if (support === null) {
        tank.isGrounded = false;
        tank.airbornePeakHeight = tank.position.y;
    } else tank.standingSupportHeight = support;
}

function integrateAirborneTank(world: VoxelWorld, tank: Tank, tanks: ReadonlyArray<Tank>): void {
    tank.velocity.y -= tankGravityInVoxelsPerSecondSquared * tickDuration;
    tank.velocity.x *= tankAirborneHorizontalDrag;
    tank.velocity.z *= tankAirborneHorizontalDrag;
    const substeps = Math.max(1, Math.ceil(Math.max(Math.abs(tank.velocity.x), Math.abs(tank.velocity.y),
        Math.abs(tank.velocity.z)) * tickDuration));
    const stepDuration = tickDuration / substeps;
    for (let step = 0; step < substeps; step++)
        for (const axis of ['x', 'z', 'y'] as const) {
            const next = createVector3(tank.position.x, tank.position.y, tank.position.z);
            next[axis] += tank.velocity[axis] * stepDuration;
            if (isTankEnvelopeClear(world, next, tank.hullYawInRadians, tanks, tank.seatIndex)) {
                tank.position[axis] = next[axis];
                continue;
            }
            if (axis === 'y' && tank.velocity.y < 0) {
                const support = footprintSupport(world, tank.position, tank.hullYawInRadians);
                if (support !== null) {
                    tank.position.y = support;
                    tank.standingSupportHeight = support;
                }
                tank.isGrounded = true;
            }
            if (axis === 'y' && tank.isGrounded)
                tank.applyDamage(Math.max(0, tank.airbornePeakHeight - tank.position.y -
                    tankFallDamageSafeHeightInVoxels) * tankFallDamagePerVoxelBeyondSafeHeight, null);
            tank.velocity[axis] = 0;
        }
    tank.airbornePeakHeight = Math.max(tank.airbornePeakHeight, tank.position.y);
}

export function tickTankPhysics(world: VoxelWorld, tank: Tank, inputMask: number,
    movementBudgetInTicks: number, tanks: ReadonlyArray<Tank>): void {
    if (!tank.isWreck) {
        // Yaw grows counterclockwise when viewed from above, so turning left raises it
        const turn = ((inputMask & MovementInput.LEFT) !== 0 ? 1 : 0) -
            ((inputMask & MovementInput.RIGHT) !== 0 ? 1 : 0);
        tank.hullYawInRadians = ((tank.hullYawInRadians + turn * tankHullTurnRateInDegreesPerSecond *
            radiansPerDegree * tickDuration) % fullCircleInRadians + fullCircleInRadians) % fullCircleInRadians;
    }
    if (!resolveTankTerrainOverlap(world, tank, tanks)) return;
    if (tank.isGrounded) {
        const standing = createVector3(tank.position.x, Math.max(tank.position.y, tank.standingSupportHeight),
            tank.position.z);
        const support = footprintSupport(world, standing, tank.hullYawInRadians);
        if (support === null) {
            tank.isGrounded = false;
            tank.airbornePeakHeight = tank.position.y;
        } else tank.standingSupportHeight = support;
    }
    if (inputMask !== 0 && !tank.isWreck) {
        if (tank.movementTicksUsed >= movementBudgetInTicks)
            inputMask &= MovementInput.LEFT | MovementInput.RIGHT;
        const driving = ((inputMask & MovementInput.FORWARD) !== 0) !==
            ((inputMask & MovementInput.BACKWARD) !== 0);
        if (driving) tank.movementTicksUsed++;
        if (tank.isGrounded) moveGroundedTank(world, tank, inputMask, tanks);
    }
    if (!tank.isGrounded) integrateAirborneTank(world, tank, tanks);
    else {
        const maximumChange = tankClimbSpeedInVoxelsPerSecond * tickDuration;
        tank.position.y += Math.max(-maximumChange, Math.min(maximumChange,
            tank.standingSupportHeight - tank.position.y));
        tank.velocity.x = tank.velocity.y = tank.velocity.z = 0;
    }
}

export function applyTurnWaterHazard(tank: Tank): number {
    return tank.position.y < worldWaterSurfaceHeightInVoxels ? tank.applyDamage(tankWaterDamagePerTurn, null) : 0;
}
