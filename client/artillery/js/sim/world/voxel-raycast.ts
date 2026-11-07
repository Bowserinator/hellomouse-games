import { worldHeightInVoxels } from '../../config.js';
import { Vector3, createVector3, normalizeVector } from '../math/vector3.js';
import { Material, MaterialFlag, materialTable } from './material-table.js';
import { VoxelWorld } from './voxel-world.js';

export interface VoxelRayHit {
    voxelX: number;
    voxelY: number;
    voxelZ: number;
    material: Material;
    distance: number;
    position: Vector3;
    normal: Vector3;
}

export interface VoxelRayGrid {
    getMaterial(x: number, y: number, z: number): Material;
}

const solidMaterial = (material: Material): boolean => (materialTable[material].flags & MaterialFlag.SOLID) !== 0;

export function raycastVoxelGrid(grid: VoxelRayGrid, size: Vector3, origin: Vector3, direction: Vector3,
    maximumDistance: number): VoxelRayHit | null {
    return traceVoxels(grid, origin, direction, maximumDistance, solidMaterial, [size.x, size.y, size.z]);
}

export function raycastVoxels(world: VoxelWorld, origin: Vector3, direction: Vector3, maximumDistance: number,
    acceptsMaterial: (material: Material) => boolean = solidMaterial): VoxelRayHit | null {
    return traceVoxels(world, origin, direction, maximumDistance, acceptsMaterial,
        [world.mapEdgeLengthInVoxels, worldHeightInVoxels, world.mapEdgeLengthInVoxels]);
}

export function visitVoxelsAlongRay(world: VoxelWorld, origin: Vector3, direction: Vector3, maximumDistance: number,
    visit: (x: number, y: number, z: number, material: Material, distance: number) => void): void {
    traceVoxels(world, origin, direction, maximumDistance, (material, x, y, z, distance) => {
        visit(x, y, z, material, distance);
        return false;
    }, [world.mapEdgeLengthInVoxels, worldHeightInVoxels, world.mapEdgeLengthInVoxels]);
}

function traceVoxels(world: VoxelRayGrid, origin: Vector3, direction: Vector3, maximumDistance: number,
    acceptsMaterial: (material: Material, x: number, y: number, z: number, distance: number) => boolean,
    limits: ReadonlyArray<number>): VoxelRayHit | null {
    if (!Number.isFinite(maximumDistance) || maximumDistance < 0 ||
        !Number.isFinite(origin.x) || !Number.isFinite(origin.y) || !Number.isFinite(origin.z) ||
        !Number.isFinite(direction.x) || !Number.isFinite(direction.y) || !Number.isFinite(direction.z)) return null;
    const rayDirection = normalizeVector(createVector3(), direction);
    if (rayDirection.x === 0 && rayDirection.y === 0 && rayDirection.z === 0) return null;
    const origins = [origin.x, origin.y, origin.z];
    const directions = [rayDirection.x, rayDirection.y, rayDirection.z];
    let entryDistance = 0, exitDistance = maximumDistance, entryAxis = -1;
    for (let axis = 0; axis < 3; axis++) {
        if ((origins[axis] <= 0 && directions[axis] < 0) ||
            (origins[axis] >= limits[axis] && directions[axis] > 0)) return null;
        if (directions[axis] === 0) {
            if (origins[axis] < 0 || origins[axis] >= limits[axis]) return null;
            continue;
        }
        let nearDistance = -origins[axis] / directions[axis];
        let farDistance = (limits[axis] - origins[axis]) / directions[axis];
        if (nearDistance > farDistance) [nearDistance, farDistance] = [farDistance, nearDistance];
        if (nearDistance > entryDistance) {
            entryDistance = nearDistance;
            entryAxis = axis;
        }
        exitDistance = Math.min(exitDistance, farDistance);
        if (entryDistance > exitDistance) return null;
    }
    const cells = [0, 0, 0], steps = directions.map(component => Math.sign(component));
    const nextDistances = [Infinity, Infinity, Infinity], deltaDistances = [Infinity, Infinity, Infinity];
    const normal = createVector3();
    if (entryAxis === 0) normal.x = -steps[0];
    else if (entryAxis === 1) normal.y = -steps[1];
    else if (entryAxis === 2) normal.z = -steps[2];
    for (let axis = 0; axis < 3; axis++) {
        const coordinate = origins[axis] + directions[axis] * entryDistance;
        cells[axis] = Math.max(0, Math.min(limits[axis] - 1,
            Math.floor(coordinate) - (directions[axis] < 0 && coordinate === Math.floor(coordinate) ? 1 : 0)));
        if (directions[axis] === 0) continue;
        const nextBoundary = cells[axis] + (steps[axis] > 0 ? 1 : 0);
        nextDistances[axis] = (nextBoundary - origins[axis]) / directions[axis];
        deltaDistances[axis] = 1 / Math.abs(directions[axis]);
    }
    let distance = entryDistance;
    while (distance <= exitDistance) {
        const material = world.getMaterial(cells[0], cells[1], cells[2]);
        if (acceptsMaterial(material, cells[0], cells[1], cells[2], distance)) return {
            voxelX: cells[0], voxelY: cells[1], voxelZ: cells[2], material, distance,
            position: createVector3(origin.x + rayDirection.x * distance, origin.y + rayDirection.y * distance,
                origin.z + rayDirection.z * distance),
            normal: createVector3(normal.x, normal.y, normal.z)
        };
        const axis = nextDistances[0] <= nextDistances[1] && nextDistances[0] <= nextDistances[2] ? 0
            : (nextDistances[1] <= nextDistances[2] ? 1 : 2);
        distance = nextDistances[axis];
        nextDistances[axis] += deltaDistances[axis];
        cells[axis] += steps[axis];
        if (cells[axis] < 0 || cells[axis] >= limits[axis]) break;
        normal.x = axis === 0 ? -steps[0] : 0;
        normal.y = axis === 1 ? -steps[1] : 0;
        normal.z = axis === 2 ? -steps[2] : 0;
    }
    return null;
}
