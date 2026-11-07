import type * as T from 'three';
import { chunkRemeshJobsPerFrame, worldChunkEdgeLengthInVoxels, worldHeightInVoxels } from '../config.js';
import { Vector3 } from '../sim/math/vector3.js';
import { ChunkStorage, VoxelChunk, VoxelWorld, getChunkMaterial } from '../sim/world/voxel-world.js';
import { MeshingWorkerPool } from './meshing/meshing-worker-pool.js';
import { paddedChunk } from './meshing/meshing-jobs.js';
import { packedVoxelGeometry } from './voxel-material.js';

interface ChunkMeshState {
    chunk: VoxelChunk;
    borders: Uint32Array;
    sourceVersion: number;
    revision: number;
    isDirty: boolean;
    isInFlight: boolean;
    mesh: T.Mesh | null;
}

export class ChunkManager {
    readonly group = new THREE.Group();
    private readonly states = new Map<VoxelChunk, ChunkMeshState>();
    private readonly centre = new THREE.Vector3();
    private isDisposed = false;

    constructor(private readonly world: VoxelWorld,
        private readonly workers: Pick<MeshingWorkerPool, 'submit' | 'runFallbackBudget'>,
        private readonly material: T.MeshLambertMaterial,
        public includeAmbientOcclusion = true,
        private readonly onError: (error: Error) => void = error => console.error('Terrain meshing failed', error)) {
        const emptyBorders = this.boundaryChecksums({ kind: 'EMPTY' });
        world.forEachChunkInBox(0, 0, 0, world.mapEdgeLengthInVoxels - 1, worldHeightInVoxels - 1,
            world.mapEdgeLengthInVoxels - 1, chunk => {
                const isEmpty = chunk.storage.kind === 'EMPTY';
                this.states.set(chunk, { chunk, borders: isEmpty ? emptyBorders : this.boundaryChecksums(chunk.storage),
                    sourceVersion: chunk.version, revision: 0, isDirty: !isEmpty, isInFlight: false, mesh: null });
            });
    }

    get pendingMeshCount(): number {
        let count = 0;
        for (const state of this.states.values()) if (state.isDirty || state.isInFlight) count++;
        return count;
    }

    update(cameraPosition: Vector3, maximumDrawDistance: number, explosionPosition: Vector3 | null = null): void {
        if (this.isDisposed) return;
        this.detectChanges();
        const queued: Array<ChunkMeshState> = [];
        for (const state of this.states.values()) {
            if (state.isDirty && !state.isInFlight) queued.push(state);
            if (state.mesh !== null) {
                this.chunkCentre(state.chunk, this.centre);
                const distance = Math.sqrt((this.centre.x - cameraPosition.x) ** 2 +
                    (this.centre.y - cameraPosition.y) ** 2 + (this.centre.z - cameraPosition.z) ** 2);
                state.mesh.visible = distance <= maximumDrawDistance;
                state.mesh.renderOrder = this.material.transparent ? -distance : 0;
            }
        }
        const distanceSquared = (state: ChunkMeshState, point: Vector3): number => {
            this.chunkCentre(state.chunk, this.centre);
            return (this.centre.x - point.x) ** 2 + (this.centre.y - point.y) ** 2 +
                (this.centre.z - point.z) ** 2;
        };
        queued.sort((first, second) => {
            if (explosionPosition !== null) {
                const priority = distanceSquared(first, explosionPosition) - distanceSquared(second, explosionPosition);
                if (priority !== 0) return priority;
            }
            return distanceSquared(first, cameraPosition) - distanceSquared(second, cameraPosition);
        });
        for (let index = 0; index < Math.min(chunkRemeshJobsPerFrame, queued.length); index++)
            this.remesh(queued[index]);
        this.workers.runFallbackBudget();
    }

    invalidateAll(): void {
        for (const state of this.states.values()) {
            state.revision++;
            state.isDirty = true;
        }
    }

    dispose(): void {
        this.isDisposed = true;
        for (const state of this.states.values()) state.mesh?.geometry.dispose();
        this.group.clear();
        this.states.clear();
    }

    private detectChanges(): void {
        for (const state of this.states.values()) {
            const chunk = state.chunk;
            if (state.sourceVersion === chunk.version) continue;
            state.sourceVersion = chunk.version;
            const borders = this.boundaryChecksums(chunk.storage);
            let changedFaces = 0;
            for (let face = 0; face < 6; face++)
                if (state.borders[face] !== borders[face]) changedFaces |= 1 << face;
            state.borders = borders;
            for (let offsetY = -1; offsetY <= 1; offsetY++)
                for (let offsetZ = -1; offsetZ <= 1; offsetZ++)
                    for (let offsetX = -1; offsetX <= 1; offsetX++) {
                        if (offsetX !== 0 && (changedFaces & (offsetX > 0 ? 1 : 2)) === 0 ||
                            offsetY !== 0 && (changedFaces & (offsetY > 0 ? 4 : 8)) === 0 ||
                            offsetZ !== 0 && (changedFaces & (offsetZ > 0 ? 16 : 32)) === 0) continue;
                        const neighbour = this.world.getChunk(chunk.chunkX + offsetX, chunk.chunkY + offsetY,
                            chunk.chunkZ + offsetZ);
                        const affected = neighbour === null ? undefined : this.states.get(neighbour);
                        if (affected === undefined || affected.mesh === null &&
                            affected.chunk.storage.kind === 'EMPTY') continue;
                        affected.revision++;
                        affected.isDirty = true;
                    }
        }
    }

    private remesh(state: ChunkMeshState): void {
        const chunk = state.chunk, revision = state.revision;
        const neighbours: Array<readonly [VoxelChunk, number]> = [];
        const edge = worldChunkEdgeLengthInVoxels;
        this.world.forEachChunkInBox((chunk.chunkX - 1) * edge, (chunk.chunkY - 1) * edge, (chunk.chunkZ - 1) * edge,
            (chunk.chunkX + 2) * edge - 1, (chunk.chunkY + 2) * edge - 1, (chunk.chunkZ + 2) * edge - 1,
            neighbour => neighbours.push([neighbour, neighbour.version]));
        state.isInFlight = true;
        state.isDirty = false;
        void this.workers.submit({ kind: 'meshChunk', chunkVersion: revision,
            input: paddedChunk(this.world, chunk.chunkX, chunk.chunkY, chunk.chunkZ, this.includeAmbientOcclusion) })
            .then(result => {
                if (this.isDisposed) return;
                state.isInFlight = false;
                if (result.kind !== 'meshChunk' || result.chunkVersion !== state.revision ||
                    neighbours.some(([neighbour, version]) => neighbour.version !== version)) {
                    state.isDirty = true;
                    return;
                }
                const previous = state.mesh;
                if (result.mesh.indices.length === 0) {
                    if (previous !== null) this.group.remove(previous);
                    state.mesh = null;
                } else {
                    const mesh = new THREE.Mesh(packedVoxelGeometry(result.mesh), this.material);
                    mesh.position.set(chunk.chunkX * worldChunkEdgeLengthInVoxels,
                        chunk.chunkY * worldChunkEdgeLengthInVoxels, chunk.chunkZ * worldChunkEdgeLengthInVoxels);
                    mesh.castShadow = mesh.receiveShadow = true;
                    if (previous !== null) this.group.remove(previous);
                    this.group.add(mesh);
                    state.mesh = mesh;
                }
                previous?.geometry.dispose();
            }).catch(error => {
                if (this.isDisposed) return;
                state.isInFlight = false;
                state.isDirty = true;
                this.onError(error instanceof Error ? error : new Error(String(error)));
            });
    }

    private chunkCentre(chunk: VoxelChunk, target: T.Vector3): void {
        target.set((chunk.chunkX + .5) * worldChunkEdgeLengthInVoxels,
            (chunk.chunkY + .5) * worldChunkEdgeLengthInVoxels, (chunk.chunkZ + .5) * worldChunkEdgeLengthInVoxels);
    }

    private boundaryChecksums(storage: ChunkStorage): Uint32Array {
        const checksums = new Uint32Array(6), coordinate = [0, 0, 0], edge = worldChunkEdgeLengthInVoxels;
        for (let face = 0; face < 6; face++) {
            const axis = Math.floor(face / 2), tangent = (axis + 1) % 3, other = (axis + 2) % 3;
            coordinate[axis] = face % 2 === 0 ? edge - 1 : 0;
            let checksum = 0x811c9dc5;
            for (let row = 0; row < edge; row++) for (let column = 0; column < edge; column++) {
                coordinate[tangent] = column;
                coordinate[other] = row;
                checksum = Math.imul(checksum ^ getChunkMaterial(storage, coordinate[0], coordinate[1], coordinate[2]),
                    0x01000193) >>> 0;
            }
            checksums[face] = checksum;
        }
        return checksums;
    }
}
