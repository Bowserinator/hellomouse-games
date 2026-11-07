import { decorationCellEdgeLengthInVoxels, terrainSandMaximumHeightInVoxels,
    terrainSoilDepthInVoxels, worldCaveProbability, worldChunkEdgeLengthInVoxels,
    worldFloatingIslandProbability, worldHeightInVoxels, worldTreeProbability, worldGenerationNoise,
    worldSeabedTransitionWidthInVoxels,
    worldCaveSettings as caves, worldFloatingIslandSettings as floating,
    worldDecorationSettings as decoration, worldTerrainSettings as terrain } from '../../config.js';
import { Rng } from '../../../../shared/ts/seeded-random.js';
import { BiomeRule, surfaceMaterial } from './biomes.js';
import { Material, underwaterMaterial } from './material-table.js';
import { TerrainFields } from './terrain-fields.js';
import { ChunkStorage, VoxelWorld, chunkVoxelCount, compactChunk } from './voxel-world.js';

interface FloatingIsland {
    x: number;
    y: number;
    z: number;
    radius: number;
    depth: number;
    hasTree: boolean;
}

const chunkEdge = worldChunkEdgeLengthInVoxels;
const decorationCellEdge = decorationCellEdgeLengthInVoxels;

export class WorldGenerator {
    public readonly fields: TerrainFields;
    private readonly floatingIslands: Array<FloatingIsland> = [];
    private readonly caveCells = new Map<number, boolean>();

    constructor(public readonly matchSeed: number, public readonly mapEdgeLengthInVoxels: number,
        private readonly biomeRules: ReadonlyArray<Readonly<BiomeRule>>) {
        this.fields = new TerrainFields(matchSeed, mapEdgeLengthInVoxels);
        const cellCount = Math.ceil(mapEdgeLengthInVoxels / chunkEdge);
        const random = new Rng(matchSeed).fork(worldGenerationNoise.floatingIslandForkLabel);
        for (let cellZ = 0; cellZ < cellCount; cellZ++)
            for (let cellX = 0; cellX < cellCount; cellX++) {
                const candidateRandom = random.fork(cellX + cellCount * cellZ);
                if (candidateRandom.float() >= worldFloatingIslandProbability) continue;
                const x = (cellX + candidateRandom.float()) * chunkEdge;
                const z = (cellZ + candidateRandom.float()) * chunkEdge;
                const surfaceHeight = this.fields.heightAt(Math.floor(x), Math.floor(z));
                if (surfaceHeight < floating.minimumSurfaceHeight ||
                    surfaceHeight > worldHeightInVoxels - floating.surfaceCeilingPadding) continue;
                const radius = candidateRandom.range(floating.minimumRadius, floating.maximumRadius);
                if (this.floatingIslands.some(island => {
                    const distanceX = x - island.x, distanceZ = z - island.z;
                    return distanceX * distanceX + distanceZ * distanceZ <
                        (radius + island.radius + floating.separationPadding) *
                        (radius + island.radius + floating.separationPadding);
                })) continue;
                this.floatingIslands.push({ x: Math.floor(x), z: Math.floor(z),
                    y: Math.min(worldHeightInVoxels - floating.ceilingPadding,
                        surfaceHeight + candidateRandom.int(floating.minimumElevation, floating.maximumElevation)),
                    radius, depth: candidateRandom.range(floating.minimumDepth, floating.maximumDepth),
                    hasTree: candidateRandom.float() < floating.treeProbability });
            }
    }

    private isCave(x: number, y: number, z: number, surfaceHeight: number): boolean {
        if (y < caves.minimumHeight || y > surfaceHeight) return false;
        const coarseEdge = caves.activationCellEdge;
        const horizontalCells = Math.ceil(this.mapEdgeLengthInVoxels / coarseEdge);
        const key = Math.floor(x / coarseEdge) + horizontalCells *
            (Math.floor(z / coarseEdge) + horizontalCells * Math.floor(y / coarseEdge));
        let isActive = this.caveCells.get(key);
        if (isActive === undefined) {
            isActive = new Rng(this.matchSeed).fork(key + worldGenerationNoise.caveForkOffset).float() <
                worldCaveProbability;
            this.caveCells.set(key, isActive);
        }
        if (!isActive) return false;
        const warp = this.fields.noise(x / caves.warpScale, y / caves.warpScale, z / caves.warpScale, 2) *
            caves.warpStrength;
        const first = this.fields.noise((x + warp) / caves.firstHorizontalScale, y / caves.firstVerticalScale,
            z / caves.firstHorizontalScale, 3);
        const second = this.fields.noise(x / caves.secondHorizontalScale, (y + warp) / caves.secondVerticalScale,
            z / caves.secondHorizontalScale, 4);
        const cavity = this.fields.noise(x / caves.cavityHorizontalScale, y / caves.cavityVerticalScale,
            z / caves.cavityHorizontalScale, 5);
        return (Math.abs(first - .5) < caves.tubeHalfWidth && Math.abs(second - .5) < caves.tubeHalfWidth) ||
            (y < surfaceHeight - caves.cavityRoofDepth && cavity > caves.cavityThreshold);
    }

    public generateChunk(chunkX: number, chunkY: number, chunkZ: number): ChunkStorage {
        const horizontalChunks = this.mapEdgeLengthInVoxels / chunkEdge;
        if (!Number.isInteger(chunkX) || !Number.isInteger(chunkY) || !Number.isInteger(chunkZ) ||
            chunkX < 0 || chunkZ < 0 || chunkY < 0 || chunkX >= horizontalChunks ||
            chunkZ >= horizontalChunks || chunkY >= worldHeightInVoxels / chunkEdge)
            throw new RangeError('Generation chunk lies outside the world');
        const tile = this.fields.tileAt(chunkX, chunkZ);
        const originX = chunkX * chunkEdge, originY = chunkY * chunkEdge, originZ = chunkZ * chunkEdge;
        const voxels = new Uint8Array(chunkVoxelCount);
        for (let localZ = 0; localZ < chunkEdge; localZ++)
            for (let localX = 0; localX < chunkEdge; localX++) {
                const index = localX + chunkEdge * localZ;
                const height = tile.heights[index];
                const x = originX + localX, z = originZ + localZ;
                if (originY === 0 && height === 0) {
                    const center = this.mapEdgeLengthInVoxels / 2;
                    const offsetX = x + .5 - center, offsetZ = z + .5 - center;
                    const edge = center - Math.sqrt(offsetX * offsetX + offsetZ * offsetZ);
                    const fraction = Math.max(0, Math.min(1, edge / worldSeabedTransitionWidthInVoxels));
                    const coverage = fraction * fraction * (3 - 2 * fraction);
                    if (fraction < 1 && new Rng(this.matchSeed).fork(x + this.mapEdgeLengthInVoxels * z)
                        .float() >= coverage) continue;
                }
                const surface = height > 0 ? surfaceMaterial(this.biomeRules, height,
                    tile.slopes[index], tile.moisture[index]) : Material.AIR;
                const localTop = Math.min(chunkEdge - 1, height - originY);
                for (let localY = 0; localY <= localTop; localY++) {
                    const y = originY + localY;
                    let material: Material;
                    if (y === 0 || (height > 0 && y === 1)) material = Material.SEABED;
                    else if (this.isCave(x, y, z, height)) continue;
                    else if (y === height) material = surface;
                    else if (y >= height - terrainSoilDepthInVoxels)
                        material = height <= terrainSandMaximumHeightInVoxels ? Material.SANDSTONE : Material.DIRT;
                    else if (y % terrain.strataPeriod < terrain.lightStrataThickness) material = Material.STRATA_LIGHT;
                    else if (y % terrain.strataPeriod < terrain.darkStrataTop) material = Material.STRATA_DARK;
                    else material = y < terrain.darkStoneTop ? Material.DARK_STONE : Material.LIGHT_STONE;
                    voxels[localX + chunkEdge * (localZ + chunkEdge * localY)] = underwaterMaterial(material, y);
                }
            }

        this.stampFloatingIslands(voxels, originX, originY, originZ);
        this.stampDecorations(voxels, originX, originY, originZ);
        return compactChunk(voxels);
    }

    private stampFloatingIslands(voxels: Uint8Array, originX: number, originY: number, originZ: number): void {
        for (const island of this.floatingIslands) {
            if (island.x + island.radius < originX || island.x - island.radius >= originX + chunkEdge ||
                island.z + island.radius < originZ || island.z - island.radius >= originZ + chunkEdge ||
                island.y + floating.upperBoundsPadding < originY ||
                island.y - island.depth - floating.lowerBoundsPadding >= originY + chunkEdge) continue;
            for (let localZ = 0; localZ < chunkEdge; localZ++)
                for (let localX = 0; localX < chunkEdge; localX++) {
                    const x = originX + localX, z = originZ + localZ;
                    const offsetX = x - island.x, offsetZ = z - island.z;
                    const radius = Math.sqrt(offsetX * offsetX + offsetZ * offsetZ) / island.radius;
                    if (radius > 1) continue;
                    const top = island.y + Math.floor(this.fields.noise(x / floating.topNoiseScale, 0,
                        z / floating.topNoiseScale, 6) * floating.topNoiseHeight) - floating.topHeightOffset;
                    const stalactite = this.fields.noise(x * floating.stalactiteFrequency, 0,
                        z * floating.stalactiteFrequency, 7) > floating.stalactiteThreshold
                        ? floating.stalactiteLength : 0;
                    const bottom = top - Math.floor(island.depth * (1 - radius)) - stalactite;
                    for (let y = Math.max(bottom, originY); y <= Math.min(top, originY + chunkEdge - 1); y++)
                        voxels[localX + chunkEdge * (localZ + chunkEdge * (y - originY))] = underwaterMaterial(
                            y === top ? Material.MEADOW_DARK
                                : (y >= top - floating.soilDepth ? Material.DIRT : Material.DARK_STONE), y);
                }
        }
        for (const island of this.floatingIslands)
            if (island.hasTree) {
                const top = island.y + Math.floor(this.fields.noise(island.x / floating.topNoiseScale, 0,
                    island.z / floating.topNoiseScale, 6) * floating.topNoiseHeight) - floating.topHeightOffset;
                this.stampTree(voxels, originX, originY, originZ, island.x, top + 1, island.z, floating.treeHeight, 0);
            }
    }

    private stampDecorations(voxels: Uint8Array, originX: number, originY: number, originZ: number): void {
        const padding = decoration.chunkPadding;
        const cellCount = Math.ceil(this.mapEdgeLengthInVoxels / decorationCellEdge);
        const random = new Rng(this.matchSeed).fork(worldGenerationNoise.decorationForkLabel);
        for (let cellZ = Math.max(0, Math.floor((originZ - padding) / decorationCellEdge));
            cellZ <= Math.min(cellCount - 1, Math.floor((originZ + chunkEdge + padding) / decorationCellEdge)); cellZ++)
            for (let cellX = Math.max(0, Math.floor((originX - padding) / decorationCellEdge));
                cellX <= Math.min(cellCount - 1, Math.floor((originX + chunkEdge + padding) / decorationCellEdge));
                cellX++) {
                const candidate = random.fork(cellX + cellCount * cellZ);
                const x = cellX * decorationCellEdge + candidate.int(0, decorationCellEdge - 1);
                const z = cellZ * decorationCellEdge + candidate.int(0, decorationCellEdge - 1);
                const tile = this.fields.tileAt(Math.floor(x / chunkEdge), Math.floor(z / chunkEdge));
                const index = x % chunkEdge + chunkEdge * (z % chunkEdge);
                const height = tile.heights[index], moisture = tile.moisture[index], slope = tile.slopes[index];
                const treeDraw = candidate.float();
                if (height >= decoration.treeMinimumHeight && height <= decoration.treeMaximumHeight &&
                    slope < decoration.treeMaximumSlope && moisture > decoration.treeMinimumMoisture &&
                    treeDraw < worldTreeProbability) {
                    const species = height > decoration.leaflessMinimumHeight ? 3
                        : (height > decoration.pineMinimumHeight ? 1
                            : (moisture > decoration.multiTrunkMinimumMoisture ? 2 : 0));
                    this.stampTree(voxels, originX, originY, originZ, x, height + 1, z,
                        candidate.int(decoration.treeMinimumTrunkHeight, decoration.treeMaximumTrunkHeight), species);
                } else if (height > decoration.boulderMinimumHeight && slope < decoration.boulderMaximumSlope &&
                    candidate.float() < decoration.boulderProbability) {
                    const radius = candidate.int(decoration.boulderMinimumRadius, decoration.boulderMaximumRadius);
                    for (let localZ = 0; localZ < chunkEdge; localZ++)
                        for (let localX = 0; localX < chunkEdge; localX++) {
                            const offsetX = originX + localX - x, offsetZ = originZ + localZ - z;
                            for (let y = Math.max(originY, height); y <= Math.min(originY + chunkEdge - 1,
                                height + radius); y++) {
                                const offsetY = (y - height) * decoration.boulderVerticalScale;
                                if (offsetX * offsetX + offsetY * offsetY + offsetZ * offsetZ <= radius * radius)
                                    voxels[localX + chunkEdge * (localZ + chunkEdge * (y - originY))] =
                                        Material.LIGHT_STONE;
                            }
                        }
                }
            }
    }

    private stampTree(voxels: Uint8Array, originX: number, originY: number, originZ: number,
        treeX: number, baseY: number, treeZ: number, height: number, species: number): void {
        if (treeX + decoration.treeBoundsRadius < originX ||
            treeX - decoration.treeBoundsRadius >= originX + chunkEdge ||
            treeZ + decoration.treeBoundsRadius < originZ ||
            treeZ - decoration.treeBoundsRadius >= originZ + chunkEdge ||
            baseY + height + decoration.treeBoundsTopPadding < originY || baseY >= originY + chunkEdge) return;
        const trunkCount = species === 2 ? decoration.multiTrunkCount : 1;
        for (let trunk = 0; trunk < trunkCount; trunk++) {
            const centerX = treeX + (trunk === 1 ? decoration.multiTrunkOffsetX
                : (trunk === 2 ? -decoration.multiTrunkOffsetX : 0));
            const centerZ = treeZ + (trunk === 0 ? 0 : decoration.multiTrunkOffsetZ);
            for (let y = Math.max(baseY, originY);
                y <= Math.min(baseY + height + decoration.treeTopPadding, originY + chunkEdge - 1); y++)
                for (let z = Math.max(centerZ - decoration.treeCanopyRadius, originZ);
                    z <= Math.min(centerZ + decoration.treeCanopyRadius, originZ + chunkEdge - 1); z++)
                    for (let x = Math.max(centerX - decoration.treeCanopyRadius, originX);
                        x <= Math.min(centerX + decoration.treeCanopyRadius, originX + chunkEdge - 1); x++) {
                        const offsetX = x - centerX, offsetZ = z - centerZ;
                        const relativeY = y - baseY;
                        let material = Material.AIR;
                        if (offsetX === 0 && offsetZ === 0 && relativeY <= height) material = Material.TREE_TRUNK;
                        else if (species === 3) {
                            if (relativeY === height - decoration.leaflessBranchBelowTop &&
                                (offsetX === 0 || offsetZ === 0) &&
                                Math.abs(offsetX) + Math.abs(offsetZ) <= decoration.leaflessBranchReach)
                                material = Material.TREE_TRUNK;
                        } else if (species === 1) {
                            const radius = Math.max(0, (height + decoration.pineTopPadding - relativeY) *
                                decoration.pineRadiusPerHeight);
                            if (relativeY >= decoration.pineMinimumFoliageHeight &&
                                offsetX * offsetX + offsetZ * offsetZ <= radius * radius)
                                material = Material.PINE_NEEDLES;
                        } else {
                            const offsetY = (relativeY - height + decoration.canopyCentreBelowTop) *
                                decoration.canopyVerticalScale;
                            if (offsetX * offsetX + offsetY * offsetY + offsetZ * offsetZ <=
                                decoration.canopyRadiusSquared)
                                material = species === 2 ? Material.LEAVES_LIGHT
                                    : (relativeY > height ? Material.LEAVES_LIGHT : Material.LEAVES_DARK);
                        }
                        if (material === Material.AIR) continue;
                        const index = x - originX + chunkEdge * (z - originZ + chunkEdge * (y - originY));
                        if (voxels[index] === Material.AIR || material === Material.TREE_TRUNK)
                            voxels[index] = material;
                    }
        }
    }

    public generateWorld(): VoxelWorld {
        const world = new VoxelWorld(this.mapEdgeLengthInVoxels);
        world.forEachChunkInBox(0, 0, 0, this.mapEdgeLengthInVoxels - 1, worldHeightInVoxels - 1,
            this.mapEdgeLengthInVoxels - 1, chunk => {
                world.installChunk(chunk.chunkX, chunk.chunkY, chunk.chunkZ,
                    this.generateChunk(chunk.chunkX, chunk.chunkY, chunk.chunkZ));
            });
        return world;
    }
}

export function generateChunk(matchSeed: number, mapEdgeLengthInVoxels: number, chunkX: number,
    chunkY: number, chunkZ: number, biomeRules: ReadonlyArray<Readonly<BiomeRule>>): ChunkStorage {
    return new WorldGenerator(matchSeed, mapEdgeLengthInVoxels, biomeRules).generateChunk(chunkX, chunkY, chunkZ);
}
