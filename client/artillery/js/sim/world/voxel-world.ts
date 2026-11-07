import { worldChunkEdgeLengthInVoxels, worldHeightInVoxels,
    worldIndestructibleMaximumLayerIndex } from '../../config.js';
import { StateHash } from '../math/hash.js';
import { Material, MaterialFlag, materialTable } from './material-table.js';

const chunkEdge = worldChunkEdgeLengthInVoxels;
export const chunkVoxelCount = chunkEdge * chunkEdge * chunkEdge;

export type ChunkStorage =
    { kind: 'EMPTY' } |
    { kind: 'UNIFORM'; material: Material } |
    { kind: 'LAYERED'; material: Material; height: number } |
    { kind: 'DENSE'; voxels: Uint8Array };

export interface VoxelChunk {
    readonly chunkX: number;
    readonly chunkY: number;
    readonly chunkZ: number;
    storage: ChunkStorage;
    version: number;
    isChecksumDirty: boolean;
    checksum: number;
}

export function getChunkMaterial(storage: ChunkStorage, x: number, y: number, z: number): Material {
    switch (storage.kind) {
        case 'EMPTY': return Material.AIR;
        case 'UNIFORM': return storage.material;
        case 'LAYERED': return y < storage.height ? storage.material : Material.AIR;
        case 'DENSE': return storage.voxels[x + chunkEdge * (z + chunkEdge * y)];
    }
}

export function compactChunk(voxels: Uint8Array): ChunkStorage {
    if (voxels.length !== chunkVoxelCount) throw new RangeError('Invalid chunk voxel count');
    const material = voxels[0];
    let firstDifferentIndex = 1;
    while (firstDifferentIndex < chunkVoxelCount && voxels[firstDifferentIndex] === material) firstDifferentIndex++;
    if (firstDifferentIndex === chunkVoxelCount)
        return material === Material.AIR ? { kind: 'EMPTY' } : { kind: 'UNIFORM', material };
    const layerArea = chunkEdge * chunkEdge;
    if (material !== Material.AIR && firstDifferentIndex % layerArea === 0) {
        let remainingIndex = firstDifferentIndex;
        while (remainingIndex < chunkVoxelCount && voxels[remainingIndex] === Material.AIR) remainingIndex++;
        if (remainingIndex === chunkVoxelCount)
            return { kind: 'LAYERED', material, height: firstDifferentIndex / layerArea };
    }
    return { kind: 'DENSE', voxels };
}

export class VoxelWorld {
    public readonly chunksPerHorizontalEdge: number;
    public readonly chunksPerVerticalEdge = worldHeightInVoxels / chunkEdge;
    private readonly chunks: Array<VoxelChunk>;

    constructor(public readonly mapEdgeLengthInVoxels: number) {
        if (!Number.isSafeInteger(mapEdgeLengthInVoxels) || mapEdgeLengthInVoxels < chunkEdge ||
            mapEdgeLengthInVoxels % chunkEdge !== 0)
            throw new RangeError('World edge must be a positive multiple of the chunk edge');
        this.chunksPerHorizontalEdge = mapEdgeLengthInVoxels / chunkEdge;
        this.chunks = [];
        for (let chunkY = 0; chunkY < this.chunksPerVerticalEdge; chunkY++)
            for (let chunkZ = 0; chunkZ < this.chunksPerHorizontalEdge; chunkZ++)
                for (let chunkX = 0; chunkX < this.chunksPerHorizontalEdge; chunkX++)
                    this.chunks.push({ chunkX, chunkY, chunkZ, storage: { kind: 'EMPTY' },
                        version: 0, isChecksumDirty: true, checksum: 0 });
    }

    public get denseMemoryInBytes(): number {
        let bytes = 0;
        for (const chunk of this.chunks)
            if (chunk.storage.kind === 'DENSE') bytes += chunk.storage.voxels.byteLength;
        return bytes;
    }

    public getChunk(chunkX: number, chunkY: number, chunkZ: number): VoxelChunk | null {
        if (!Number.isInteger(chunkX) || !Number.isInteger(chunkY) || !Number.isInteger(chunkZ) ||
            chunkX < 0 || chunkY < 0 || chunkZ < 0 || chunkX >= this.chunksPerHorizontalEdge ||
            chunkY >= this.chunksPerVerticalEdge || chunkZ >= this.chunksPerHorizontalEdge) return null;
        return this.chunks[chunkX + this.chunksPerHorizontalEdge *
            (chunkZ + this.chunksPerHorizontalEdge * chunkY)];
    }

    public contains(x: number, y: number, z: number): boolean {
        return Number.isInteger(x) && Number.isInteger(y) && Number.isInteger(z) &&
            x >= 0 && y >= 0 && z >= 0 && x < this.mapEdgeLengthInVoxels &&
            z < this.mapEdgeLengthInVoxels && y < worldHeightInVoxels;
    }

    public getMaterial(x: number, y: number, z: number): Material {
        if (!this.contains(x, y, z)) return Material.AIR;
        const chunk = this.getChunk(Math.floor(x / chunkEdge), Math.floor(y / chunkEdge), Math.floor(z / chunkEdge));
        return getChunkMaterial(chunk!.storage, x % chunkEdge, y % chunkEdge, z % chunkEdge);
    }

    public isSolid(x: number, y: number, z: number): boolean {
        return (materialTable[this.getMaterial(x, y, z)].flags & MaterialFlag.SOLID) !== 0;
    }

    /** Height of the tallest solid voxel in a column at or above the minimum, or -1 if the column has none. */
    public highestSolidY(x: number, z: number, minimumY = 0): number {
        if (!this.contains(x, 0, z)) return -1;
        const chunkX = Math.floor(x / chunkEdge), chunkZ = Math.floor(z / chunkEdge);
        for (let chunkY = this.chunksPerVerticalEdge - 1;
            chunkY >= 0 && (chunkY + 1) * chunkEdge > minimumY; chunkY--) {
            const storage = this.getChunk(chunkX, chunkY, chunkZ)!.storage;
            if (storage.kind === 'EMPTY') continue;
            const topLocalY = storage.kind === 'LAYERED' ? storage.height - 1 : chunkEdge - 1;
            for (let localY = topLocalY; localY >= 0 && chunkY * chunkEdge + localY >= minimumY; localY--)
                if ((materialTable[getChunkMaterial(storage, x % chunkEdge, localY, z % chunkEdge)].flags &
                    MaterialFlag.SOLID) !== 0) return chunkY * chunkEdge + localY;
        }
        return -1;
    }

    public installChunk(chunkX: number, chunkY: number, chunkZ: number, storage: ChunkStorage): void {
        const chunk = this.getChunk(chunkX, chunkY, chunkZ);
        if (!chunk) throw new RangeError('Chunk lies outside the world');
        if (storage.kind === 'DENSE' && (storage.voxels.length !== chunkVoxelCount ||
            storage.voxels.some(material => material >= materialTable.length)))
            throw new RangeError('Invalid dense chunk');
        if ((storage.kind === 'LAYERED' || storage.kind === 'UNIFORM') &&
            (!Number.isInteger(storage.material) || !materialTable[storage.material]))
            throw new RangeError('Invalid chunk material');
        if (storage.kind === 'LAYERED' && (!Number.isInteger(storage.height) ||
            storage.height < 0 || storage.height > chunkEdge)) throw new RangeError('Invalid layer height');
        chunk.storage = storage;
        chunk.version++;
        chunk.isChecksumDirty = true;
    }

    public setMaterial(x: number, y: number, z: number, material: Material): boolean {
        if (!Number.isInteger(material) || !materialTable[material]) throw new RangeError('Invalid voxel material');
        if (!this.contains(x, y, z) || y <= worldIndestructibleMaximumLayerIndex) return false;
        const previous = this.getMaterial(x, y, z);
        if (previous === material || materialTable[previous].isIndestructible) return false;
        const chunk = this.getChunk(Math.floor(x / chunkEdge), Math.floor(y / chunkEdge), Math.floor(z / chunkEdge))!;
        this.denseVoxels(chunk)[x % chunkEdge + chunkEdge * (z % chunkEdge + chunkEdge * (y % chunkEdge))] = material;
        this.markChunkEdited(chunk);
        return true;
    }

    /** The chunk's per-voxel storage, which callers may write to directly before calling markChunkEdited. */
    public denseVoxels(chunk: VoxelChunk): Uint8Array {
        if (chunk.storage.kind === 'DENSE') return chunk.storage.voxels;
        const voxels = new Uint8Array(chunkVoxelCount);
        for (let localY = 0; localY < chunkEdge; localY++) {
            const fillMaterial = getChunkMaterial(chunk.storage, 0, localY, 0);
            voxels.fill(fillMaterial, localY * chunkEdge * chunkEdge, (localY + 1) * chunkEdge * chunkEdge);
        }
        chunk.storage = { kind: 'DENSE', voxels };
        return voxels;
    }

    public markChunkEdited(chunk: VoxelChunk): void {
        chunk.version++;
        chunk.isChecksumDirty = true;
    }

    public forEachChunkInBox(minimumX: number, minimumY: number, minimumZ: number,
        maximumX: number, maximumY: number, maximumZ: number, visit: (chunk: VoxelChunk) => void): void {
        const startX = Math.max(0, Math.floor(minimumX / chunkEdge));
        const startY = Math.max(0, Math.floor(minimumY / chunkEdge));
        const startZ = Math.max(0, Math.floor(minimumZ / chunkEdge));
        const endX = Math.min(this.chunksPerHorizontalEdge - 1, Math.floor(maximumX / chunkEdge));
        const endY = Math.min(this.chunksPerVerticalEdge - 1, Math.floor(maximumY / chunkEdge));
        const endZ = Math.min(this.chunksPerHorizontalEdge - 1, Math.floor(maximumZ / chunkEdge));
        for (let chunkY = startY; chunkY <= endY; chunkY++)
            for (let chunkZ = startZ; chunkZ <= endZ; chunkZ++)
                for (let chunkX = startX; chunkX <= endX; chunkX++) visit(this.getChunk(chunkX, chunkY, chunkZ)!);
    }

    public chunkChecksum(chunk: VoxelChunk): number {
        if (!chunk.isChecksumDirty) return chunk.checksum;
        const hash = new StateHash();
        if (chunk.storage.kind === 'DENSE') hash.bytes(chunk.storage.voxels);
        else
            for (let localY = 0; localY < chunkEdge; localY++) {
                const material = getChunkMaterial(chunk.storage, 0, localY, 0);
                for (let column = 0; column < chunkEdge * chunkEdge; column++) hash.byte(material);
            }

        chunk.checksum = hash.value;
        chunk.isChecksumDirty = false;
        return chunk.checksum;
    }

    /** Computes outstanding chunk checksums until the time budget runs out, and reports whether all are current. */
    public refreshChecksums(budgetInMilliseconds: number): boolean {
        const deadline = performance.now() + budgetInMilliseconds;
        for (const chunk of this.chunks) {
            if (!chunk.isChecksumDirty) continue;
            this.chunkChecksum(chunk);
            if (performance.now() >= deadline) return false;
        }
        return true;
    }

    public appendHash(hash: StateHash): void {
        hash.unsignedInteger(this.mapEdgeLengthInVoxels);
        for (const chunk of this.chunks) hash.unsignedInteger(this.chunkChecksum(chunk));
    }
}
