import { worldHeightInVoxels } from './config.js';
import { MeshingWorkerPool } from './render/meshing/meshing-worker-pool.js';
import { BiomeRule } from './sim/world/biomes.js';
import { battlefieldAttempts, GeneratedBattlefield, SpawnSeat } from './sim/world/spawn.js';
import { VoxelWorld } from './sim/world/voxel-world.js';
import { WorldGenerator } from './sim/world/world-generator.js';

export async function loadWorld(generator: WorldGenerator, biomeRules: ReadonlyArray<Readonly<BiomeRule>>,
    pool: MeshingWorkerPool, onProgress: (completed: number, total: number) => void,
    signal?: AbortSignal): Promise<VoxelWorld> {
    if (signal?.aborted) throw new DOMException('Loading was cancelled', 'AbortError');
    const edge = generator.mapEdgeLengthInVoxels, world = new VoxelWorld(edge);
    const total = world.chunksPerHorizontalEdge ** 2 * world.chunksPerVerticalEdge;
    const jobs: Array<Promise<void>> = [];
    let completed = 0;
    onProgress(completed, total);
    world.forEachChunkInBox(0, 0, 0, edge - 1, worldHeightInVoxels - 1, edge - 1, chunk => {
        jobs.push(pool.submit({ kind: 'generateChunk', chunkVersion: 0,
            matchSeed: generator.matchSeed, mapEdgeLengthInVoxels: edge,
            chunkX: chunk.chunkX, chunkY: chunk.chunkY, chunkZ: chunk.chunkZ, biomeRules }).then(result => {
            if (signal?.aborted) throw new DOMException('Loading was cancelled', 'AbortError');
            if (result.kind !== 'generateChunk') throw new Error('Worker returned the wrong result type');
            world.installChunk(chunk.chunkX, chunk.chunkY, chunk.chunkZ, result.storage);
            onProgress(++completed, total);
        }));
    });
    await Promise.all(jobs);
    return world;
}

export interface GenerationProgress {
    completed: number;
    total: number;
    attempt: number;
}

export async function loadBattlefield(matchSeed: number, mapEdgeLengthInVoxels: number,
    biomeRules: ReadonlyArray<Readonly<BiomeRule>>, seats: ReadonlyArray<SpawnSeat>,
    onProgress: (progress: GenerationProgress) => void, signal?: AbortSignal): Promise<GeneratedBattlefield> {
    if (signal?.aborted) throw new DOMException('Loading was cancelled', 'AbortError');
    const pool = new MeshingWorkerPool();
    const abort = (): void => pool.dispose();
    signal?.addEventListener('abort', abort, { once: true });
    let frame: number | null = null;
    const pump = (): void => {
        pool.runFallbackBudget();
        frame = requestAnimationFrame(pump);
    };
    try {
        frame = requestAnimationFrame(pump);
        const attempts = battlefieldAttempts(matchSeed, mapEdgeLengthInVoxels, biomeRules, seats);
        let step = attempts.next(), attempt = 0;
        while (!step.done) {
            attempt++;
            const world = await loadWorld(step.value, biomeRules, pool, (completed, total) =>
                onProgress({ completed, total, attempt }), signal);
            if (signal?.aborted) throw new DOMException('Loading was cancelled', 'AbortError');
            step = attempts.next(world);
        }
        return step.value;
    } catch (error) {
        if (signal?.aborted) throw new DOMException('Loading was cancelled', 'AbortError');
        throw error;
    } finally {
        if (frame !== null) cancelAnimationFrame(frame);
        signal?.removeEventListener('abort', abort);
        pool.dispose();
    }
}
