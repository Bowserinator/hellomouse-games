import { ObstacleStrategyType, SkyType, SurfaceType } from '../../types.js';
import { PLANET_GAP, PLANET_RADIUS_MAX, PLANET_RADIUS_MIN } from '../../vars.js';
import { Rng } from '../math/rng.js';
import { angDist } from '../math/sphere.js';
import { V3, scale, tangentBasis, tuple, vec } from '../math/vec3.js';
import { MapDesc, PlanetDesc } from './map-desc.js';
import { SURFACE_TABLE } from './surfaces.js';
import { STRATEGIES, StrategyParams } from './strategies/index.js';
import { connectedLand, minClearance } from './validators.js';

export interface MapOptions extends StrategyParams {
    planetCount?: 1 | 2 | 3;
    surface?: SurfaceType;
    strategy?: ObstacleStrategyType;
    sky?: SkyType;
}
export function generateMap(seed: number, opts: MapOptions = {}): MapDesc {
    const rng = new Rng(seed), count = opts.planetCount ?? 3;
    const radii = Array.from({ length: count }, () => rng.range(PLANET_RADIUS_MIN, PLANET_RADIUS_MAX));
    if (count > 1 && Math.max(...radii) / Math.min(...radii) < 1.3) radii[0] = PLANET_RADIUS_MIN;
    if (count > 1 && Math.max(...radii) / Math.min(...radii) < 1.3) radii[1] = PLANET_RADIUS_MAX;
    const largest = [...radii].sort((a, b) => b - a);
    const side = (largest[0] + (largest[1] ?? 0) + PLANET_GAP) * rng.range(1.08, 1.16);
    const orbit = count === 1 ? 0 : side / (2 * Math.sin(Math.PI / count));
    const rotation = rng.range(0, Math.PI * 2);
    const surfaces = [SurfaceType.ROCK, SurfaceType.ICE, SurfaceType.GRASS,
        SurfaceType.MIRROR, SurfaceType.SNOW, SurfaceType.PLASTIC, SurfaceType.SAND];
    const strategies = [ObstacleStrategyType.SCATTER, ObstacleStrategyType.HOLES, ObstacleStrategyType.WALLS];
    const strategyOffset = rng.int(0, 2);
    const planets: Array<PlanetDesc> = radii.map((radius, id) => {
        const angle = rotation + id * Math.PI * 2 / count;
        const surface = opts.surface ?? rng.weighted(surfaces, s => SURFACE_TABLE[s].weight);
        if (opts.surface === undefined) surfaces.splice(surfaces.indexOf(surface), 1);
        const jitterX = rng.range(-0.025, 0.025) * side, jitterZ = rng.range(-0.025, 0.025) * side;
        return { id, radius, center: [count === 1 ? 0 : Math.cos(angle) * orbit + jitterX,
            0, count === 1 ? 0 : Math.sin(angle) * orbit + jitterZ],
        surface, surfaceSeed: rng.int(0, 0x7fffffff),
        strategy: opts.strategy ?? strategies[(id + strategyOffset) % 3], obstacles: [], spawnPoints: [],
        tuning: { friction: SURFACE_TABLE[surface].friction } };
    });
    const map: MapDesc = { version: 1, seed, planets, rings: [] };
    const keepOuts: Array<Array<V3>> = planets.map(() => []);
    const starAxes = planets.map(() => rng.unitVec()), starCounts = planets.map(() => 0);
    const landingAxes = starAxes.map(axis => tangentBasis(axis)[0]);
    for (let i = 0; i < count; i++)
        for (let j = i + 1; j < count; j++) {
            const da = scale(vec(), starAxes[i], starCounts[i]++ ? -1 : 1);
            const db = scale(vec(), starAxes[j], starCounts[j]++ ? -1 : 1);
            const la = scale(vec(), landingAxes[i], starCounts[i] === 1 ? 1 : -1);
            const lb = scale(vec(), landingAxes[j], starCounts[j] === 1 ? 1 : -1);
            keepOuts[i].push(da, la);
            keepOuts[j].push(db, lb);
            map.rings.push({ id: map.rings.length, durationMs: 2400,
                a: { planet: i, destPlanet: j, dir: tuple(da), landDir: tuple(lb), accent: j },
                b: { planet: j, destPlanet: i, dir: tuple(db), landDir: tuple(la), accent: i } });
        }
    for (const planet of planets) {
        const keep = keepOuts[planet.id];
        for (let tries = 0; planet.spawnPoints.length < 12 && tries < 2000; tries++) {
            const d = rng.unitVec();
            if (keep.every(k => angDist(d, k) * planet.radius > 7)) {
                planet.spawnPoints.push(tuple(d));
                keep.push(d);
            }
        }
        let valid = false;
        for (let attempt = 0; attempt < 12 && !valid; attempt++) {
            Object.assign(planet, STRATEGIES[planet.strategy].generate({
                rng: rng.fork(planet.id * 100 + attempt), planet, keepOuts: keep, params: opts
            }));
            valid = minClearance(planet) && connectedLand(planet, keep);
        }
        // Carve only when repeated layouts isolate a required pad.
        while (!valid && (planet.obstacles.length || planet.holes?.length)) {
            if (planet.holes?.length) planet.holes.pop();
            else planet.obstacles.pop();
            valid = minClearance(planet) && connectedLand(planet, keep);
        }
        if (!valid) throw new Error('Cannot generate connected planet');
    }
    map.sky = opts.sky ?? rng.pick([SkyType.STARS, SkyType.DAY]);
    return map;
}
