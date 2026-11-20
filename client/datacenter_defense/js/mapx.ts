import { VARIANTS } from './sim/variants.js';
import { MAX_ZOMBIES } from './sim/fixed.js';

export interface Wave {
    time: number;
    counts: Record<string, number>;
}
export type Point = { x: number; z: number };
export type Kind = 'building' | 'passage' | 'region' | 'prop' | 'objective' | 'spawn';
export interface Entity {
    id: string;
    kind: Kind;
    type: string;
    name: string;
    parent: string;
    polygon: Array<Point>;
    x: number;
    z: number;
    height: number;
    floor: number;
    clearance: number;
    radius: number;
    rotation: number;
    scale: number;
    weight: number;
    seed: number;
    detail: number;
    roof: string;
    generated: boolean;
}
export interface World {
    version: 1;
    rules?: { winTime: number; waves: Record<string, Array<Wave>> };
    preview?: Uint8Array;
    name: string;
    origin: { lat: number; lon: number };
    width: number;
    depth: number;
    terrain: { columns: number; rows: number; base: number; heights: Array<number>; original: Array<number> };
    objects: Array<Entity>;
    source: { attribution: string; imported: string; elevation: string; bounds: Array<number> };
}

const kinds: Array<Kind> = ['building', 'passage', 'region', 'prop', 'objective', 'spawn'];
const fields = ['x', 'z', 'height', 'floor', 'clearance', 'radius', 'rotation', 'scale', 'weight'] as const;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true });
export const MAX_FILE_SIZE = 32 * 1024 * 1024;

class Writer {
    bytes = new Uint8Array(1024);
    length = 0;
    reserve(size: number) {
        if (this.length + size > MAX_FILE_SIZE) throw Error('Map exceeds the 32 MiB file limit');
        if (this.length + size > this.bytes.length) {
            const next = new Uint8Array(Math.max(this.bytes.length * 2, this.length + size));
            next.set(this.bytes);
            this.bytes = next;
        }
    }
    number(value: number, type: 'u8' | 'u16' | 'u32' | 'i16' | 'i32' | 'f64') {
        const size = { u8: 1, u16: 2, u32: 4, i16: 2, i32: 4, f64: 8 }[type];
        this.reserve(size);
        const view = new DataView(this.bytes.buffer);
        const offset = this.length;
        if (type === 'u8') view.setUint8(offset, value);
        if (type === 'u16') view.setUint16(offset, value, true);
        if (type === 'u32') view.setUint32(offset, value, true);
        if (type === 'i16') view.setInt16(offset, value, true);
        if (type === 'i32') view.setInt32(offset, value, true);
        if (type === 'f64') view.setFloat64(offset, value, true);
        this.length += size;
    }
    raw(bytes: Uint8Array) {
        this.reserve(bytes.length);
        this.bytes.set(bytes, this.length);
        this.length += bytes.length;
    }
    text(value: string) {
        const bytes = textEncoder.encode(value);
        if (bytes.length > 65535) throw Error('Text exceeds the MAPX string limit');
        this.number(bytes.length, 'u16');
        this.raw(bytes);
    }
    finish() {
        return this.bytes.slice(0, this.length);
    }
}

class Reader {
    offset = 0;
    view: DataView;
    constructor(public bytes: Uint8Array) {
        this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }
    raw(size: number) {
        if (!Number.isInteger(size) || size < 0 || this.offset + size > this.bytes.length) throw Error('Truncated MAPX file');
        const result = this.bytes.subarray(this.offset, this.offset + size);
        this.offset += size;
        return result;
    }
    number(type: 'u8' | 'u16' | 'u32' | 'i16' | 'i32' | 'f64') {
        const offset = this.offset;
        this.raw({ u8: 1, u16: 2, u32: 4, i16: 2, i32: 4, f64: 8 }[type]);
        if (type === 'u8') return this.view.getUint8(offset);
        if (type === 'u16') return this.view.getUint16(offset, true);
        if (type === 'u32') return this.view.getUint32(offset, true);
        if (type === 'i16') return this.view.getInt16(offset, true);
        if (type === 'i32') return this.view.getInt32(offset, true);
        return this.view.getFloat64(offset, true);
    }
    text() {
        return textDecoder.decode(this.raw(this.number('u16')));
    }
}

export function area(polygon: Array<Point>) {
    return polygon.reduce((sum, p, i) => {
        const q = polygon[(i + 1) % polygon.length];
        return sum + p.x * q.z - q.x * p.z;
    }, 0) / 2;
}

export function contains(polygon: Array<Point>, p: Point) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const a = polygon[i], b = polygon[j];
        if ((a.z > p.z) !== (b.z > p.z) && p.x < (b.x - a.x) * (p.z - a.z) / (b.z - a.z) + a.x) inside = !inside;
    }
    return inside;
}

function cross(a: Point, b: Point, c: Point) {
    return (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
}

export function segmentsIntersect(a: Point, b: Point, c: Point, d: Point) {
    const on = (p: Point, q: Point, r: Point) => Math.abs(cross(p, q, r)) < 1e-8 &&
        r.x >= Math.min(p.x, q.x) - 1e-8 && r.x <= Math.max(p.x, q.x) + 1e-8 &&
        r.z >= Math.min(p.z, q.z) - 1e-8 && r.z <= Math.max(p.z, q.z) + 1e-8;
    return (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) ||
        on(a, b, c) || on(a, b, d) || on(c, d, a) || on(c, d, b);
}

export function polygonError(polygon: Array<Point>): string {
    if (polygon.length < 3 || polygon.length > 4096) return 'Polygons need 3–4096 vertices';
    if (polygon.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.z) || Math.abs(p.x) > 200000 || Math.abs(p.z) > 200000)) return 'Invalid polygon coordinates';
    if (Math.abs(area(polygon)) < 0.05) return 'Polygon area is too small';
    for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i], b = polygon[(i + 1) % polygon.length];
        if (Math.hypot(b.x - a.x, b.z - a.z) < 0.05) return 'Edges must be at least 5 cm';
        for (let j = i + 1; j < polygon.length; j++) {
            if (j === i + 1 || (i === 0 && j === polygon.length - 1)) continue;
            if (segmentsIntersect(a, b, polygon[j], polygon[(j + 1) % polygon.length])) return 'Polygon edges intersect';
        }
    }
    return '';
}

export function overlaps(a: Array<Point>, b: Array<Point>) {
    return a.some(p => contains(b, p)) || b.some(p => contains(a, p)) ||
        a.some((p, i) => b.some((q, j) => segmentsIntersect(p, a[(i + 1) % a.length], q, b[(j + 1) % b.length])));
}

export function validateWorld(world: World) {
    if (world.version !== 1 || typeof world.name !== 'string' || world.name.length > 200) throw Error('Invalid map version or name');
    if (!Number.isFinite(world.origin.lat) || Math.abs(world.origin.lat) > 85 || !Number.isFinite(world.origin.lon) || Math.abs(world.origin.lon) > 180) throw Error('Invalid geographic origin');
    if (![world.width, world.depth].every(v => Number.isFinite(v) && v >= 10 && v <= 20000)) throw Error('Map dimensions must be 10–20000 m');
    const t = world.terrain;
    if (![t.columns, t.rows].every(v => Number.isInteger(v) && v >= 2 && v <= 513) || !Number.isFinite(t.base)) throw Error('Invalid terrain grid');
    for (const grid of [t.heights, t.original])
        if (grid.length !== t.columns * t.rows || grid.some(v => !Number.isFinite(v) || Math.abs(v - t.base) > 3276.7)) throw Error('Terrain exceeds signed decimeter storage range');

    if (world.objects.length > 30000) throw Error('Map exceeds the 30000 object limit');
    const ids = new Set<string>();
    for (const e of world.objects) {
        if (!e.id || ids.has(e.id) || !kinds.includes(e.kind)) throw Error('Invalid or duplicate object ID');
        ids.add(e.id);
        for (const key of ['id', 'type', 'name', 'parent', 'roof'] as const)
            if (typeof e[key] !== 'string' || e[key].length > 2048) throw Error('Invalid object text');

        if (fields.some(key => !Number.isFinite(e[key]) || Math.abs(e[key]) > 200000)) throw Error('Invalid object dimensions');
        if (!Number.isInteger(e.seed) || e.seed < 0 || e.seed > 0xffffffff || ![0, 1, 2].includes(e.detail) || typeof e.generated !== 'boolean') throw Error('Invalid procedural settings');
        if (e.scale <= 0 || e.radius < 0 || e.weight < 0 || e.height <= 0) throw Error('Invalid object size or weight');
        if (['building', 'passage', 'region'].includes(e.kind)) {
            const error = polygonError(e.polygon);
            if (error) throw Error(error);
        } else if (e.polygon.length) throw Error('Point objects cannot contain polygons');
    }
    for (const e of world.objects.filter(object => object.kind === 'passage')) {
        const parent = world.objects.find(p => p.id === e.parent && p.kind === 'building');
        if (!parent || e.clearance <= 0 || e.floor + e.clearance > parent.height || !overlaps(e.polygon, parent.polygon)) throw Error('Passage must intersect its building and fit below its roof');
    }
    if (world.rules) {
        const { winTime, waves } = world.rules;
        if (!Number.isInteger(winTime) || winTime < 1 || winTime > 86400 ||
            !waves || typeof waves !== 'object' || Array.isArray(waves)) throw Error('Invalid map rules');
        const names = new Set(VARIANTS.map(v => v.name));
        let total = 0;
        for (const [id, list] of Object.entries(waves)) {
            if (!world.objects.some(e => e.id === id && e.kind === 'spawn') || !Array.isArray(list) || list.length > 65535)
                throw Error('Invalid wave spawn or wave count');
            let previous = -1;
            for (const wave of list) {
                if (!Number.isInteger(wave.time) || wave.time < 0 || wave.time > 86400 || wave.time < previous ||
                    !wave.counts || typeof wave.counts !== 'object' || Array.isArray(wave.counts)) throw Error('Invalid wave time or counts');
                previous = wave.time;
                for (const [name, count] of Object.entries(wave.counts)) {
                    if (!names.has(name) || !Number.isInteger(count) || count < 0 || count > MAX_ZOMBIES)
                        throw Error('Invalid wave zombie type or count');
                    total += count;
                    if (total > MAX_ZOMBIES) throw Error('Waves exceed the 100000 zombie limit');
                }
            }
        }
    }
    if (world.preview) {
        const p = world.preview;
        const png = p[0] === 137 && p[1] === 80 && p[2] === 78 && p[3] === 71 &&
            p[4] === 13 && p[5] === 10 && p[6] === 26 && p[7] === 10;
        const jpeg = p[0] === 255 && p[1] === 216 && p[2] === 255;
        if (!(p instanceof Uint8Array) || p.length > 512 * 1024 || (!png && !jpeg)) throw Error('Invalid map preview');
    }
    if (world.objects.filter(e => e.kind === 'objective').length > 1) throw Error('Only one primary objective is allowed');
    if (!world.source || typeof world.source.attribution !== 'string' || typeof world.source.imported !== 'string' || typeof world.source.elevation !== 'string' || !Array.isArray(world.source.bounds) || world.source.bounds.length > 4 || world.source.bounds.some(v => !Number.isFinite(v))) throw Error('Invalid source metadata');
}

export function encodeMap(world: World): Uint8Array {
    validateWorld(world);
    const output = new Writer();
    output.raw(textEncoder.encode('MAPX'));
    output.number(1, 'u16');
    output.number(0, 'u16');
    const section = (tag: number, write: (w: Writer) => void) => {
        const w = new Writer();
        write(w);
        output.number(tag, 'u16');
        output.number(w.length, 'u32');
        output.raw(w.finish());
    };
    section(1, w => {
        w.text(world.name);
        for (const n of [world.origin.lat, world.origin.lon, world.width, world.depth]) w.number(n, 'f64');
        w.text(JSON.stringify(world.source));
    });
    section(2, w => {
        const t = world.terrain;
        w.number(t.columns, 'u16');
        w.number(t.rows, 'u16');
        w.number(t.base, 'f64');
        for (const grid of [t.heights, t.original]) for (const n of grid) w.number(Math.round((n - t.base) * 10), 'i16');
    });
    section(3, w => {
        w.number(world.objects.length, 'u32');
        for (const e of world.objects) {
            w.number(kinds.indexOf(e.kind), 'u8');
            for (const key of ['id', 'type', 'name', 'parent', 'roof'] as const) w.text(e[key]);
            for (const key of fields) w.number(e[key], 'f64');
            w.number(e.seed, 'u32');
            w.number(e.detail, 'u8');
            w.number(e.generated ? 1 : 0, 'u8');
            w.number(e.polygon.length, 'u16');
            for (const p of e.polygon) {
                w.number(Math.round(p.x * 100), 'i32');
                w.number(Math.round(p.z * 100), 'i32');
            }
        }
    });
    if (world.rules) section(4, w => {
        w.number(world.rules!.winTime, 'u32');
        w.number(VARIANTS.length, 'u8');
        for (const variant of VARIANTS) w.text(variant.name);
        const spawns = Object.entries(world.rules!.waves);
        w.number(spawns.length, 'u16');
        for (const [id, waves] of spawns) {
            w.text(id);
            w.number(waves.length, 'u16');
            for (const wave of waves) {
                w.number(wave.time, 'u32');
                for (const variant of VARIANTS) w.number(wave.counts[variant.name] ?? 0, 'u32');
            }
        }
    });
    if (world.preview) section(5, w => w.raw(world.preview!));
    return output.finish();
}

export function decodeMap(bytes: Uint8Array): World {
    if (!(bytes instanceof Uint8Array) || bytes.length > MAX_FILE_SIZE) throw Error('Invalid MAPX file size');
    const r = new Reader(bytes);
    if (textDecoder.decode(r.raw(4)) !== 'MAPX') throw Error('Not a MAPX file');
    if (r.number('u16') !== 1 || r.number('u16') !== 0) throw Error('Unsupported MAPX version or flags');
    const seen = new Set<number>();
    const world: World = {
        version: 1, name: '', origin: { lat: 0, lon: 0 }, width: 0, depth: 0,
        terrain: { columns: 0, rows: 0, base: 0, heights: [], original: [] }, objects: [],
        source: { attribution: '', imported: '', elevation: '', bounds: [] }
    };
    while (r.offset < bytes.length) {
        const tag = r.number('u16');
        const s = new Reader(r.raw(r.number('u32')));
        if (seen.has(tag)) throw Error('Duplicate MAPX section');
        seen.add(tag);
        if (tag === 1) {
            world.name = s.text();
            world.origin = { lat: s.number('f64'), lon: s.number('f64') };
            world.width = s.number('f64');
            world.depth = s.number('f64');
            try {
                world.source = JSON.parse(s.text());
            } catch {
                throw new Error('Invalid MAPX source metadata');
            }
        } else if (tag === 2) {
            const columns = s.number('u16'), rows = s.number('u16'), base = s.number('f64');
            if (columns < 2 || rows < 2 || columns > 513 || rows > 513) throw Error('Invalid terrain grid');
            const grid = () => Array.from({ length: columns * rows }, () => base + s.number('i16') / 10);
            world.terrain = { columns, rows, base, heights: grid(), original: grid() };
        } else if (tag === 3) {
            const count = s.number('u32');
            if (count > 30000) throw Error('Too many objects');
            for (let i = 0; i < count; i++) {
                const kind = kinds[s.number('u8')];
                const e = { kind } as Entity;
                for (const key of ['id', 'type', 'name', 'parent', 'roof'] as const) e[key] = s.text();
                for (const key of fields) e[key] = s.number('f64');
                e.seed = s.number('u32');
                e.detail = s.number('u8');
                const generated = s.number('u8');
                if (generated > 1) throw Error('Invalid generated flag');
                e.generated = generated === 1;
                const length = s.number('u16');
                if (length > 4096) throw Error('Too many polygon vertices');
                e.polygon = Array.from({ length }, () => ({ x: s.number('i32') / 100, z: s.number('i32') / 100 }));
                world.objects.push(e);
            }
        } else if (tag === 4) {
            const winTime = s.number('u32'), types = Array.from({ length: s.number('u8') }, () => s.text());
            if (new Set(types).size !== types.length || types.some(name => !VARIANTS.some(v => v.name === name)))
                throw Error('Unknown or duplicate wave zombie type');
            const waves: Record<string, Array<Wave>> = Object.create(null);
            const count = s.number('u16');
            for (let i = 0; i < count; i++) {
                const id = s.text();
                if (Object.prototype.hasOwnProperty.call(waves, id)) throw Error('Duplicate wave spawn');
                waves[id] = Array.from({ length: s.number('u16') }, () => ({ time: s.number('u32'),
                    counts: Object.fromEntries(types.map(name => [name, s.number('u32')])) }));
            }
            world.rules = { winTime, waves };
        } else if (tag === 5) {
            if (s.bytes.length > 512 * 1024) throw Error('Map preview exceeds 512 KiB');
            world.preview = s.raw(s.bytes.length).slice();
        } else continue;
        if (s.offset !== s.bytes.length) throw Error('Invalid MAPX section length');
    }
    if (![1, 2, 3].every(tag => seen.has(tag))) throw Error('Missing required MAPX section');
    validateWorld(world);
    return world;
}

export function downloadMap(world: World, filename = 'battlefield.mapx') {
    const bytes = encodeMap(world);
    const url = URL.createObjectURL(new Blob([bytes]));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function readMapFile(file: File): Promise<World> {
    if (file.size > MAX_FILE_SIZE) throw Error('Map exceeds the 32 MiB file limit');
    return decodeMap(new Uint8Array(await file.arrayBuffer()));
}
