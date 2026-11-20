import { area, contains, polygonError, type Entity, type Point, type World } from '../mapx.js';
import { blankWorld, bounds as polygonBounds, elevation, entity, seededRandom } from './world.js';
import { clip } from '../polygon-clip.js';
import { roadPolygons, roadWidth } from './roads.js';

type Coordinate = { lat: number; lon: number };
type Way = {
    type: string; id: number; geometry?: Array<Coordinate>;
    tags?: Record<string, string>; members?: Array<Way>; role?: string;
};
const meters = 111319.49079327358;
export const ELEVATION_SAMPLE_SPACING = 200;
export function project(p: Coordinate, origin: Coordinate): Point {
    return {
        x: (p.lon - origin.lon) * meters * Math.cos(origin.lat * Math.PI / 180), z: (origin.lat - p.lat) * meters
    };
}

function simplify(points: Array<Point>, tolerance: number): Array<Point> {
    const result = points.slice();
    let changed = true;
    while (changed && result.length > 3) {
        changed = false;
        for (let i = 0; i < result.length && result.length > 3; i++) {
            const a = result[(i + result.length - 1) % result.length];
            const b = result[i], c = result[(i + 1) % result.length];
            const dx = c.x - a.x, dz = c.z - a.z;
            const u = Math.max(0, Math.min(1, ((b.x - a.x) * dx + (b.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
            if (Math.hypot(b.x - a.x - u * dx, b.z - a.z - u * dz) <= tolerance) {
                result.splice(i--, 1);
                changed = true;
            }
        }
    }
    return result;
}

function splitFootprint(rings: Array<Array<Point>>): Array<Array<Point>> {
    const [outer, ...holes] = rings.map(points => points.map(p => [p.x, p.z] as [number, number]));
    const pending = clip('difference', [outer], ...holes.map(hole => [hole]));
    const result: Array<Array<Point>> = [];
    let splits = 0;
    while (pending.length) {
        const polygon = pending.pop()!;
        if (polygon.length === 1) {
            result.push(polygon[0].slice(0, -1).map(([x, z]) => ({ x, z })));
            continue;
        }
        if (++splits > 4096) throw Error('Courtyard footprint is too complex');
        const hole = polygon[1];
        const cut = (Math.min(...hole.map(p => p[0])) + Math.max(...hole.map(p => p[0]))) / 2;
        const b = polygonBounds(polygon[0].map(([x, z]) => ({ x, z })));
        for (const [left, right] of [[b.minX, cut], [cut, b.maxX]]) {
            const half: ClipPolygon = [[[left, b.minZ], [right, b.minZ], [right, b.maxZ], [left, b.maxZ]]];
            pending.push(...clip('intersection', polygon, half));
        }
    }
    return result;
}

class ServiceError extends Error {
    constructor(readonly status: number) {
        super(`Geographic service returned ${status}; retry later or reduce the region`);
    }
}

export async function jsonRequest(url: string, signal: AbortSignal, init?: RequestInit): Promise<unknown> {
    const response = await fetch(url, { ...init, signal, credentials: 'omit' });
    if (!response.ok) throw new ServiceError(response.status);
    if (!response.body) throw Error('Geographic service returned an empty response');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = '', size = 0;
    try {
        for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            size += chunk.value.byteLength;
            if (size > 24 * 1024 * 1024) {
                await reader.cancel();
                throw Error('Geographic response is too large; select a smaller region');
            }
            text += decoder.decode(chunk.value, { stream: true });
        }
        text += decoder.decode();
    } finally {
        reader.releaseLock();
    }
    try {
        return JSON.parse(text);
    } catch {
        throw Error('Geographic service returned invalid JSON');
    }
}

export async function importRegion(
    bounds: Array<number>, tolerance: number, flat: boolean, signal: AbortSignal,
    progress: (text: string) => void, overpass: string
): Promise<{ world: World; skipped: number }> {
    const [south, west, north, east] = bounds;
    if (bounds.length !== 4 || !bounds.every(Number.isFinite) || south >= north || west >= east ||
        Math.abs(south) > 84 || Math.abs(north) > 84 || west < -180 || east > 180) throw Error('Invalid geographic bounds');
    const origin = { lat: north, lon: west };
    const size = project({ lat: south, lon: east }, origin);
    if (size.x < 50 || size.z < 50 || size.x > 10000 || size.z > 10000) throw Error('Select a rectangle between 50 m and 10 km per side');
    const world = blankWorld(size.x, size.z);
    world.origin = origin;
    world.source = {
        attribution: '© OpenStreetMap contributors · ODbL', imported: new Date().toISOString(),
        elevation: flat ? 'User selected flat terrain' : 'Copernicus DEM GLO-90 via Open-Meteo · CC BY 4.0', bounds
    };
    const box = bounds.join(',');
    progress('Fetching OSM buildings, roads and land cover…');
    const query = `[out:json][timeout:40][maxsize:24000000];(way[building](${box});way[highway](${box});way[natural~"water|wood|scrub|grassland"](${box});way[landuse](${box});relation[type=multipolygon][building](${box});relation[type=multipolygon][natural=water](${box}););out geom;`;
    const request = { method: 'POST', body: new URLSearchParams({ data: query }) };
    let response: unknown;
    try {
        response = await jsonRequest(overpass, signal, request);
    } catch (error) {
        const unavailable = error instanceof TypeError ||
            error instanceof ServiceError && [502, 503, 504].includes(error.status);
        if (signal.aborted || overpass !== 'https://overpass-api.de/api/interpreter' || !unavailable) throw error;
        progress('Overpass gateway unavailable; trying overpass.private.coffee once…');
        response = await jsonRequest('https://overpass.private.coffee/api/interpreter', signal, request);
    }
    const data = response as { elements?: Array<Way>; remark?: string };
    if (!Array.isArray(data.elements) || data.remark) throw Error(data.remark || 'Invalid OSM response');
    if (data.elements.length > 12000) throw Error('Too many source features; choose a smaller region');
    let skipped = 0;
    const grass: Array<{ region: Entity; spacing: number }> = [];
    const memberIds = new Set(data.elements.filter(e => e.type === 'relation').flatMap(e => (e.members || []).map(m => m.id)));
    const add = (source: Way, geometry: Array<Coordinate>, suffix: string, holes: Array<Array<Coordinate>> = []) => {
        const tags = source.tags || {};
        if ([geometry, ...holes].some(points => points.length < 2 || points.length > 4097 ||
            points.some(p => !Number.isFinite(p.lat) || !Number.isFinite(p.lon)))) {
            skipped++;
            return;
        }
        let polygon = geometry.map(p => project(p, origin));
        if (tags.highway && !tags.building) {
            if (tags.tunnel === 'yes' || tags.area === 'yes' || ['construction', 'proposed'].includes(tags.highway))
                return;
            roadPolygons(polygon, roadWidth(tags)).forEach((points, i) => {
                if (polygonError(points)) {
                    skipped++; return;
                }
                const road = entity('region');
                road.id = `osm-road-${source.id}-${i + 1}`;
                road.type = 'road';
                road.polygon = points;
                world.objects.push(road);
            });
            return;
        }
        const first = polygon[0], last = polygon[polygon.length - 1];
        if (Math.hypot(first.x - last.x, first.z - last.z) > 0.1) {
            skipped++; return;
        }
        polygon.pop();
        polygon = simplify(polygon, tolerance);
        if (polygonError(polygon)) {
            skipped++; return;
        }
        const cutouts: Array<Array<Point>> = [];
        for (const hole of holes) {
            const points = hole.map(p => project(p, origin));
            const end = points[points.length - 1];
            if (Math.hypot(points[0].x - end.x, points[0].z - end.z) > 0.1) {
                skipped++; return;
            }
            points.pop();
            const cutout = simplify(points, tolerance);
            if (polygonError(cutout)) {
                skipped++; return;
            }
            cutouts.push(cutout);
        }
        const footprints = cutouts.length ? splitFootprint([polygon, ...cutouts]) : [polygon];
        if (!footprints.length || footprints.some(points => polygonError(points))) {
            skipped++; return;
        }
        for (const [index, footprint] of footprints.entries()) {
            const e = entity(tags.building ? 'building' : 'region');
            e.id = `osm-${source.type}-${source.id}-${suffix}${footprints.length > 1 ? `-${index}` : ''}`;
            e.polygon = footprint;
            e.name = (tags.name || '').slice(0, 200);
            e.seed = Math.abs(source.id) >>> 0;
            if (e.kind === 'building') {
                const height = parseFloat(tags.height || '') || parseFloat(tags['building:levels'] || '') * 3;
                e.height = Math.max(1, Math.min(500, height || 12));
                e.generated = !height;
                e.roof = tags['roof:shape'] === 'gabled' ? 'pitched' : 'flat';
            } else {
                e.type = tags.natural === 'water' || tags.landuse === 'reservoir' ? 'water' : 'grass';
                if (e.type === 'grass' && (['wood', 'scrub', 'grassland'].includes(tags.natural) ||
                    ['forest', 'grass', 'meadow', 'orchard', 'village_green', 'recreation_ground'].includes(tags.landuse)))
                    grass.push({ region: e, spacing: tags.natural === 'wood' || tags.landuse === 'forest' ? 24 : 40 });
            }
            world.objects.push(e);
        }
    };
    for (const source of data.elements) {
        if (source.type === 'way' && !memberIds.has(source.id) && source.geometry) add(source, source.geometry, '0');
        if (source.type === 'relation') {
            const members = source.members || [];
            if (members.some(m => m.role === 'inner') && !source.tags?.building ||
                members.some(m => ['outer', 'inner'].includes(m.role || '') &&
                    (!m.geometry || m.geometry.length < 2 || m.geometry.length > 4097))) {
                skipped++; continue;
            }
            const rings: Record<string, Array<Array<Coordinate>>> = { outer: [], inner: [] };
            for (const role of ['outer', 'inner']) {
                const parts = members.filter(m => m.role === role && m.geometry).map(m => m.geometry!.slice());
                while (parts.length) {
                    const ring = parts.shift()!;
                    let joined = true;
                    while (joined && ring.length <= 4097) {
                        joined = false;
                        const end = ring[ring.length - 1];
                        if (ring[0].lat === end.lat && ring[0].lon === end.lon) break;
                        for (let i = 0; i < parts.length; i++) {
                            const part = parts[i];
                            const equal = (p: Coordinate) => p.lat === end.lat && p.lon === end.lon;
                            if (equal(part[part.length - 1])) part.reverse();
                            if (equal(part[0])) {
                                ring.push(...part.slice(1));
                                parts.splice(i, 1);
                                joined = true;
                                break;
                            }
                        }
                    }
                    rings[role].push(ring);
                }
            }
            for (const [index, outer] of rings.outer.entries()) add(source, outer, String(index), rings.inner);
        }
    }
    if (!flat) {
        const columns = Math.max(2, Math.ceil(size.x / ELEVATION_SAMPLE_SPACING) + 1);
        const rows = Math.max(2, Math.ceil(size.z / ELEVATION_SAMPLE_SPACING) + 1);
        const coords: Array<Coordinate> = [];
        for (let z = 0; z < rows; z++) for (let x = 0; x < columns; x++) coords.push({
            lat: north - (north - south) * z / (rows - 1), lon: west + (east - west) * x / (columns - 1)
        });
        const heights: Array<number> = [];
        for (let i = 0; i < coords.length; i += 100) {
            progress(`Fetching elevation ${i + 1}–${Math.min(i + 100, coords.length)} / ${coords.length}…`);
            const chunk = coords.slice(i, i + 100);
            const params = new URLSearchParams({
                latitude: chunk.map(p => p.lat).join(','), longitude: chunk.map(p => p.lon).join(',')
            });
            const result = await jsonRequest(`https://api.open-meteo.com/v1/elevation?${params}`, signal) as {
                elevation?: Array<number>;
            };
            if (!Array.isArray(result.elevation) || result.elevation.length !== chunk.length || result.elevation.some(v => typeof v !== 'number' || !Number.isFinite(v))) throw Error('Elevation unavailable; retry or explicitly select flat terrain');
            heights.push(...result.elevation);
        }
        const editable = world.terrain;
        world.terrain = { columns, rows, base: Math.min(...heights), heights, original: heights.slice() };
        const samples: Array<number> = [];
        for (let z = 0; z < editable.rows; z++)
            for (let x = 0; x < editable.columns; x++) samples.push(elevation(world, {
                x: x * world.width / (editable.columns - 1), z: z * world.depth / (editable.rows - 1)
            }));
        world.terrain = { columns: editable.columns, rows: editable.rows, base: world.terrain.base,
            heights: samples, original: samples.slice() };
    }
    const obstacles = world.objects.filter(e => e.kind === 'building' ||
        e.kind === 'region' && ['road', 'water'].includes(e.type)).map(e => ({ polygon: e.polygon, bounds: polygonBounds(e.polygon) }));
    const occupied = new Set<string>();
    let remaining = Math.max(0, Math.min(2000, 30000 - world.objects.length));
    for (const { region, spacing } of grass) {
        if (!remaining) break;
        const b = polygonBounds(region.polygon), random = seededRandom(region.seed);
        const left = Math.max(0, b.minX), right = Math.min(world.width, b.maxX);
        const top = Math.max(0, b.minZ), bottom = Math.min(world.depth, b.maxZ);
        const width = right - left, depth = bottom - top;
        if (width <= 0 || depth <= 0) continue;
        const count = Math.min(remaining, 600,
            Math.ceil(Math.min(Math.abs(area(region.polygon)), width * depth) / spacing ** 2));
        if (!count) continue;
        const columns = Math.min(count, Math.max(1, Math.ceil(Math.sqrt(count * width / depth))));
        const rows = Math.max(1, Math.ceil(count / columns));
        for (let z = 0; z < rows && remaining; z++) for (let x = 0; x < columns && remaining; x++) {
            const p = { x: left + (x + 0.2 + random() * 0.6) * width / columns,
                z: top + (z + 0.2 + random() * 0.6) * depth / rows };
            const scale = 0.7 + random() * 0.6, radius = 5 * scale;
            const cell = `${Math.floor(p.x / 16)},${Math.floor(p.z / 16)}`;
            if (occupied.has(cell) || p.x < radius || p.z < radius ||
                p.x + radius > world.width || p.z + radius > world.depth || !contains(region.polygon, p)) continue;
            const blocked = obstacles.some(obstacle => {
                const extent = obstacle.bounds;
                if (p.x + radius < extent.minX || p.x - radius > extent.maxX ||
                    p.z + radius < extent.minZ || p.z - radius > extent.maxZ) return false;
                return contains(obstacle.polygon, p) || obstacle.polygon.some((a, i, polygon) => {
                    const next = polygon[(i + 1) % polygon.length], dx = next.x - a.x, dz = next.z - a.z;
                    const u = Math.max(0, Math.min(1,
                        ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
                    return Math.hypot(p.x - a.x - u * dx, p.z - a.z - u * dz) < radius;
                });
            });
            if (blocked) continue;
            const tree = entity('prop', p);
            tree.id = `${region.id}-tree-${x}-${z}`;
            tree.scale = scale;
            tree.rotation = random() * Math.PI * 2;
            tree.seed = Math.floor(random() * 0x100000000);
            world.objects.push(tree);
            occupied.add(cell);
            remaining--;
        }
    }
    progress(`Imported ${world.objects.length} objects; ${skipped} unsupported/invalid source features skipped`);
    return { world, skipped };
}

export class RegionPicker {
    lat = 40.7128;
    lon = -74.006;
    zoom = 15;
    selection: Array<number> = [];
    mode: 'pan' | 'bounds' = 'bounds';
    private tiles = new Map<string, HTMLImageElement>();
    private drag?: { x: number; y: number; lat: number; lon: number };
    constructor(private canvas: HTMLCanvasElement, private changed: (bounds: Array<number>) => void) {
        canvas.onpointerdown = event => {
            canvas.setPointerCapture(event.pointerId);
            this.drag = { x: event.offsetX, y: event.offsetY, lat: this.lat, lon: this.lon };
        };
        canvas.onpointermove = event => {
            if (!this.drag) return;
            if (this.mode === 'pan' || event.buttons === 4) {
                const old = this.pixel(this.drag.lat, this.drag.lon);
                const p = this.coordinate(old.x - event.offsetX + this.drag.x, old.z - event.offsetY + this.drag.y);
                this.lat = p.lat;
                this.lon = p.lon;
            } else {
                const a = this.at(this.drag.x, this.drag.y), b = this.at(event.offsetX, event.offsetY);
                this.selection = [
                    Math.min(a.lat, b.lat), Math.min(a.lon, b.lon), Math.max(a.lat, b.lat), Math.max(a.lon, b.lon)
                ];
                this.changed(this.selection);
            }
            this.draw();
        };
        canvas.onpointerup = () => {
            this.drag = undefined;
        };
        canvas.onpointercancel = () => {
            this.drag = undefined;
        };
        canvas.onwheel = event => {
            event.preventDefault();
            this.zoom = Math.max(3, Math.min(18, this.zoom + (event.deltaY < 0 ? 1 : -1)));
            this.draw();
        };
    }
    private pixel(lat: number, lon: number) {
        const scale = 256 * 2 ** this.zoom;
        const sine = Math.sin(Math.max(-85, Math.min(85, lat)) * Math.PI / 180);
        return { x: (lon + 180) / 360 * scale, z: (0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * scale };
    }
    private coordinate(x: number, y: number): Coordinate {
        const scale = 256 * 2 ** this.zoom;
        return { lon: x / scale * 360 - 180, lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * y / scale))) * 180 / Math.PI };
    }
    private at(x: number, y: number) {
        const c = this.pixel(this.lat, this.lon);
        return this.coordinate(c.x + x - this.canvas.width / 2, c.z + y - this.canvas.height / 2);
    }
    draw() {
        const c = this.canvas, ctx = c.getContext('2d')!;
        c.width = c.clientWidth;
        c.height = c.clientHeight;
        ctx.fillStyle = '#dfe3da';
        ctx.fillRect(0, 0, c.width, c.height);
        const middle = this.pixel(this.lat, this.lon);
        const left = middle.x - c.width / 2, top = middle.z - c.height / 2;
        for (let y = Math.floor(top / 256); y <= Math.floor((top + c.height) / 256); y++)
            for (let x = Math.floor(left / 256); x <= Math.floor((left + c.width) / 256); x++) {
                if (x < 0 || y < 0 || x >= 2 ** this.zoom || y >= 2 ** this.zoom) continue;
                const key = `${this.zoom}/${x}/${y}`;
                let image = this.tiles.get(key);
                if (!image) {
                    if (this.tiles.size > 120) this.tiles.delete(this.tiles.keys().next().value!);
                    image = new Image();
                    image.onload = () => this.draw();
                    image.src = `https://tile.openstreetmap.org/${key}.png`;
                    this.tiles.set(key, image);
                }
                if (image.complete && image.naturalWidth) ctx.drawImage(image, x * 256 - left, y * 256 - top);
            }

        if (this.selection.length) {
            const [s, w, n, e] = this.selection;
            const a = this.pixel(n, w), b = this.pixel(s, e);
            ctx.fillStyle = '#6d648d44';
            ctx.strokeStyle = '#594a7d';
            ctx.lineWidth = 2;
            ctx.fillRect(a.x - left, a.z - top, b.x - a.x, b.z - a.z);
            ctx.strokeRect(a.x - left, a.z - top, b.x - a.x, b.z - a.z);
        }
    }
}
