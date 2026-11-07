import { lobbyMaximumPlayerCount, spawnMaximumSurfaceSlope, spawnMinimumDryHeightInVoxels,
    spawnMinimumSeparationInVoxels, spawnWalkabilityGridSpacingInVoxels, tankMaximumClimbSlopeTangent,
    worldBoundaryInsetInVoxels, worldChunkEdgeLengthInVoxels, worldFallbackDiscRadiusFraction,
    worldFallbackSurfaceHeightInVoxels, worldGenerationMaximumAttempts } from '../../config.js';
import { Rng } from '../../../../shared/ts/seeded-random.js';
import { arcTangent2, fullCircleInRadians } from '../math/deterministic-math.js';
import { Vector3, createVector3 } from '../math/vector3.js';
import { findSupportHeight, isTankEnvelopeClear } from '../tank-collision.js';
import { WorldTheme } from './themes.js';
import { flattenDisc } from './terrain-edit.js';
import { TerrainFields } from './terrain-fields.js';
import { VoxelWorld } from './voxel-world.js';
import { WorldGenerator } from './world-generator.js';

export interface SpawnSeat {
    seatIndex: number;
    teamIndex: number;
}

export interface TankSpawn extends SpawnSeat {
    position: Vector3;
}

export interface GeneratedBattlefield {
    world: VoxelWorld;
    spawns: Array<TankSpawn>;
    generationSalt: number;
    generationSeed: number;
    usedFallback: boolean;
}

const gridSpacing = spawnWalkabilityGridSpacingInVoxels;

function largestWalkableRegion(world: VoxelWorld, fields: TerrainFields, isFallback: boolean): Array<number> {
    const edge = Math.ceil(world.mapEdgeLengthInVoxels / gridSpacing);
    const heights = new Int16Array(edge * edge).fill(-1);
    const visited = new Uint8Array(heights.length);
    const center = world.mapEdgeLengthInVoxels / 2;
    const radius = world.mapEdgeLengthInVoxels * worldFallbackDiscRadiusFraction - gridSpacing;
    for (let gridZ = 0; gridZ < edge; gridZ++)
        for (let gridX = 0; gridX < edge; gridX++) {
            const x = gridX * gridSpacing + .5, z = gridZ * gridSpacing + .5;
            if (x < worldBoundaryInsetInVoxels + gridSpacing || z < worldBoundaryInsetInVoxels + gridSpacing ||
                x > world.mapEdgeLengthInVoxels - worldBoundaryInsetInVoxels - gridSpacing ||
                z > world.mapEdgeLengthInVoxels - worldBoundaryInsetInVoxels - gridSpacing) continue;
            const offsetX = x - center, offsetZ = z - center;
            if (isFallback && offsetX * offsetX + offsetZ * offsetZ > radius * radius) continue;
            const tile = fields.tileAt(Math.floor(x / worldChunkEdgeLengthInVoxels),
                Math.floor(z / worldChunkEdgeLengthInVoxels));
            const index = Math.floor(x) % worldChunkEdgeLengthInVoxels +
                worldChunkEdgeLengthInVoxels * (Math.floor(z) % worldChunkEdgeLengthInVoxels);
            if (!isFallback && (tile.heights[index] < spawnMinimumDryHeightInVoxels ||
                tile.slopes[index] > tankMaximumClimbSlopeTangent)) continue;
            heights[gridX + edge * gridZ] = isFallback ? worldFallbackSurfaceHeightInVoxels : tile.heights[index] + 1;
        }
    let largest: Array<number> = [];
    for (let start = 0; start < heights.length; start++) {
        if (visited[start] || heights[start] < 0) continue;
        const region = [start];
        visited[start] = 1;
        for (let cursor = 0; cursor < region.length; cursor++) {
            const current = region[cursor], gridX = current % edge, gridZ = Math.floor(current / edge);
            const neighbours = [gridX > 0 ? current - 1 : -1, gridX + 1 < edge ? current + 1 : -1,
                gridZ > 0 ? current - edge : -1, gridZ + 1 < edge ? current + edge : -1];
            for (const neighbour of neighbours) {
                if (neighbour < 0 || visited[neighbour] || heights[neighbour] < 0 ||
                    Math.abs(heights[neighbour] - heights[current]) >
                    tankMaximumClimbSlopeTangent * gridSpacing) continue;
                visited[neighbour] = 1;
                region.push(neighbour);
            }
        }
        if (region.length > largest.length) largest = region;
    }
    return largest;
}

function chooseSpawns(world: VoxelWorld, fields: TerrainFields, seats: ReadonlyArray<SpawnSeat>,
    seed: number, isFallback: boolean): Array<TankSpawn> | null {
    const gridEdge = Math.ceil(world.mapEdgeLengthInVoxels / gridSpacing);
    const region = largestWalkableRegion(world, fields, isFallback);
    const candidates: Array<Vector3> = [];
    for (const cell of region) {
        const x = (cell % gridEdge) * gridSpacing + .5;
        const z = Math.floor(cell / gridEdge) * gridSpacing + .5;
        if (isFallback) {
            const anchor = Math.floor(world.mapEdgeLengthInVoxels / 2 / gridSpacing) * gridSpacing + .5;
            const spacing = Math.ceil(spawnMinimumSeparationInVoxels / gridSpacing) * gridSpacing;
            if ((x - anchor) % spacing !== 0 || (z - anchor) % spacing !== 0) continue;
        }
        const tile = fields.tileAt(Math.floor(x / worldChunkEdgeLengthInVoxels),
            Math.floor(z / worldChunkEdgeLengthInVoxels));
        const index = Math.floor(x) % worldChunkEdgeLengthInVoxels +
            worldChunkEdgeLengthInVoxels * (Math.floor(z) % worldChunkEdgeLengthInVoxels);
        if (!isFallback && tile.slopes[index] > spawnMaximumSurfaceSlope) continue;
        const standingHeight = isFallback ? worldFallbackSurfaceHeightInVoxels : tile.heights[index] + 1;
        const position = createVector3(x, standingHeight, z);
        if (!isTankEnvelopeClear(world, position, 0)) continue;
        if ([[0, 0], [0, 3.49], [0, -3.49], [2.49, 0], [-2.49, 0]].some(([offsetX, offsetZ]) =>
            findSupportHeight(world, x + offsetX, z + offsetZ, standingHeight, standingHeight - 2) === null)) continue;
        candidates.push(position);
    }
    const teams = Array.from(new Set(seats.map(seat => seat.teamIndex))).sort((first, second) => first - second);
    const rotation = new Rng(seed).fork(5001).float() * fullCircleInRadians;
    const center = world.mapEdgeLengthInVoxels / 2;
    const selected: Array<TankSpawn> = [];
    for (const seat of seats) {
        const sector = teams.indexOf(seat.teamIndex);
        let best: Vector3 | null = null;
        for (let attempt = 0; attempt < 2 && best === null; attempt++) {
            let bestDistance = -1;
            for (const candidate of candidates) {
                const angle = ((arcTangent2(candidate.z - center, candidate.x - center) - rotation) %
                    fullCircleInRadians + fullCircleInRadians) % fullCircleInRadians;
                if (attempt === 0 && Math.floor(angle / fullCircleInRadians * teams.length) !== sector) continue;
                let distance = Infinity;
                for (const previous of selected) {
                    const offsetX = candidate.x - previous.position.x, offsetZ = candidate.z - previous.position.z;
                    distance = Math.min(distance, offsetX * offsetX + offsetZ * offsetZ);
                }
                if (distance < spawnMinimumSeparationInVoxels * spawnMinimumSeparationInVoxels) continue;
                if (selected.length === 0) {
                    const offsetX = candidate.x - center, offsetZ = candidate.z - center;
                    distance = offsetX * offsetX + offsetZ * offsetZ;
                }
                if (distance > bestDistance) {
                    bestDistance = distance;
                    best = candidate;
                }
            }
        }
        if (best === null) return null;
        selected.push({ seatIndex: seat.seatIndex, teamIndex: seat.teamIndex, position: best });
    }
    return selected;
}

export function* battlefieldAttempts(matchSeed: number, mapEdgeLengthInVoxels: number,
    theme: Readonly<WorldTheme>, seats: ReadonlyArray<SpawnSeat>):
    Generator<WorldGenerator, GeneratedBattlefield, VoxelWorld> {
    if (!Number.isInteger(matchSeed) || seats.length < 2 || seats.length > lobbyMaximumPlayerCount ||
        new Set(seats.map(seat => seat.seatIndex)).size !== seats.length || seats.some(seat =>
        !Number.isInteger(seat.seatIndex) || seat.seatIndex < 0 || seat.seatIndex >= lobbyMaximumPlayerCount ||
            !Number.isInteger(seat.teamIndex) || seat.teamIndex < 0 || seat.teamIndex > 3))
        throw new RangeError('Invalid battlefield seed or seats');
    const orderedSeats = seats.slice().sort((first, second) => first.seatIndex - second.seatIndex);
    for (let salt = 0; salt < worldGenerationMaximumAttempts; salt++) {
        const generationSeed = new Rng(matchSeed).fork(salt).seed;
        const generator = new WorldGenerator(generationSeed, mapEdgeLengthInVoxels, theme);
        const world = yield generator;
        if (world.mapEdgeLengthInVoxels !== mapEdgeLengthInVoxels)
            throw new Error('Generated world has the wrong size');
        const spawns = chooseSpawns(world, generator.fields, orderedSeats, matchSeed, false);
        if (spawns) return { world, spawns, generationSalt: salt, generationSeed, usedFallback: false };
        if (salt + 1 !== worldGenerationMaximumAttempts) continue;
        const center = mapEdgeLengthInVoxels / 2;
        flattenDisc(world, createVector3(center, worldFallbackSurfaceHeightInVoxels, center),
            mapEdgeLengthInVoxels * worldFallbackDiscRadiusFraction);
        const fallbackSpawns = chooseSpawns(world, generator.fields, orderedSeats, matchSeed, true);
        if (!fallbackSpawns) throw new Error('Fallback island cannot fit the requested spawns');
        return { world, spawns: fallbackSpawns, generationSalt: salt, generationSeed, usedFallback: true };
    }
    throw new Error('World generation attempts exhausted');
}

export function generateBattlefield(matchSeed: number, mapEdgeLengthInVoxels: number,
    theme: Readonly<WorldTheme>, seats: ReadonlyArray<SpawnSeat>): GeneratedBattlefield {
    const attempts = battlefieldAttempts(matchSeed, mapEdgeLengthInVoxels, theme, seats);
    let step = attempts.next();
    while (!step.done) step = attempts.next(step.value.generateWorld());
    return step.value;
}
