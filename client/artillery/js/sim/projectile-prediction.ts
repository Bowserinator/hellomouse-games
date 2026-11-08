import { resolveMaximumDurationInSeconds, simulationTicksPerSecond } from '../config.js';
import { stepProjectileBallistics } from './math/projectile-ballistics.js';
import { Vector3, createVector3, vectorLength } from './math/vector3.js';
import { raycastModel } from './model-collision.js';
import { Projectile } from './projectile.js';
import { ProjectileTarget } from './projectile-step.js';
import { VoxelRayHit, raycastVoxels } from './world/voxel-raycast.js';
import { VoxelWorld } from './world/voxel-world.js';

/** Where the projectile would first hit terrain, a tank or the world floor if it kept flying; null if it leaves the map. */
export function predictProjectileImpact(world: VoxelWorld, projectile: Projectile,
    targets: ReadonlyArray<ProjectileTarget>, worldMarginInVoxels = 0): Vector3 | null {
    const state = { position: createVector3(projectile.position.x, projectile.position.y, projectile.position.z),
        velocity: createVector3(projectile.velocity.x, projectile.velocity.y, projectile.velocity.z) };
    const gravityScale = projectile.isGuidanceActive ? 0 : projectile.gravityScale;
    const edge = world.mapEdgeLengthInVoxels;
    let impact: Vector3 | null = null;
    const sweep = (previous: Vector3, next: Vector3): boolean => {
        const direction = createVector3(next.x - previous.x, next.y - previous.y, next.z - previous.z);
        const distance = vectorLength(direction);
        let nearest: VoxelRayHit | null = raycastVoxels(world, previous, direction, distance);
        for (const target of targets) {
            const tank = target.tank;
            if (tank.isWreck || tank.seatIndex === projectile.ownerSeatIndex && !projectile.hasClearedOwner) continue;
            const pose = { position: tank.position, yawInRadians: tank.hullYawInRadians, pitchInRadians: 0 };
            const hits = [raycastModel(target.hullModel, pose, previous, direction, distance)];
            for (const part of target.additionalModels ?? [])
                hits.push(raycastModel(part.model, part.pose, previous, direction, distance));
            for (const hit of hits) if (hit && (!nearest || hit.distance < nearest.distance)) nearest = hit;
        }
        if (nearest) {
            impact = createVector3(nearest.position.x, nearest.position.y, nearest.position.z);
            return false;
        }
        return true;
    };
    for (let tick = 0; tick < resolveMaximumDurationInSeconds * simulationTicksPerSecond; tick++) {
        if (!stepProjectileBallistics(state, gravityScale, sweep)) return impact;
        if (state.position.x < 0 || state.position.z < 0 || state.position.x >= edge || state.position.z >= edge)
            return null;
        if (state.position.y < -worldMarginInVoxels) return state.position;
    }
    return null;
}
