import { modelMaximumDimensionInVoxels } from '../config.js';
import { cosineOfRadians, sineOfRadians } from './math/deterministic-math.js';
import { Vector3, createVector3, normalizeVector } from './math/vector3.js';
import { distanceSquaredFromSegmentToBox } from './math/segment-box.js';
import { Material } from './world/material-table.js';
import { VoxelRayGrid, VoxelRayHit, raycastVoxelGrid } from './world/voxel-raycast.js';

export type ModelVoxel = readonly [number, number, number, string];
export interface VoxelModelSpec {
    size: readonly [number, number, number];
    pivot: readonly [number, number, number];
    voxels: ReadonlyArray<ModelVoxel>;
}

export interface ModelPose {
    position: Vector3;
    yawInRadians: number;
    pitchInRadians: number;
}

export class CollisionModel implements VoxelRayGrid {
    readonly size: Vector3;
    readonly pivot: Vector3;
    readonly voxels: ReadonlyArray<ModelVoxel>;
    private readonly occupancy: Uint8Array;

    constructor(specification: VoxelModelSpec) {
        if (specification.size.length !== 3 || specification.size.some(size =>
            !Number.isInteger(size) || size <= 0 || size > modelMaximumDimensionInVoxels) ||
            specification.pivot.length !== 3 || specification.pivot.some(value => !Number.isFinite(value)))
            throw new Error('Invalid voxel model dimensions or pivot');
        this.size = createVector3(...specification.size);
        this.pivot = createVector3(...specification.pivot);
        this.occupancy = new Uint8Array(this.size.x * this.size.y * this.size.z);
        this.voxels = specification.voxels.map(voxel => {
            const [x, y, z, paint] = voxel;
            if (voxel.length !== 4 || !Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z) ||
                x < 0 || y < 0 || z < 0 || x >= this.size.x || y >= this.size.y || z >= this.size.z ||
                typeof paint !== 'string' || !paint.length)
                throw new Error('Invalid model voxel');
            const index = x + this.size.x * (z + this.size.z * y);
            if (this.occupancy[index]) throw new Error('Duplicate model voxel');
            this.occupancy[index] = 1;
            return Object.freeze([x, y, z, paint] as const);
        });
        Object.freeze(this.voxels);
    }

    getMaterial(x: number, y: number, z: number): Material {
        return this.occupancy[x + this.size.x * (z + this.size.z * y)] ? Material.LIGHT_STONE : Material.AIR;
    }
}

function rotateToLocal(value: Vector3, pose: ModelPose): Vector3 {
    const yawCosine = cosineOfRadians(pose.yawInRadians), yawSine = sineOfRadians(pose.yawInRadians);
    const pitchCosine = cosineOfRadians(pose.pitchInRadians), pitchSine = sineOfRadians(pose.pitchInRadians);
    const x = value.x * yawCosine - value.z * yawSine;
    const z = value.x * yawSine + value.z * yawCosine;
    return createVector3(x, value.y * pitchCosine - z * pitchSine, value.y * pitchSine + z * pitchCosine);
}

export function rotateModelVector(value: Vector3, yawInRadians: number, pitchInRadians: number): Vector3 {
    const pitchCosine = cosineOfRadians(pitchInRadians), pitchSine = sineOfRadians(pitchInRadians);
    const yawCosine = cosineOfRadians(yawInRadians), yawSine = sineOfRadians(yawInRadians);
    const z = -value.y * pitchSine + value.z * pitchCosine;
    return createVector3(value.x * yawCosine + z * yawSine,
        value.y * pitchCosine + value.z * pitchSine, -value.x * yawSine + z * yawCosine);
}

export function raycastModel(model: CollisionModel, pose: ModelPose, origin: Vector3, direction: Vector3,
    maximumDistance: number): VoxelRayHit | null {
    const localOrigin = rotateToLocal(createVector3(origin.x - pose.position.x, origin.y - pose.position.y,
        origin.z - pose.position.z), pose);
    localOrigin.x += model.pivot.x;
    localOrigin.y += model.pivot.y;
    localOrigin.z += model.pivot.z;
    const hit = raycastVoxelGrid(model, model.size, localOrigin, rotateToLocal(direction, pose), maximumDistance);
    if (!hit) return null;
    const normalizedDirection = normalizeVector(createVector3(), direction);
    hit.position = createVector3(origin.x + normalizedDirection.x * hit.distance,
        origin.y + normalizedDirection.y * hit.distance, origin.z + normalizedDirection.z * hit.distance);
    hit.normal = rotateModelVector(hit.normal, pose.yawInRadians, pose.pitchInRadians);
    return hit;
}

export function distanceFromSegmentToModel(model: CollisionModel, pose: ModelPose,
    start: Vector3, end: Vector3): number {
    const localStart = rotateToLocal(createVector3(start.x - pose.position.x, start.y - pose.position.y,
        start.z - pose.position.z), pose);
    const localEnd = rotateToLocal(createVector3(end.x - pose.position.x, end.y - pose.position.y,
        end.z - pose.position.z), pose);
    for (const point of [localStart, localEnd]) {
        point.x += model.pivot.x;
        point.y += model.pivot.y;
        point.z += model.pivot.z;
    }
    let nearestSquared = Infinity;
    for (const [x, y, z] of model.voxels) {
        nearestSquared = Math.min(nearestSquared, distanceSquaredFromSegmentToBox(localStart, localEnd,
            createVector3(x, y, z), createVector3(x + 1, y + 1, z + 1)));
        if (nearestSquared === 0) return 0;
    }
    return Math.sqrt(nearestSquared);
}

export function distanceToModel(model: CollisionModel, pose: ModelPose, point: Vector3): number {
    const local = rotateToLocal(createVector3(point.x - pose.position.x, point.y - pose.position.y,
        point.z - pose.position.z), pose);
    local.x += model.pivot.x;
    local.y += model.pivot.y;
    local.z += model.pivot.z;
    let distanceSquared = Infinity;
    for (const [x, y, z] of model.voxels) {
        const offsetX = Math.max(x - local.x, 0, local.x - x - 1);
        const offsetY = Math.max(y - local.y, 0, local.y - y - 1);
        const offsetZ = Math.max(z - local.z, 0, local.z - z - 1);
        distanceSquared = Math.min(distanceSquared, offsetX * offsetX + offsetY * offsetY + offsetZ * offsetZ);
    }
    return Math.sqrt(distanceSquared);
}
