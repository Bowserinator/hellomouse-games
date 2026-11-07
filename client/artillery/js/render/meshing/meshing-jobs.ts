import { worldChunkEdgeLengthInVoxels, worldHeightInVoxels } from '../../config.js';
import { WorldTheme } from '../../sim/world/themes.js';
import { ChunkStorage, VoxelWorld } from '../../sim/world/voxel-world.js';
import { WorldGenerator } from '../../sim/world/world-generator.js';
import { meshChunk, MeshingInput, PackedVoxelMesh } from './greedy-mesher.js';

export type MeshingRequest = {
    kind: 'meshChunk';
    chunkVersion: number;
    input: MeshingInput;
} | {
    kind: 'generateChunk';
    chunkVersion: number;
    matchSeed: number;
    mapEdgeLengthInVoxels: number;
    chunkX: number;
    chunkY: number;
    chunkZ: number;
    theme: Readonly<WorldTheme>;
};
export type MeshingJob = MeshingRequest & { jobIdentifier: number };
export type MeshingResult = {
    kind: 'meshChunk';
    jobIdentifier: number;
    chunkVersion: number;
    mesh: PackedVoxelMesh;
} | {
    kind: 'generateChunk';
    jobIdentifier: number;
    chunkVersion: number;
    storage: ChunkStorage;
};
export interface MeshingFailure {
    kind: 'error';
    jobIdentifier: number;
    message: string;
}

export function paddedChunk(world: VoxelWorld, chunkX: number, chunkY: number, chunkZ: number,
    includeAmbientOcclusion = true): MeshingInput {
    if (world.getChunk(chunkX, chunkY, chunkZ) === null) throw new RangeError('Chunk is outside the world');
    const edge = worldChunkEdgeLengthInVoxels, paddedEdge = edge + 2;
    const originX = chunkX * edge, originY = chunkY * edge, originZ = chunkZ * edge;
    const voxels = new Uint8Array(paddedEdge * paddedEdge * paddedEdge);
    for (let y = -1; y <= edge; y++) for (let z = -1; z <= edge; z++) for (let x = -1; x <= edge; x++)
        voxels[x + 1 + paddedEdge * (z + 1 + paddedEdge * (y + 1))] =
            world.getMaterial(originX + x, originY + y, originZ + z);
    let omittedFaceMask = 0;
    if (originX + edge === world.mapEdgeLengthInVoxels) omittedFaceMask |= 1;
    if (originX === 0) omittedFaceMask |= 2;
    if (originY + edge === worldHeightInVoxels) omittedFaceMask |= 4;
    if (originY === 0) omittedFaceMask |= 8;
    if (originZ + edge === world.mapEdgeLengthInVoxels) omittedFaceMask |= 16;
    if (originZ === 0) omittedFaceMask |= 32;
    return { voxels, size: [edge, edge, edge], omittedFaceMask, includeAmbientOcclusion };
}

export class MeshingJobProcessor {
    private generationKey = '';
    private generator: WorldGenerator | null = null;

    run(job: MeshingJob): MeshingResult {
        if (job.kind === 'meshChunk') return { kind: 'meshChunk', jobIdentifier: job.jobIdentifier,
            chunkVersion: job.chunkVersion, mesh: meshChunk(job.input) };
        const key = `${job.matchSeed}:${job.mapEdgeLengthInVoxels}:${job.theme.identifier}`;
        if (this.generator === null || key !== this.generationKey) {
            this.generator = new WorldGenerator(job.matchSeed, job.mapEdgeLengthInVoxels, job.theme);
            this.generationKey = key;
        }
        return { kind: 'generateChunk', jobIdentifier: job.jobIdentifier, chunkVersion: job.chunkVersion,
            storage: this.generator.generateChunk(job.chunkX, job.chunkY, job.chunkZ) };
    }
}

export function meshingResultTransfers(result: MeshingResult): Array<ArrayBuffer> {
    if (result.kind === 'meshChunk') return [result.mesh.positions.buffer,
        result.mesh.information.buffer, result.mesh.indices.buffer];
    return result.storage.kind === 'DENSE' ? [result.storage.voxels.buffer] : [];
}
