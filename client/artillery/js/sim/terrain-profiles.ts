import { simulationTicksPerSecond, terrainRemovedVoxelSampleLimit } from '../config.js';
import { exponentialApproximation, naturalLogarithmApproximation } from './math/deterministic-math.js';
import { Vector3, createVector3, normalizeVector } from './math/vector3.js';
import { TerrainOverrides, TerrainProfile } from './weapon-types.js';
import { Material } from './world/material-table.js';
import { BlastShell, ShapedBlast, TerrainEditResult, addFunnel, addHollowDome, addSphere, carveCapsule, carveCylinder,
    carveLineAlongRay, carveRavine, carveShapedBlast, carveSphere, liftColumn,
    scorchSurface } from './world/terrain-edit.js';
import { VoxelChunk, VoxelWorld } from './world/voxel-world.js';

export function applyTerrainProfile(world: VoxelWorld, profile: TerrainProfile, position: Vector3,
    direction: Vector3, seed: number, overrides: TerrainOverrides = {}): TerrainEditResult {
    const forward = normalizeVector(createVector3(), direction);
    const results = profile.operations.map((original, operationIndex): TerrainEditResult => {
        const operation = { ...original, ...overrides };
        const offset = operation.offset ?? [0, 0, 0];
        const center = createVector3(position.x + offset[0], position.y + offset[1], position.z + offset[2]);
        const endpoint = createVector3(center.x + forward.x * (operation.lengthInVoxels ?? 0),
            center.y + forward.y * (operation.lengthInVoxels ?? 0),
            center.z + forward.z * (operation.lengthInVoxels ?? 0));
        const material = operation.materialIdentifier === undefined ? undefined
            : Material[operation.materialIdentifier as keyof typeof Material];
        switch (operation.operation) {
            case 'carveSphere': return carveSphere(world, center, operation.radiusInVoxels!);
            case 'carveShapedBlast': return carveShapedBlast(world, center, operation.radiusInVoxels!, {
                seed: seed + operationIndex, irregularityFraction: operation.irregularityFraction,
                noiseFrequency: operation.noiseFrequency, rayCount: operation.rayCount,
                rayLengthInVoxels: operation.rayLengthInVoxels, rayAngularSharpness: operation.rayAngularSharpness,
                rippleRingCount: operation.rippleRingCount, rippleSpacingInVoxels: operation.rippleSpacingInVoxels
            });
            case 'addSphere': return addSphere(world, center, operation.radiusInVoxels!, material);
            case 'carveCapsule': return carveCapsule(world, center, endpoint, operation.radiusInVoxels!);
            case 'carveLineAlongRay': return carveLineAlongRay(world, center, forward,
                operation.lengthInVoxels!, operation.radiusInVoxels!);
            case 'carveCylinder':
                if (forward.y < 0) center.y -= operation.heightInVoxels!;
                return carveCylinder(world, center, operation.radiusInVoxels!, operation.heightInVoxels!);
            case 'carveRavine': return carveRavine(world, center, endpoint, operation.widthInVoxels! / 2,
                operation.heightInVoxels!, seed + operationIndex);
            case 'addHollowDome': return addHollowDome(world, center, operation.radiusInVoxels!,
                operation.thicknessInVoxels!, material);
            case 'addFunnel': return addFunnel(world, center, operation.radiusInVoxels!, operation.heightInVoxels!,
                operation.thicknessInVoxels!, operation.spreadDegrees!, material);
            case 'liftColumn':
                center.y -= operation.thicknessInVoxels!;
                return liftColumn(world, center, operation.radiusInVoxels!, Math.round(operation.heightInVoxels!),
                    Math.round(operation.thicknessInVoxels!));
            case 'scorch': return scorchSurface(world, center, operation.radiusInVoxels!, material);
        }
    });
    return mergeTerrainResults(results);
}

export function mergeTerrainResults(results: ReadonlyArray<TerrainEditResult>): TerrainEditResult {
    const result: TerrainEditResult = { removedCount: 0, addedCount: 0, removedVoxelSamples: [], touchedChunks: [] };
    const touched = new Set<VoxelChunk>();
    for (const edit of results) {
        result.removedCount += edit.removedCount;
        result.addedCount += edit.addedCount;
        result.removedVoxelSamples.push(...edit.removedVoxelSamples.slice(0,
            terrainRemovedVoxelSampleLimit - result.removedVoxelSamples.length));
        for (const chunk of edit.touchedChunks)
            if (!touched.has(chunk)) {
                touched.add(chunk);
                result.touchedChunks.push(chunk);
            }
    }
    return result;
}

/** One round part of a terrain edit that can be applied a layer at a time. */
interface LayeredOperation {
    reachInVoxels: number;
    carveLayer(world: VoxelWorld, shell: BlastShell): TerrainEditResult;
    finish?(world: VoxelWorld): TerrainEditResult;
}

function cubeRoot(value: number): number {
    return value <= 0 ? 0 : exponentialApproximation(naturalLogarithmApproximation(value) / 3);
}

/** A terrain edit that grows outwards from its centre, removing one equal-volume layer per tick. */
export class ProgressiveTerrainEdit {
    private layerIndex = 0;
    private readonly operations: Array<LayeredOperation> = [];
    public readonly layerCount: number;

    constructor(profile: TerrainProfile, position: Vector3, seed: number, overrides: TerrainOverrides = {}) {
        this.layerCount = Math.max(1, Math.ceil((profile.durationSeconds ?? 0) * simulationTicksPerSecond));
        profile.operations.forEach((original, operationIndex) => {
            const operation = { ...original, ...overrides };
            const offset = operation.offset ?? [0, 0, 0];
            const center = createVector3(position.x + offset[0], position.y + offset[1], position.z + offset[2]);
            const material = operation.materialIdentifier === undefined ? undefined
                : Material[operation.materialIdentifier as keyof typeof Material];
            if (operation.operation === 'carveShapedBlast') {
                const blast = new ShapedBlast(center, operation.radiusInVoxels!, {
                    seed: seed + operationIndex, irregularityFraction: operation.irregularityFraction,
                    noiseFrequency: operation.noiseFrequency, rayCount: operation.rayCount,
                    rayLengthInVoxels: operation.rayLengthInVoxels, rayAngularSharpness: operation.rayAngularSharpness,
                    rippleRingCount: operation.rippleRingCount,
                    rippleSpacingInVoxels: operation.rippleSpacingInVoxels });
                this.operations.push({ reachInVoxels: blast.reachInVoxels,
                    carveLayer: (world, shell) => blast.carve(world, shell), finish: world => blast.ripple(world) });
            } else if (operation.operation === 'carveSphere' || operation.operation === 'addSphere') {
                const radius = operation.radiusInVoxels!;
                this.operations.push({ reachInVoxels: radius, carveLayer: (world, shell) =>
                    operation.operation === 'carveSphere' ? carveSphere(world, center, radius, shell)
                        : addSphere(world, center, radius, material, shell) });
            } else throw new Error(`Terrain operation ${operation.operation} cannot be spread over time`);
        });
    }

    public get isFinished(): boolean {
        return this.layerIndex >= this.layerCount;
    }

    public get progress(): number {
        return this.layerIndex;
    }

    /** Applies the next layer, and the finishing touches after the last one. */
    public advance(world: VoxelWorld): TerrainEditResult {
        const index = this.layerIndex++, isLast = index === this.layerCount - 1;
        const results = this.operations.map(operation => {
            const outer = isLast ? Infinity : operation.reachInVoxels * cubeRoot((index + 1) / this.layerCount);
            const inner = index === 0 ? 0 : operation.reachInVoxels * cubeRoot(index / this.layerCount);
            const layer = operation.carveLayer(world, { innerRadius: inner, outerRadius: outer });
            return isLast && operation.finish ? mergeTerrainResults([layer, operation.finish(world)]) : layer;
        });
        return mergeTerrainResults(results);
    }
}
