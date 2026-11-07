import { centerElevationBoostInVoxels, islandRadiusFraction, worldChunkEdgeLengthInVoxels,
    worldGenerationNoise, worldHeightInVoxels, worldNoiseOctaveCount,
    worldTerrainSettings } from '../../config.js';
import { Rng } from '../../../../shared/ts/seeded-random.js';
import { valueNoise } from '../../../../shared/ts/value-noise.js';
import { sineOfRadians } from '../math/deterministic-math.js';
import { TerrainSettings, WorldTheme } from './themes.js';

export interface TerrainColumnTile {
    heights: Uint8Array;
    moisture: Float32Array;
    slopes: Float32Array;
}

const chunkEdge = worldChunkEdgeLengthInVoxels;

export class TerrainFields {
    private readonly offsets: Array<number>;
    public readonly settings: Readonly<TerrainSettings>;
    private readonly regionRange: WorldTheme['regionRange'];
    private readonly tiles = new Map<number, TerrainColumnTile>();

    constructor(public readonly matchSeed: number, public readonly mapEdgeLengthInVoxels: number,
        theme: Pick<WorldTheme, 'terrain' | 'regionRange'>) {
        this.settings = { ...worldTerrainSettings, ...theme.terrain };
        this.regionRange = theme.regionRange;
        const random = new Rng(matchSeed).fork(worldGenerationNoise.terrainForkLabel);
        this.offsets = Array.from({ length: worldGenerationNoise.offsetCount },
            () => random.range(0, worldGenerationNoise.offsetMaximum));
    }

    public noise(x: number, y: number, z: number, stream = 0): number {
        const count = worldGenerationNoise.offsetCount;
        return valueNoise(x + this.offsets[stream % count],
            y + this.offsets[(stream + worldGenerationNoise.secondAxisStreamOffset) % count],
            z + this.offsets[(stream + worldGenerationNoise.thirdAxisStreamOffset) % count]);
    }

    public heightAt(x: number, z: number): number {
        const terrain = this.settings;
        const edge = this.mapEdgeLengthInVoxels;
        if (x < edge * terrain.boundaryMinimumFraction || z < edge * terrain.boundaryMinimumFraction ||
            x >= edge * terrain.boundaryMaximumFraction || z >= edge * terrain.boundaryMaximumFraction) return 0;
        const normalizedX = (x - edge * .5) / (edge * islandRadiusFraction);
        const normalizedZ = (z - edge * .5) / (edge * islandRadiusFraction);
        const warpedX = normalizedX + (this.noise(x / terrain.warpScale, 0, z / terrain.warpScale, 0) - .5) *
            terrain.warpStrength;
        const warpedZ = normalizedZ + (this.noise(x / terrain.warpScale, 0, z / terrain.warpScale, 1) - .5) *
            terrain.warpStrength;
        const radius = Math.sqrt(warpedX * warpedX + warpedZ * warpedZ);
        const coastNoise = this.noise(x / terrain.coastNoiseScale, 0, z / terrain.coastNoiseScale, 2);
        const coastDistance = 1 - radius - (1 - coastNoise) * terrain.coastNoiseStrength;
        if (coastDistance <= 0) return 0;
        const transition = Math.min(1, coastDistance / terrain.coastTransitionWidth);
        const mask = transition * transition * (3 - 2 * transition);
        let hills = 0, amplitude: number = terrain.hillAmplitude, frequency = 1 / terrain.hillScale;
        for (let octave = 0; octave < worldNoiseOctaveCount; octave++) {
            hills += this.noise(x * frequency, 0, z * frequency, octave + 3) * amplitude;
            amplitude *= terrain.hillAmplitudeMultiplier;
            frequency *= terrain.hillFrequencyMultiplier;
        }
        let region = this.noise(x / terrain.regionScale, 0, z / terrain.regionScale, 7);
        if (this.regionRange) region = this.regionRange[0] + region * (this.regionRange[1] - this.regionRange[0]);
        const ridge = 1 - Math.abs(2 * this.noise(x / terrain.ridgeScale, 0, z / terrain.ridgeScale, 8) - 1);
        const terrace = this.noise(x / terrain.terraceScale, 0, z / terrain.terraceScale, 9) * terrain.terraceCount;
        const terraceFraction = terrace - Math.floor(terrace);
        const terraceRiser = Math.max(0, Math.min(1,
            (terraceFraction - terrain.terraceRiserStart) / terrain.terraceRiserWidth));
        const plateaus = Math.floor(terrace) * terrain.terraceHeight +
            terraceRiser * terraceRiser * (3 - 2 * terraceRiser) * terrain.terraceHeight;
        const mesaField = this.noise(x / terrain.mesaScale, 0, z / terrain.mesaScale, 10);
        const mesaRiser = Math.max(0, Math.min(1, (mesaField - terrain.mesaRiserStart) * terrain.mesaRiserMultiplier));
        const mesas = terrain.mesaBaseHeight + mesaRiser * mesaRiser * (3 - 2 * mesaRiser) * terrain.mesaHeight;
        const chain = 1 - Math.abs(2 * this.noise(x / terrain.chainScaleX + warpedZ * terrain.chainWarpStrength,
            0, z / terrain.chainScaleZ, 11) - 1);
        const chains = chain * chain * chain * terrain.chainHeight;
        const dunes = terrain.duneBaseHeight + (sineOfRadians(x * terrain.duneFrequency +
            this.noise(x / terrain.duneNoiseScale, 0, z / terrain.duneNoiseScale, 12) * terrain.duneNoiseStrength) +
            1) * terrain.duneAmplitude;
        const gully = 1 - Math.abs(2 * this.noise(x / terrain.gullyScale, 0, z / terrain.gullyScale, 13) - 1);
        const gullies = terrain.gullyBaseHeight + hills - gully * gully * terrain.gullyDepth;
        const archetypes = [hills + terrain.hillBaseHeight, ridge * ridge * terrain.ridgeHeight +
            hills * terrain.ridgeHillWeight, plateaus, mesas, chains, dunes, gullies];
        const selection = region * (archetypes.length - 1);
        const lowerIndex = Math.floor(selection);
        const blend = selection - lowerIndex;
        let detail = archetypes[lowerIndex] * (1 - blend) +
            archetypes[Math.min(archetypes.length - 1, lowerIndex + 1)] * blend;
        const coastalWeight = Math.max(0, 1 - coastDistance / terrain.coastalDuneWidth);
        detail = detail * (1 - coastalWeight) + dunes * coastalWeight;
        const elevation = terrain.minimumHeight +
            mask * (centerElevationBoostInVoxels * Math.max(0, 1 - radius) + detail);
        return Math.max(terrain.minimumHeight, Math.min(worldHeightInVoxels - terrain.ceilingPadding,
            Math.floor(elevation)));
    }

    public tileAt(tileX: number, tileZ: number): TerrainColumnTile {
        const terrain = this.settings;
        const key = tileX + Math.ceil(this.mapEdgeLengthInVoxels / chunkEdge) * tileZ;
        const cached = this.tiles.get(key);
        if (cached) return cached;
        const paddedEdge = chunkEdge + 2;
        const paddedHeights = new Uint8Array(paddedEdge * paddedEdge);
        for (let localZ = -1; localZ <= chunkEdge; localZ++)
            for (let localX = -1; localX <= chunkEdge; localX++)
                paddedHeights[localX + 1 + paddedEdge * (localZ + 1)] =
                    this.heightAt(tileX * chunkEdge + localX, tileZ * chunkEdge + localZ);
        const tile: TerrainColumnTile = { heights: new Uint8Array(chunkEdge * chunkEdge),
            moisture: new Float32Array(chunkEdge * chunkEdge), slopes: new Float32Array(chunkEdge * chunkEdge) };
        for (let localZ = 0; localZ < chunkEdge; localZ++)
            for (let localX = 0; localX < chunkEdge; localX++) {
                const index = localX + chunkEdge * localZ;
                const paddedIndex = localX + 1 + paddedEdge * (localZ + 1);
                tile.heights[index] = paddedHeights[paddedIndex];
                const slopeX = (paddedHeights[paddedIndex + 1] - paddedHeights[paddedIndex - 1]) * .5;
                const slopeZ = (paddedHeights[paddedIndex + paddedEdge] - paddedHeights[paddedIndex - paddedEdge]) * .5;
                tile.slopes[index] = Math.sqrt(slopeX * slopeX + slopeZ * slopeZ);
                tile.moisture[index] = this.noise((tileX * chunkEdge + localX) / terrain.moistureScale, 0,
                    (tileZ * chunkEdge + localZ) / terrain.moistureScale, 14);
            }

        this.tiles.set(key, tile);
        return tile;
    }
}
