import { Vector3, createVector3, normalizeVector } from '../math/vector3.js';
import { VoxelWorld } from './voxel-world.js';

/** Unit vector pointing away from the terrain around a position, or straight up when the area is uniform. */
export function estimateSurfaceNormal(world: VoxelWorld, position: Vector3, radiusInVoxels = 3): Vector3 {
    const centreX = Math.floor(position.x), centreY = Math.floor(position.y), centreZ = Math.floor(position.z);
    const sum = createVector3();
    const reach = Math.ceil(radiusInVoxels);
    for (let y = -reach; y <= reach; y++)
        for (let z = -reach; z <= reach; z++)
            for (let x = -reach; x <= reach; x++) {
                if (x * x + y * y + z * z > radiusInVoxels * radiusInVoxels) continue;
                if (!world.contains(centreX + x, centreY + y, centreZ + z) ||
                    world.isSolid(centreX + x, centreY + y, centreZ + z)) continue;
                sum.x += x; sum.y += y; sum.z += z;
            }
    if (sum.x === 0 && sum.y === 0 && sum.z === 0) return createVector3(0, 1, 0);
    return normalizeVector(createVector3(), sum);
}
