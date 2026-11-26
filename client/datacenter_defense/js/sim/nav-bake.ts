import { validateWorld, type World, type Point } from '../mapx.js';
import { hashWords, Q, TICK_HZ, WAVE_WORDS } from './fixed.js';
import { VARIANTS } from './variants.js';
import { bakeBuildings } from './buildings.js';
import { BALANCE } from './balance.js';
import { bounds, center, elevation } from '../editor/world.js';

export interface NavSpawn {
    x: number; z: number; radius: number; cells: Uint32Array;
}
export interface NavBake {
    columns: number; rows: number; cellCm: number; widthCm: number; depthCm: number;
    costs: Uint8Array; airCosts: Uint8Array; heights: Int32Array; baseDm: number;
    terrainColumns: number; terrainRows: number;
    spawns: Array<NavSpawn>; objective: { x: number; z: number; radius: number };
    words: Uint32Array; terrainOffset: number; spawnOffset: number; buildingOffset: number; hash: number;
    waveOffset: number; waveCount?: number; firstWaveTick: number; winTick?: number;
    notices: Array<string>;
}
const centimetres = (n: number) => {
    const value = Math.round(n * 100);
    if (!Number.isSafeInteger(value) || Math.abs(value) > 4000000) throw Error('Simulation geometry exceeds 40 km');
    return value;
};
function inside(polygon: Array<Point>, x: number, z: number): boolean {
    let result = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const a = polygon[j], b = polygon[i];
        const cross = (b.x - a.x) * (z - a.z) - (b.z - a.z) * (x - a.x);
        if (!cross && x >= Math.min(a.x, b.x) && x <= Math.max(a.x, b.x) &&
            z >= Math.min(a.z, b.z) && z <= Math.max(a.z, b.z)) return true;
        if ((a.z > z) !== (b.z > z) && (b.z > a.z ? cross > 0 : cross < 0)) result = !result;
    }
    return result;
}
export function bakeNav(world: World, buildTime: number | null = null): NavBake {
    validateWorld(world);
    const objectives = world.objects.filter(e => e.kind === 'objective');
    const sources = world.objects.filter(e => e.kind === 'spawn');
    if (objectives.length !== 1 || !sources.length) throw Error('Place one objective and at least one spawn');
    if (sources.length > 20) throw Error('Simulation supports at most 20 spawn points');
    const widthCm = centimetres(world.width), depthCm = centimetres(world.depth);
    const cellCm = Math.max(100, Math.ceil(Math.max(widthCm, depthCm) / 204800) * 100);
    const columns = Math.ceil(widthCm / cellCm), rows = Math.ceil(depthCm / cellCm), count = columns * rows;
    const t = world.terrain, baseDm = Math.round(t.base * 10);
    const heights = Int32Array.from(t.heights, h => Math.round((h - t.base) * 10));
    if (heights.some(h => h < -32768 || h > 32767)) throw Error('Terrain exceeds MAPX height precision');
    const sample = (x: number, z: number) => {
        const px = Math.max(0, Math.min(widthCm, x)) * (t.columns - 1);
        const pz = Math.max(0, Math.min(depthCm, z)) * (t.rows - 1);
        const ix = Math.min(t.columns - 2, Math.floor(px / widthCm));
        const iz = Math.min(t.rows - 2, Math.floor(pz / depthCm));
        const fx = px - ix * widthCm, fz = pz - iz * depthCm, i = iz * t.columns + ix;
        const a = heights[i] + Math.trunc((heights[i + 1] - heights[i]) * fx / widthCm);
        const b = heights[i + t.columns] +
            Math.trunc((heights[i + t.columns + 1] - heights[i + t.columns]) * fx / widthCm);
        return a + Math.trunc((b - a) * fz / depthCm);
    };
    const costs = new Uint8Array(count).fill(100), cellHeights = new Int32Array(count);
    const point = (x: number, z: number): Point => ({
        x: Math.floor((x * cellCm + Math.min((x + 1) * cellCm, widthCm)) / 2),
        z: Math.floor((z * cellCm + Math.min((z + 1) * cellCm, depthCm)) / 2)
    });
    for (let z = 0; z < rows; z++) for (let x = 0; x < columns; x++) {
        const p = point(x, z);
        cellHeights[z * columns + x] = sample(p.x, p.z);
    }
    const visit = (minX: number, minZ: number, maxX: number, maxZ: number,
        accept: (x: number, z: number) => boolean, action: (index: number) => void) => {
        for (let z = Math.max(0, Math.floor(minZ / cellCm)); z <= Math.min(rows - 1, Math.floor(maxZ / cellCm)); z++)
            for (let x = Math.max(0, Math.floor(minX / cellCm));
                x <= Math.min(columns - 1, Math.floor(maxX / cellCm)); x++) {
                const p = point(x, z);
                if (accept(p.x, p.z)) action(z * columns + x);
            }
    };
    const polygon = (points: Array<Point>, action: (index: number) => void) => {
        const ring = points.map(p => ({ x: centimetres(p.x), z: centimetres(p.z) }));
        visit(Math.min(...ring.map(p => p.x)), Math.min(...ring.map(p => p.z)),
            Math.max(...ring.map(p => p.x)), Math.max(...ring.map(p => p.z)),
            (x, z) => inside(ring, x, z), action);
    };
    const disc = (x: number, z: number, radius: number, action: (index: number) => void) => {
        let visited = false;
        visit(x - radius, z - radius, x + radius, z + radius,
            (px, pz) => (px - x) ** 2 + (pz - z) ** 2 <= radius * radius, index => {
                visited = true; action(index);
            });
        if (!visited && x >= 0 && z >= 0 && x < widthCm && z < depthCm)
            action(Math.floor(z / cellCm) * columns + Math.floor(x / cellCm));
    };
    for (let z = 0; z < rows; z++) for (let x = 0; x < columns; x++) {
        const i = z * columns + x;
        for (const [ox, oz] of [[-1, 0], [1, 0], [0, -1], [0, 1]])
            if (x + ox >= 0 && z + oz >= 0 && x + ox < columns && z + oz < rows &&
                Math.abs(cellHeights[i] - cellHeights[i + oz * columns + ox]) * 10 > cellCm) costs[i] = 0;
    }
    for (const e of world.objects) if (e.kind === 'region' && e.type === 'water')
        polygon(e.polygon, i => {
            costs[i] = 0;
        });
    const baseCosts = costs.slice(), owners = new Int32Array(count).fill(-1);
    const airCosts = new Uint8Array(count).fill(100);
    const buildings = world.objects.filter(e => e.kind === 'building');
    buildings.forEach((e, owner) => {
        const box = bounds(e.polygon), ground = elevation(world, center(e));
        const roof = e.roof === 'pitched' ? Math.min(5, (box.maxX - box.minX) / 4) : 0;
        const middle = (box.minX + box.maxX) / 2;
        polygon(e.polygon, i => {
            owners[i] = owners[i] === -1 ? owner : -2; costs[i] = 0;
            const p = point(i % columns, Math.floor(i / columns));
            const top = ground + e.height + roof * (1 - Math.abs(p.x / 100 - middle) /
                Math.max(0.01, middle - box.minX));
            if (top >= elevation(world, { x: p.x / 100, z: p.z / 100 }) + BALANCE.helicopter.height) airCosts[i] = 0;
        });
    });
    const tallestDm = Math.max(...VARIANTS.map(v => Math.ceil(v.height * 10 / Q)));
    for (const e of world.objects) if (e.kind === 'passage' && Math.round(e.floor * 10) <= 5 &&
        Math.round(e.clearance * 10) >= tallestDm) {
        const owner = buildings.findIndex(b => b.id === e.parent);
        polygon(e.polygon, i => {
            if (owners[i] === owner && owner >= 0) costs[i] = baseCosts[i];
        });
    }
    for (const e of world.objects) if (e.kind === 'prop') {
        const tree = e.type === 'tree' || e.type === 'cluster';
        for (let trunk = 0; trunk < (e.type === 'cluster' ? 5 : 1); trunk++) {
            const dx = trunk ? Math.cos(trunk * 2.4) * 3.5 * e.scale : 0;
            const dz = trunk ? Math.sin(trunk * 2.4) * 3.5 * e.scale : 0;
            const x = centimetres(e.x + dx * Math.cos(e.rotation) + dz * Math.sin(e.rotation));
            const z = centimetres(e.z - dx * Math.sin(e.rotation) + dz * Math.cos(e.rotation));
            disc(x, z, centimetres((tree ? 0.4 : e.radius) * e.scale), i => {
                costs[i] = 0;
            });
        }
    }
    const placement = (e: typeof objectives[number]) => {
        const x = centimetres(e.x), z = centimetres(e.z), radius = centimetres(e.radius);
        if (x < 0 || z < 0 || x >= widthCm || z >= depthCm || radius > Math.max(widthCm, depthCm))
            throw Error('Objective and spawn discs must be within simulation limits');
        return { x: Math.trunc(x * Q / 100), z: Math.trunc(z * Q / 100), radius: Math.trunc(radius * Q / 100) };
    };
    const site = objectives[0];
    const objective = placement(site);
    objective.radius = Math.trunc(objective.radius / 2);
    let goals = 0;
    const markGoals = (radius: number) => disc(centimetres(site.x), centimetres(site.z), centimetres(radius), i => {
        if (costs[i]) {
            costs[i] |= 128; goals++;
        }
    });
    markGoals(site.radius / 2);
    // Keep older maps navigable if the smaller disc has no walkable cells.
    if (!goals) markGoals(site.radius);
    if (!goals) throw Error('Objective has no walkable cells');
    const notices: Array<string> = [];
    const spawns = sources.map((e, s) => {
        const x = centimetres(e.x), z = centimetres(e.z), radius = centimetres(e.radius);
        if (x - radius < 0 || z - radius < 0 || x + radius > widthCm || z + radius > depthCm)
            throw Error(`Spawn ${s + 1} crosses the map boundary`);
        const cells = new Uint32Array(Math.ceil(count / 32));
        let blocked = 0, total = 0;
        disc(centimetres(e.x), centimetres(e.z), centimetres(e.radius), i => {
            cells[i >>> 5] |= 1 << (i & 31); total++;
            if (!(costs[i] & 127)) blocked++;
        });
        if (!total || blocked === total) throw Error(`Spawn ${s + 1} has no walkable cells`);
        if (blocked) notices.push(`Spawn ${s + 1}: ${blocked} blocked cells; blocked releases will be reported, not moved`);
        return { ...placement(e), cells };
    });
    const terrainOffset = Math.ceil(count / 4), spawnOffset = terrainOffset + heights.length;
    const buildingOffset = spawnOffset + spawns.length * 3, buildingsData = bakeBuildings(world);
    const waveOffset = buildingOffset + buildingsData.length;
    const slots: Array<number> = [];
    let firstWaveTick = world.rules ? world.rules.winTime * TICK_HZ : 0;
    if (world.rules) sources.forEach((source, spawn) => {
        for (const wave of world.rules!.waves[source.id] ?? []) {
            if (buildTime === null) firstWaveTick = Math.min(firstWaveTick, wave.time * TICK_HZ);
            const hpScale = Math.round((wave.hpScale ?? 1) * 100);
            const damageScale = Math.round((wave.damageScale ?? 1) * 100);
            VARIANTS.forEach((variant, type) => {
                const amount = wave.counts[variant.name] ?? 0;
                if (buildTime !== null && amount > 0) firstWaveTick = Math.min(firstWaveTick, wave.time * TICK_HZ);
                for (let i = 0; i < amount; i++) slots.push(spawn, type, wave.time * TICK_HZ, hpScale, damageScale);
            });
        }
    });
    let winTime = world.rules?.winTime ?? 0;
    if (world.rules && buildTime !== null) {
        const delta = buildTime - firstWaveTick / TICK_HZ;
        firstWaveTick = buildTime * TICK_HZ;
        winTime = Math.max(1, winTime + delta);
        for (let i = 2; i < slots.length; i += WAVE_WORDS) slots[i] += delta * TICK_HZ;
    }
    const words = new Uint32Array(waveOffset + slots.length);
    words.set(slots, waveOffset);
    words.set(new Uint32Array(buildingsData.buffer), buildingOffset);
    costs.forEach((cost, i) => {
        words[i >>> 2] |= cost << ((i & 3) * 8);
    });
    words.set(new Uint32Array(heights.buffer), terrainOffset);
    spawns.forEach((s, i) => words.set([s.x, s.z, s.radius], spawnOffset + i * 3));
    const header = [columns, rows, cellCm, widthCm, depthCm, baseDm, t.columns, t.rows,
        objective.x, objective.z, objective.radius, Number(!!world.rules), winTime];
    return { columns, rows, cellCm, widthCm, depthCm, costs, airCosts, heights, baseDm,
        terrainColumns: t.columns, terrainRows: t.rows, spawns, objective, words,
        terrainOffset, spawnOffset, buildingOffset, waveOffset,
        waveCount: world.rules ? slots.length / WAVE_WORDS : undefined, firstWaveTick,
        winTick: world.rules ? winTime * TICK_HZ : undefined,
        hash: hashWords(words, hashWords(header)), notices };
}
