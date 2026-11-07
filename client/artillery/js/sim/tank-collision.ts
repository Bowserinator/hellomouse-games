import { tankCollisionInsetInVoxels, tankHullHeightInVoxels, tankHullLengthInVoxels, tankHullWidthInVoxels,
    worldBoundaryInsetInVoxels, worldHeightInVoxels } from '../config.js';
import { Vector3 } from './math/vector3.js';
import { Tank } from './tank.js';
import { VoxelWorld } from './world/voxel-world.js';

const contactEpsilon = .0000001;
const halfLength = tankHullLengthInVoxels / 2 - tankCollisionInsetInVoxels;
const halfWidth = tankHullWidthInVoxels / 2 - tankCollisionInsetInVoxels;

export function findSupportHeight(world: VoxelWorld, x: number, z: number,
    maximumStandingHeight: number, minimumStandingHeight = 0): number | null {
    const voxelX = Math.floor(x), voxelZ = Math.floor(z);
    for (let y = Math.min(worldHeightInVoxels - 1, Math.floor(maximumStandingHeight - contactEpsilon));
        y >= Math.max(0, Math.ceil(minimumStandingHeight - 1)); y--) {
        if (!world.isSolid(voxelX, y, voxelZ)) continue;
        let isClear = true;
        for (let clearance = 1; clearance <= tankHullHeightInVoxels; clearance++)
            if (world.isSolid(voxelX, y + clearance, voxelZ)) {
                isClear = false;
                break;
            }
        if (isClear) return y + 1;
    }
    return null;
}

export function tankEnvelopesOverlap(position: Vector3, _yaw: number, other: Tank): boolean {
    return position.y + tankHullHeightInVoxels > other.position.y + contactEpsilon &&
        other.position.y + tankHullHeightInVoxels > position.y + contactEpsilon &&
        Math.abs(other.position.x - position.x) < halfWidth * 2 - contactEpsilon &&
        Math.abs(other.position.z - position.z) < halfLength * 2 - contactEpsilon;
}

export function isTankEnvelopeClear(world: VoxelWorld, position: Vector3, yaw: number,
    tanks: ReadonlyArray<Tank> = [], ignoredSeatIndex = -1): boolean {
    const extentX = halfWidth, extentZ = halfLength;
    const maximumHorizontal = world.mapEdgeLengthInVoxels - worldBoundaryInsetInVoxels;
    if (position.y < 0 || position.x - extentX < worldBoundaryInsetInVoxels ||
        position.x + extentX > maximumHorizontal || position.z - extentZ < worldBoundaryInsetInVoxels ||
        position.z + extentZ > maximumHorizontal) return false;
    for (let y = Math.max(0, Math.floor(position.y + contactEpsilon));
        y <= Math.min(worldHeightInVoxels - 1, Math.ceil(position.y + tankHullHeightInVoxels - contactEpsilon) - 1);
        y++)
        for (let z = Math.floor(position.z - extentZ + contactEpsilon);
            z <= Math.ceil(position.z + extentZ - contactEpsilon) - 1; z++)
            for (let x = Math.floor(position.x - extentX + contactEpsilon);
                x <= Math.ceil(position.x + extentX - contactEpsilon) - 1; x++) {
                if (!world.isSolid(x, y, z)) continue;
                return false;
            }
    for (const tank of tanks)
        if (tank.seatIndex !== ignoredSeatIndex && tankEnvelopesOverlap(position, yaw, tank)) return false;
    return true;
}

export function isTankCylinderClear(world: VoxelWorld, position: Vector3,
    tanks: ReadonlyArray<Tank>, ignoredSeatIndex: number): boolean {
    const radius = halfLength;
    const maximum = world.mapEdgeLengthInVoxels - worldBoundaryInsetInVoxels;
    if (position.y < 0 || position.x - radius < worldBoundaryInsetInVoxels ||
        position.z - radius < worldBoundaryInsetInVoxels || position.x + radius > maximum ||
        position.z + radius > maximum) return false;
    for (let y = Math.max(0, Math.floor(position.y + contactEpsilon));
        y < Math.min(worldHeightInVoxels, Math.ceil(position.y + tankHullHeightInVoxels - contactEpsilon)); y++)
        for (let z = Math.floor(position.z - radius); z < Math.ceil(position.z + radius); z++)
            for (let x = Math.floor(position.x - radius); x < Math.ceil(position.x + radius); x++) {
                if (!world.isSolid(x, y, z)) continue;
                const offsetX = Math.max(0, Math.abs(x + .5 - position.x) - .5);
                const offsetZ = Math.max(0, Math.abs(z + .5 - position.z) - .5);
                if (offsetX * offsetX + offsetZ * offsetZ < radius * radius - contactEpsilon) return false;
            }
    for (const other of tanks) {
        if (other.seatIndex === ignoredSeatIndex || position.y + tankHullHeightInVoxels <= other.position.y ||
            other.position.y + tankHullHeightInVoxels <= position.y) continue;
        const offsetX = position.x - other.position.x, offsetZ = position.z - other.position.z;
        if (offsetX * offsetX + offsetZ * offsetZ < radius * radius * 4 - contactEpsilon) return false;
    }
    return true;
}
