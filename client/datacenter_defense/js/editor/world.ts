import { contains, type Entity, type Kind, type Point, type World } from '../mapx.js';

export function blankWorld(width = 1000, depth = 1000): World {
    const columns = Math.min(513, Math.max(2, Math.ceil(width / 8) + 1));
    const rows = Math.min(513, Math.max(2, Math.ceil(depth / 8) + 1));
    return {
        version: 1, name: 'Untitled battlefield', origin: { lat: 40.7128, lon: -74.006 }, width, depth,
        terrain: {
            columns, rows, base: 0,
            heights: new Array<number>(columns * rows).fill(0), original: new Array<number>(columns * rows).fill(0)
        },
        objects: [], source: { attribution: '', imported: '', elevation: 'Authored flat terrain', bounds: [] }
    };
}

export function entity(kind: Kind, point: Point = { x: 0, z: 0 }): Entity {
    return {
        id: Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16).padStart(8, '0')).join('-'),
        kind, type: kind === 'region' ? 'grass' : kind === 'prop' ? 'tree' : kind,
        name: '', parent: '', polygon: [], x: point.x, z: point.z, height: 12, floor: 0, clearance: 4,
        radius: 10, rotation: 0, scale: 1, weight: 1, seed: Math.floor(Math.random() * 0xffffffff), detail: 1,
        roof: 'flat', generated: false
    };
}

export function seededRandom(seed: number) {
    return () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
    };
}

export function center(e: Entity): Point {
    if (!e.polygon.length) return { x: e.x, z: e.z };
    return e.polygon.reduce((p, q) => ({
        x: p.x + q.x / e.polygon.length, z: p.z + q.z / e.polygon.length
    }), { x: 0, z: 0 });
}

export function bounds(polygon: Array<Point>) {
    return {
        minX: Math.min(...polygon.map(p => p.x)), maxX: Math.max(...polygon.map(p => p.x)),
        minZ: Math.min(...polygon.map(p => p.z)), maxZ: Math.max(...polygon.map(p => p.z))
    };
}

export function elevation(world: World, p: Point) {
    const t = world.terrain;
    const x = Math.max(0, Math.min(t.columns - 1.000001, p.x / world.width * (t.columns - 1)));
    const z = Math.max(0, Math.min(t.rows - 1.000001, p.z / world.depth * (t.rows - 1)));
    const i = Math.floor(x), j = Math.floor(z), u = x - i, v = z - j;
    const a = j * t.columns + i;
    return (t.heights[a] * (1 - u) + t.heights[a + 1] * u) * (1 - v) +
        (t.heights[a + t.columns] * (1 - u) + t.heights[a + t.columns + 1] * u) * v;
}

export function warnings(world: World): Array<string> {
    const messages: Array<string> = [];
    if (!world.objects.some(e => e.kind === 'objective')) messages.push('Place one primary objective');
    if (!world.objects.some(e => e.kind === 'spawn')) messages.push('Place at least one spawn');
    let outside = 0, blocked = 0, generated = 0;
    const buildings = world.objects.filter(e => e.kind === 'building');
    const inBounds = (p: Point) => p.x >= 0 && p.x <= world.width && p.z >= 0 && p.z <= world.depth;
    for (const e of world.objects) {
        if (!(e.polygon.length ? e.polygon.every(inBounds) : inBounds(e))) outside++;
        if (e.generated) generated++;
        if (e.kind === 'objective' || e.kind === 'spawn')
            if (buildings.some(b => contains(b.polygon, e))) blocked++;
    }
    if (outside) messages.push(`${outside} objects cross the map boundary`);
    if (blocked) messages.push(`${blocked} placements overlap building footprints; inspect passages in 3D`);
    if (generated) messages.push(`${generated} building heights are estimated`);
    if (world.rules) {
        const waves = Object.values(world.rules.waves).flat();
        if (!waves.length) messages.push('No waves configured');
        if (waves.some(w => w.time >= world.rules!.winTime)) messages.push('Some waves occur at or after the win time');
        const total = waves.reduce((sum, wave) => sum + Object.values(wave.counts).reduce((a, b) => a + b, 0), 0);
        if (total > 100000) messages.push('Waves exceed the 100000 zombie limit');
    }
    return messages;
}

export interface Brush {
    mode: string; radius: number; strength: number; falloff: number; target: number;
}
export function sculpt(world: World, p: Point, brush: Brush, amount: number) {
    const t = world.terrain;
    const before = t.heights.slice();
    const dx = world.width / (t.columns - 1), dz = world.depth / (t.rows - 1);
    const minX = Math.max(0, Math.floor((p.x - brush.radius) / dx));
    const maxX = Math.min(t.columns - 1, Math.ceil((p.x + brush.radius) / dx));
    const minZ = Math.max(0, Math.floor((p.z - brush.radius) / dz));
    const maxZ = Math.min(t.rows - 1, Math.ceil((p.z + brush.radius) / dz));
    for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) {
        const d = Math.hypot(x * dx - p.x, z * dz - p.z) / brush.radius;
        if (d > 1) continue;
        const i = z * t.columns + x;
        const factor = (1 - d * brush.falloff / 100) * amount;
        const step = brush.strength * factor;
        let target = brush.target;
        if (brush.mode === 'raise' || brush.mode === 'lower') target = before[i] + (brush.mode === 'raise' ? step : -step);
        else {
            if (brush.mode === 'reset') target = t.original[i];
            if (brush.mode === 'smooth') {
                let sum = 0, count = 0;
                for (let oz = -1; oz <= 1; oz++) for (let ox = -1; ox <= 1; ox++) {
                    if (x + ox < 0 || x + ox >= t.columns || z + oz < 0 || z + oz >= t.rows) continue;
                    sum += before[(z + oz) * t.columns + x + ox];
                    count++;
                }
                target = sum / count;
            }
            target = before[i] + Math.sign(target - before[i]) * Math.min(Math.abs(target - before[i]), step);
        }
        t.heights[i] = Math.max(t.base - 3276.7, Math.min(t.base + 3276.7, target));
    }
}

export class Saves {
    private database: Promise<IDBDatabase>;
    constructor() {
        this.database = new Promise((resolve, reject) => {
            const request = indexedDB.open('datacenter-defense-editor', 1);
            request.onupgradeneeded = () => request.result.createObjectStore('maps');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        void this.database.catch(() => undefined);
    }
    async slots(): Promise<Array<string>> {
        const db = await this.database;
        return new Promise((resolve, reject) => {
            const request = db.transaction('maps').objectStore('maps').getAllKeys();
            request.onsuccess = () => resolve(request.result.map(String));
            request.onerror = () => reject(request.error);
        });
    }
    async load(name: string): Promise<Uint8Array | undefined> {
        const db = await this.database;
        return new Promise((resolve, reject) => {
            const request = db.transaction('maps').objectStore('maps').get(name);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
    async save(name: string, data: Uint8Array) {
        const db = await this.database;
        return new Promise<void>((resolve, reject) => {
            const transaction = db.transaction('maps', 'readwrite');
            transaction.objectStore('maps').put(data, name);
            transaction.oncomplete = () => resolve();
            transaction.onabort = () => reject(transaction.error);
            transaction.onerror = () => reject(transaction.error);
        });
    }
}
