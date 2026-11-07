import { explosionDefaultIrregularityFraction, terrainRemovedVoxelSampleLimit,
    terrainRavineMinimumWidthFraction, terrainRavineWidthNoiseFrequency,
    worldChunkEdgeLengthInVoxels, worldHeightInVoxels, worldIndestructibleMaximumLayerIndex } from '../../config.js';
import { RemovedVoxelSample } from '../../types.js';
import { Rng } from '../../../../shared/ts/seeded-random.js';
import { valueNoise } from '../../../../shared/ts/value-noise.js';
import { exponentialApproximation, naturalLogarithmApproximation } from '../math/deterministic-math.js';
import { Vector3, createVector3, normalizeVector } from '../math/vector3.js';
import { Material, MaterialFlag, blastResistanceOf, materialTable, underwaterMaterial } from './material-table.js';
import { visitVoxelsAlongRay } from './voxel-raycast.js';
import { VoxelChunk, VoxelWorld, getChunkMaterial } from './voxel-world.js';

// Shrinks guaranteed-carve zones slightly so rounding can never carve a voxel the full test would keep
const carveCoreSafetyFraction = .999;

/** Voxels within the radius, scaled down by their material's blast resistance, are carved without further tests. */
interface CarveCore {
    center: Vector3;
    radius: number;
}

/** Limits an edit to voxels whose centres lie in a round volume, so nothing outside it is even examined. */
interface RegionBounds {
    center: Vector3;
    radius: number;
    /** Measures distance across the ground only, which turns the sphere into an upright cylinder. */
    ignoresHeight?: boolean;
    /** Voxels nearer than this are left alone. */
    innerRadius?: number;
}

/** A spherical layer of a blast, measured from its centre. */
export interface BlastShell {
    innerRadius: number;
    outerRadius: number;
}

// Absorbs rounding so a voxel exactly on the boundary is never skipped by the cheap tests
const boundsMargin = 1e-6;

export interface TerrainEditResult {
    removedCount: number;
    addedCount: number;
    removedVoxelSamples: Array<RemovedVoxelSample>;
    touchedChunks: Array<VoxelChunk>;
}

export interface ShapedBlastOptions {
    seed: number;
    irregularityFraction?: number;
    noiseFrequency?: number;
    rayCount?: number;
    rayLengthInVoxels?: number;
    rayAngularSharpness?: number;
    rippleRingCount?: number;
    rippleSpacingInVoxels?: number;
}

/** Decides whether a voxel at the given distance-like value is edited, given the material's threshold. */
type NormalizedDistance = (x: number, y: number, z: number, threshold: number) => number;

function boxOverlapsBounds(baseX: number, baseY: number, baseZ: number, edge: number,
    bounds: RegionBounds): boolean {
    let nearest = 0, farthest = 0;
    for (let axis = 0; axis < 3; axis++) {
        if (axis === 1 && bounds.ignoresHeight) continue;
        const low = axis === 0 ? baseX : axis === 1 ? baseY : baseZ;
        const centre = axis === 0 ? bounds.center.x : axis === 1 ? bounds.center.y : bounds.center.z;
        const high = low + edge;
        const gap = centre < low ? low - centre : centre > high ? centre - high : 0;
        const reach = Math.max(Math.abs(centre - low), Math.abs(centre - high));
        nearest += gap * gap;
        farthest += reach * reach;
    }
    const outer = bounds.radius + boundsMargin, inner = bounds.innerRadius ?? 0;
    return nearest <= outer * outer && farthest >= inner * inner;
}

class TerrainEdit {
    public readonly result: TerrainEditResult = {
        removedCount: 0, addedCount: 0, removedVoxelSamples: [], touchedChunks: []
    };
    private readonly touched = new Set<VoxelChunk>();
    private sampleStride = 1;

    constructor(private readonly world: VoxelWorld) {}

    public set(x: number, y: number, z: number, material: Material): void {
        const previous = this.world.getMaterial(x, y, z);
        material = underwaterMaterial(material, y);
        if (!this.world.setMaterial(x, y, z, material)) return;
        if (previous !== Material.AIR) {
            this.result.removedCount++;
            this.sampleRemoved(x, y, z, previous);
        }
        if (material !== Material.AIR) this.result.addedCount++;
        const edge = worldChunkEdgeLengthInVoxels;
        this.touch(this.world.getChunk(Math.floor(x / edge), Math.floor(y / edge), Math.floor(z / edge))!);
    }

    private touch(chunk: VoxelChunk): void {
        if (this.touched.has(chunk)) return;
        this.touched.add(chunk);
        this.result.touchedChunks.push(chunk);
    }

    public region(minimum: Vector3, maximum: Vector3, normalizedDistance: NormalizedDistance,
        material = Material.AIR, core?: CarveCore, bounds?: RegionBounds): void {
        const edge = worldChunkEdgeLengthInVoxels;
        const startX = Math.max(0, Math.floor(minimum.x));
        const endX = Math.min(this.world.mapEdgeLengthInVoxels - 1, Math.floor(maximum.x));
        const startY = Math.max(worldIndestructibleMaximumLayerIndex + 1, Math.floor(minimum.y));
        const endY = Math.min(worldHeightInVoxels - 1, Math.floor(maximum.y));
        const startZ = Math.max(0, Math.floor(minimum.z));
        const endZ = Math.min(this.world.mapEdgeLengthInVoxels - 1, Math.floor(maximum.z));
        const isCarving = material === Material.AIR;
        const carveCore = isCarving ? core : undefined;
        const outerSquared = bounds ? (bounds.radius + boundsMargin) * (bounds.radius + boundsMargin) : Infinity;
        const innerSquared = bounds?.innerRadius ? bounds.innerRadius * bounds.innerRadius : 0;
        for (let chunkY = Math.floor(startY / edge); chunkY <= Math.floor(endY / edge); chunkY++)
            for (let chunkZ = Math.floor(startZ / edge); chunkZ <= Math.floor(endZ / edge); chunkZ++)
                for (let chunkX = Math.floor(startX / edge); chunkX <= Math.floor(endX / edge); chunkX++) {
                    const chunk = this.world.getChunk(chunkX, chunkY, chunkZ)!;
                    const baseX = chunkX * edge, baseY = chunkY * edge, baseZ = chunkZ * edge;
                    let chunkEndY = Math.min(endY, baseY + edge - 1);
                    if (isCarving) {
                        if (chunk.storage.kind === 'EMPTY') continue;
                        if (chunk.storage.kind === 'LAYERED')
                            chunkEndY = Math.min(chunkEndY, baseY + chunk.storage.height - 1);
                    }
                    if (bounds && !boxOverlapsBounds(baseX, baseY, baseZ, edge, bounds)) continue;
                    const chunkStartX = Math.max(startX, baseX), chunkEndX = Math.min(endX, baseX + edge - 1);
                    const chunkEndZ = Math.min(endZ, baseZ + edge - 1);
                    let voxels = chunk.storage.kind === 'DENSE' ? chunk.storage.voxels : null;
                    let isEdited = false;
                    for (let y = Math.max(startY, baseY); y <= chunkEndY; y++)
                        for (let z = Math.max(startZ, baseZ); z <= chunkEndZ; z++) {
                            let rowStartX = chunkStartX, rowEndX = chunkEndX;
                            if (bounds) {
                                const offsetY = bounds.ignoresHeight ? 0 : y + .5 - bounds.center.y;
                                const offsetZ = z + .5 - bounds.center.z;
                                const spanSquared = outerSquared - offsetY * offsetY - offsetZ * offsetZ;
                                if (spanSquared < 0) continue;
                                const span = Math.sqrt(spanSquared);
                                rowStartX = Math.max(rowStartX, Math.ceil(bounds.center.x - span - .5) - 1);
                                rowEndX = Math.min(rowEndX, Math.floor(bounds.center.x + span - .5) + 1);
                            }
                            for (let x = rowStartX; x <= rowEndX; x++) {
                                if (bounds) {
                                    const offsetX = x + .5 - bounds.center.x;
                                    const offsetY = bounds.ignoresHeight ? 0 : y + .5 - bounds.center.y;
                                    const offsetZ = z + .5 - bounds.center.z;
                                    const distanceSquared = offsetX * offsetX + offsetY * offsetY + offsetZ * offsetZ;
                                    if (distanceSquared > outerSquared || distanceSquared < innerSquared) continue;
                                }
                                const localX = x - baseX, localY = y - baseY, localZ = z - baseZ;
                                const previous = voxels ? voxels[localX + edge * (localZ + edge * localY)]
                                    : getChunkMaterial(chunk.storage, localX, localY, localZ);
                                if (isCarving ? previous === Material.AIR : previous !== Material.AIR) continue;
                                if (carveCore) {
                                    const threshold = 1 - blastResistanceOf(previous);
                                    const offsetX = x + .5 - carveCore.center.x, offsetY = y + .5 - carveCore.center.y;
                                    const offsetZ = z + .5 - carveCore.center.z;
                                    const coreRadius = carveCore.radius * threshold;
                                    if (offsetX * offsetX + offsetY * offsetY + offsetZ * offsetZ >
                                        coreRadius * coreRadius &&
                                        normalizedDistance(x + .5, y + .5, z + .5, threshold) > threshold) continue;
                                } else {
                                    const threshold = isCarving ? 1 - blastResistanceOf(previous) : 1;
                                    if (normalizedDistance(x + .5, y + .5, z + .5, threshold) > threshold) continue;
                                }
                                const placed = underwaterMaterial(material, y);
                                if (placed === previous || materialTable[previous].isIndestructible) continue;
                                if (!voxels) voxels = this.world.denseVoxels(chunk);
                                voxels[localX + edge * (localZ + edge * localY)] = placed;
                                if (!isEdited) {
                                    isEdited = true;
                                    this.world.markChunkEdited(chunk);
                                    this.touch(chunk);
                                }
                                if (previous !== Material.AIR) {
                                    this.result.removedCount++;
                                    this.sampleRemoved(x, y, z, previous);
                                }
                                if (placed !== Material.AIR) this.result.addedCount++;
                            }
                        }
                }
    }

    // Keeps an evenly spread subset of the removed voxels without exceeding the sample limit
    private sampleRemoved(x: number, y: number, z: number, material: Material): void {
        const samples = this.result.removedVoxelSamples;
        const index = this.result.removedCount - 1;
        if (index % this.sampleStride !== 0) return;
        if (samples.length >= terrainRemovedVoxelSampleLimit) {
            const keptCount = Math.ceil(samples.length / 2);
            for (let kept = 0; kept < keptCount; kept++) samples[kept] = samples[kept * 2];
            samples.length = keptCount;
            this.sampleStride *= 2;
            if (index % this.sampleStride !== 0) return;
        }
        samples.push({ position: createVector3(x + .5, y + .5, z + .5), materialIdentifier: material });
    }
}

function sphereEdit(world: VoxelWorld, center: Vector3, radius: number, material: Material,
    shell?: BlastShell): TerrainEditResult {
    const edit = new TerrainEdit(world);
    if (!Number.isFinite(radius) || radius <= 0) return edit.result;
    const reach = shell ? Math.min(radius, shell.outerRadius) : radius;
    edit.region(createVector3(center.x - reach, center.y - reach, center.z - reach),
        createVector3(center.x + reach, center.y + reach, center.z + reach), (x, y, z) => {
            const offsetX = x - center.x, offsetY = y - center.y, offsetZ = z - center.z;
            return Math.sqrt(offsetX * offsetX + offsetY * offsetY + offsetZ * offsetZ) / radius;
        }, material, { center, radius: radius * carveCoreSafetyFraction },
        { center, radius: reach, innerRadius: shell?.innerRadius });
    return edit.result;
}

export function setVoxel(world: VoxelWorld, x: number, y: number, z: number, material: Material): TerrainEditResult {
    const edit = new TerrainEdit(world);
    edit.set(x, y, z, material);
    return edit.result;
}

/** Carves only the part of a sphere that lies inside the shell, so a sphere can be removed layer by layer. */
export function carveSphere(world: VoxelWorld, center: Vector3, radius: number, shell?: BlastShell): TerrainEditResult {
    return sphereEdit(world, center, radius, Material.AIR, shell);
}

export function addSphere(world: VoxelWorld, center: Vector3, radius: number,
    material = Material.DIRT, shell?: BlastShell): TerrainEditResult {
    return sphereEdit(world, center, radius, material, shell);
}

/** An irregular crater with optional long rays and surface ripples, which can be carved all at once or in layers. */
export class ShapedBlast {
    /** How far from the centre any voxel can be affected. */
    public readonly reachInVoxels: number;
    private readonly isValid: boolean;
    private readonly irregularity: number;
    private readonly rayLength: number;
    private readonly sharpness: number;
    private readonly hasIntegerSharpness: boolean;
    private readonly frequency: number;
    private readonly noiseOffset: number;
    private readonly rays: Array<Vector3> = [];
    private readonly ringCount: number;
    private readonly ringSpacing: number;

    constructor(private readonly center: Vector3, private readonly radius: number, options: ShapedBlastOptions) {
        this.isValid = Number.isFinite(radius) && radius > 0;
        this.irregularity = Math.max(0, options.irregularityFraction ?? explosionDefaultIrregularityFraction);
        this.rayLength = Math.max(0, options.rayLengthInVoxels ?? 0);
        this.sharpness = Math.max(.001, options.rayAngularSharpness ?? 10);
        this.hasIntegerSharpness = Number.isInteger(this.sharpness);
        this.frequency = options.noiseFrequency ?? .35;
        this.ringCount = Math.max(0, Math.floor(options.rippleRingCount ?? 0));
        this.ringSpacing = Math.max(.001, options.rippleSpacingInVoxels ?? 4);
        this.reachInVoxels = radius * (1 + this.irregularity) + this.rayLength;
        const random = new Rng(options.seed);
        if (this.isValid)
            for (let ray = 0; ray < Math.min(64, options.rayCount ?? 0); ray++)
                this.rays.push(normalizeVector(createVector3(), createVector3(random.range(-1, 1),
                    random.range(-1, 1), random.range(-1, 1))));
        this.noiseOffset = random.range(0, 10000);
    }

    /** Carves the crater, or only the part of it inside the shell. */
    public carve(world: VoxelWorld, shell?: BlastShell): TerrainEditResult {
        const edit = new TerrainEdit(world);
        this.carveInto(edit, shell);
        return edit.result;
    }

    /** Raises and lowers the surface in rings around the crater. */
    public ripple(world: VoxelWorld): TerrainEditResult {
        const edit = new TerrainEdit(world);
        this.rippleInto(edit, world);
        return edit.result;
    }

    public carveAndRipple(world: VoxelWorld): TerrainEditResult {
        const edit = new TerrainEdit(world);
        this.carveInto(edit);
        this.rippleInto(edit, world);
        return edit.result;
    }

    private carveInto(edit: TerrainEdit, shell?: BlastShell): void {
        if (!this.isValid) return;
        const center = this.center, radius = this.radius, irregularity = this.irregularity;
        const rayLength = this.rayLength, rays = this.rays, sharpness = this.sharpness;
        const frequency = this.frequency, noiseOffset = this.noiseOffset;
        const reach = shell ? Math.min(this.reachInVoxels, shell.outerRadius) : this.reachInVoxels;
        edit.region(createVector3(center.x - reach, center.y - reach, center.z - reach),
            createVector3(center.x + reach, center.y + reach, center.z + reach), (x, y, z, threshold) => {
                const offsetX = x - center.x, offsetY = y - center.y, offsetZ = z - center.z;
                const distance = Math.sqrt(offsetX * offsetX + offsetY * offsetY + offsetZ * offsetZ);
                if (distance === 0) return 0;
                if (distance > threshold * this.reachInVoxels) return Infinity;
                const noise = irregularity > 0 ? valueNoise(offsetX / distance * frequency + noiseOffset,
                    offsetY / distance * frequency, offsetZ / distance * frequency) * 2 - 1 : 0;
                const baseReach = radius * (1 + irregularity * noise);
                if (rays.length === 0 || rayLength === 0) return distance / Math.max(.001, baseReach);
                // The rays only ever lengthen the reach, so most voxels are settled without testing them
                if (distance <= threshold * Math.max(.001, baseReach)) return 0;
                if (distance > threshold * Math.max(.001, baseReach + rayLength)) return Infinity;
                let strongestRay = 0;
                for (const direction of rays) {
                    const alignment = Math.min(1, (direction.x * offsetX + direction.y * offsetY +
                        direction.z * offsetZ) / distance);
                    if (alignment <= 0) continue;
                    let strength = 1;
                    if (this.hasIntegerSharpness) {
                        let exponent = sharpness, factor = alignment;
                        while (exponent > 0) {
                            if (exponent % 2 === 1) strength *= factor;
                            factor *= factor;
                            exponent = Math.floor(exponent / 2);
                        }
                    } else strength = exponentialApproximation(naturalLogarithmApproximation(alignment) * sharpness);
                    strongestRay = Math.max(strongestRay, strength);
                }
                return distance / Math.max(.001, baseReach + rayLength * strongestRay);
            }, Material.AIR, { center, radius: radius * Math.max(0, 1 - irregularity) * carveCoreSafetyFraction },
            { center, radius: reach, innerRadius: shell?.innerRadius });
    }

    private rippleInto(edit: TerrainEdit, world: VoxelWorld): void {
        if (!this.isValid || this.ringCount <= 0) return;
        const center = this.center, radius = this.radius, ringSpacing = this.ringSpacing;
        const rippleRadius = radius + this.ringCount * ringSpacing;
        for (let z = Math.max(0, Math.floor(center.z - rippleRadius));
            z <= Math.min(world.mapEdgeLengthInVoxels - 1, Math.floor(center.z + rippleRadius)); z++)
            for (let x = Math.max(0, Math.floor(center.x - rippleRadius));
                x <= Math.min(world.mapEdgeLengthInVoxels - 1, Math.floor(center.x + rippleRadius)); x++) {
                const offsetX = x + .5 - center.x, offsetZ = z + .5 - center.z;
                const distance = Math.sqrt(offsetX * offsetX + offsetZ * offsetZ);
                if (distance <= radius || distance >= rippleRadius) continue;
                const top = world.highestSolidY(x, z, worldIndestructibleMaximumLayerIndex + 1);
                if (top < 0 || !world.isSolid(x, top - 1, z) || !world.isSolid(x, top - 2, z)) continue;
                if (Math.floor((distance - radius) / ringSpacing) % 2 === 0) {
                    if (top + 1 < worldHeightInVoxels) edit.set(x, top + 1, z, world.getMaterial(x, top, z));
                } else edit.set(x, top, z, Material.AIR);
            }
    }
}

export function carveShapedBlast(world: VoxelWorld, center: Vector3, radius: number,
    options: ShapedBlastOptions): TerrainEditResult {
    return new ShapedBlast(center, radius, options).carveAndRipple(world);
}

export function carveCapsule(world: VoxelWorld, start: Vector3, end: Vector3, radius: number): TerrainEditResult {
    const edit = new TerrainEdit(world);
    if (!Number.isFinite(radius) || radius <= 0) return edit.result;
    const directionX = end.x - start.x, directionY = end.y - start.y, directionZ = end.z - start.z;
    const lengthSquared = directionX * directionX + directionY * directionY + directionZ * directionZ;
    edit.region(createVector3(Math.min(start.x, end.x) - radius, Math.min(start.y, end.y) - radius,
        Math.min(start.z, end.z) - radius), createVector3(Math.max(start.x, end.x) + radius,
        Math.max(start.y, end.y) + radius, Math.max(start.z, end.z) + radius), (x, y, z) => {
        const along = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
            ((x - start.x) * directionX + (y - start.y) * directionY + (z - start.z) * directionZ) / lengthSquared));
        const offsetX = x - start.x - directionX * along, offsetY = y - start.y - directionY * along;
        const offsetZ = z - start.z - directionZ * along;
        return Math.sqrt(offsetX * offsetX + offsetY * offsetY + offsetZ * offsetZ) / radius;
    });
    return edit.result;
}

export function carveLineAlongRay(world: VoxelWorld, origin: Vector3, direction: Vector3,
    maximumDistance: number, radius = 0): TerrainEditResult {
    const edit = new TerrainEdit(world);
    const axis = normalizeVector(createVector3(), direction);
    visitVoxelsAlongRay(world, origin, axis, maximumDistance, (x, y, z) => {
        if (radius <= 0) edit.set(x, y, z, Material.AIR);
        else edit.region(createVector3(x - radius, y - radius, z - radius),
            createVector3(x + radius, y + radius, z + radius), (sampleX, sampleY, sampleZ) => {
                // Distance from the ray's axis, so the cut has a round cross-section
                const offsetX = sampleX - origin.x, offsetY = sampleY - origin.y, offsetZ = sampleZ - origin.z;
                const along = Math.max(0, offsetX * axis.x + offsetY * axis.y + offsetZ * axis.z);
                const awayX = offsetX - axis.x * along, awayY = offsetY - axis.y * along;
                const awayZ = offsetZ - axis.z * along;
                return Math.sqrt(awayX * awayX + awayY * awayY + awayZ * awayZ) / radius;
            });
    });
    return edit.result;
}

export function carveCylinder(world: VoxelWorld, base: Vector3, radius: number, height: number): TerrainEditResult {
    const edit = new TerrainEdit(world);
    if (radius <= 0 || height <= 0 || !Number.isFinite(radius + height)) return edit.result;
    edit.region(createVector3(base.x - radius, base.y, base.z - radius),
        createVector3(base.x + radius, base.y + height, base.z + radius), (x, y, z) => {
            const offsetX = x - base.x, offsetZ = z - base.z;
            return Math.max(Math.sqrt(offsetX * offsetX + offsetZ * offsetZ) / radius,
                Math.abs(y - base.y - height / 2) / (height / 2));
        }, Material.AIR, undefined, { center: base, radius, ignoresHeight: true });
    return edit.result;
}

export function carveRavine(world: VoxelWorld, start: Vector3, end: Vector3, width: number,
    depth: number, seed: number): TerrainEditResult {
    const edit = new TerrainEdit(world);
    if (width <= 0 || depth <= 0 || !Number.isFinite(width + depth)) return edit.result;
    const directionX = end.x - start.x, directionZ = end.z - start.z;
    const lengthSquared = directionX * directionX + directionZ * directionZ;
    const noiseOffset = new Rng(seed).range(0, 10000);
    edit.region(createVector3(Math.min(start.x, end.x) - width, Math.min(start.y, end.y) - depth,
        Math.min(start.z, end.z) - width), createVector3(Math.max(start.x, end.x) + width,
        Math.max(start.y, end.y), Math.max(start.z, end.z) + width), (x, y, z) => {
        const along = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
            ((x - start.x) * directionX + (z - start.z) * directionZ) / lengthSquared));
        const offsetX = x - start.x - directionX * along, offsetZ = z - start.z - directionZ * along;
        const surfaceY = start.y + (end.y - start.y) * along;
        const noise = valueNoise(x * terrainRavineWidthNoiseFrequency + noiseOffset, 0,
            z * terrainRavineWidthNoiseFrequency);
        const localWidth = width * (terrainRavineMinimumWidthFraction +
            noise * (1 - terrainRavineMinimumWidthFraction));
        // Ravines cut to their full depth instead of applying blast falloff.
        return y <= surfaceY && surfaceY - y <= depth &&
            offsetX * offsetX + offsetZ * offsetZ <= localWidth * localWidth ? 0 : Infinity;
    });
    return edit.result;
}

export function addHollowDome(world: VoxelWorld, center: Vector3, radius: number, thickness: number,
    material = Material.DOME_BARRIER): TerrainEditResult {
    const edit = new TerrainEdit(world);
    if (radius <= 0 || thickness <= 0 || !Number.isFinite(radius + thickness)) return edit.result;
    edit.region(createVector3(center.x - radius, center.y, center.z - radius),
        createVector3(center.x + radius, center.y + radius, center.z + radius), (x, y, z) => {
            const offsetX = x - center.x, offsetY = y - center.y, offsetZ = z - center.z;
            const distance = Math.sqrt(offsetX * offsetX + offsetY * offsetY + offsetZ * offsetZ);
            return offsetY < 0 || distance < radius - thickness ? Infinity : distance / radius;
        }, material, undefined, { center, radius });
    return edit.result;
}

export function liftColumn(world: VoxelWorld, center: Vector3, radius: number, height: number,
    thickness = worldHeightInVoxels): TerrainEditResult {
    const edit = new TerrainEdit(world);
    if (!Number.isFinite(radius) || radius <= 0 || !Number.isSafeInteger(height) || height <= 0 ||
        !Number.isSafeInteger(thickness) || thickness <= 0) return edit.result;
    height = Math.min(height, worldHeightInVoxels);
    for (let z = Math.max(0, Math.floor(center.z - radius));
        z <= Math.min(world.mapEdgeLengthInVoxels - 1, Math.floor(center.z + radius)); z++)
        for (let x = Math.max(0, Math.floor(center.x - radius));
            x <= Math.min(world.mapEdgeLengthInVoxels - 1, Math.floor(center.x + radius)); x++) {
            const offsetX = x + .5 - center.x, offsetZ = z + .5 - center.z;
            if (offsetX * offsetX + offsetZ * offsetZ > radius * radius) continue;
            const bottom = Math.max(worldIndestructibleMaximumLayerIndex + 1, Math.floor(center.y));
            for (let y = Math.min(worldHeightInVoxels - 1, bottom + thickness - 1); y >= bottom; y--) {
                const material = world.getMaterial(x, y, z);
                edit.set(x, y, z, Material.AIR);
                if (material !== Material.AIR && y + height < worldHeightInVoxels)
                    edit.set(x, y + height, z, material);
            }
        }
    return edit.result;
}

export function scorchSurface(world: VoxelWorld, center: Vector3, radius: number,
    material = Material.SCORCHED_GROUND): TerrainEditResult {
    const edit = new TerrainEdit(world);
    if (!Number.isFinite(radius) || radius <= 0) return edit.result;
    for (let z = Math.max(0, Math.floor(center.z - radius));
        z <= Math.min(world.mapEdgeLengthInVoxels - 1, Math.floor(center.z + radius)); z++)
        for (let x = Math.max(0, Math.floor(center.x - radius));
            x <= Math.min(world.mapEdgeLengthInVoxels - 1, Math.floor(center.x + radius)); x++) {
            const offsetX = x + .5 - center.x, offsetZ = z + .5 - center.z;
            const horizontalDistanceSquared = offsetX * offsetX + offsetZ * offsetZ;
            if (horizontalDistanceSquared > radius * radius) continue;
            let top = Math.min(worldHeightInVoxels - 1, Math.floor(center.y + radius));
            while (top > worldIndestructibleMaximumLayerIndex && !world.isSolid(x, top, z)) top--;
            const offsetY = top + .5 - center.y;
            const flags = materialTable[world.getMaterial(x, top, z)].flags;
            if (horizontalDistanceSquared + offsetY * offsetY <= radius * radius &&
                (flags & (MaterialFlag.SOIL | MaterialFlag.FLAMMABLE))) edit.set(x, top, z, material);
        }
    return edit.result;
}

export function flattenDisc(world: VoxelWorld, center: Vector3, radius: number): TerrainEditResult {
    const edit = new TerrainEdit(world);
    if (!Number.isFinite(radius) || radius <= 0 || !Number.isFinite(center.y)) return edit.result;
    const surfaceHeight = Math.max(worldIndestructibleMaximumLayerIndex + 1,
        Math.min(worldHeightInVoxels - 1, Math.floor(center.y)));
    for (let z = Math.max(0, Math.floor(center.z - radius));
        z <= Math.min(world.mapEdgeLengthInVoxels - 1, Math.ceil(center.z + radius)); z++)
        for (let x = Math.max(0, Math.floor(center.x - radius));
            x <= Math.min(world.mapEdgeLengthInVoxels - 1, Math.ceil(center.x + radius)); x++) {
            const offsetX = x + .5 - center.x, offsetZ = z + .5 - center.z;
            if (offsetX * offsetX + offsetZ * offsetZ > radius * radius) continue;
            for (let y = worldIndestructibleMaximumLayerIndex + 1; y < worldHeightInVoxels; y++)
                edit.set(x, y, z, y >= surfaceHeight ? Material.AIR
                    : y === surfaceHeight - 1 ? Material.MEADOW : Material.DIRT);
        }
    return edit.result;
}

/** Runs a throwaway blast on a scratch world so the first real terrain edit does not pay for cold code. */
export function warmUpTerrainEdits(): void {
    const edge = worldChunkEdgeLengthInVoxels;
    const world = new VoxelWorld(edge);
    const voxels = new Uint8Array(edge * edge * edge).fill(Material.LIGHT_STONE);
    for (let chunkY = 0; chunkY < world.chunksPerVerticalEdge; chunkY++)
        world.installChunk(0, chunkY, 0, { kind: 'DENSE', voxels: voxels.slice() });
    const centre = createVector3(edge / 2, edge / 2, edge / 2);
    carveShapedBlast(world, centre, edge / 3, { seed: 1, rayCount: 4, rayLengthInVoxels: edge / 4,
        rippleRingCount: 2, rippleSpacingInVoxels: 3 });
    carveSphere(world, centre, edge / 4);
    addSphere(world, centre, edge / 6);
}
