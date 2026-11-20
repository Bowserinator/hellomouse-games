import {
    contains, decodeMap, downloadMap, encodeMap, polygonError, readMapFile, validateWorld,
    type Entity, type Point, type World
} from '../mapx.js';
import { blankWorld, bounds, center, elevation, entity, Saves, sculpt, warnings, type Brush } from './world.js';
import { cloneWorld, History } from './history.js';
import { ELEVATION_SAMPLE_SPACING, importRegion, jsonRequest, project, RegionPicker } from './geography.js';
import { Preview } from './preview.js';
import { checkWebGPU } from '../webgpu.js';
import { formatTime, parseTime, waveEditor, waveSummary } from './waves.js';
import { mapPreview } from './map-preview.js';

void checkWebGPU();

function element<T extends HTMLElement>(id: string): T {
    const found = document.getElementById(id);
    if (!found) throw Error(`Missing editor element ${id}`);
    return found as T;
}
type EditorDialog = HTMLDialogElement & { showModal(): void; close(): void; open: boolean };
const canvas = element<HTMLCanvasElement>('map');
const context = canvas.getContext('2d')!;
const properties = element('properties');
const saves = new Saves();
let world = blankWorld();
let history = new History();
let selected = '';
let vertex = -1;
let tool = 'select';
let points: Array<Point> = [];
let passageParent = '';
let cursor: Point = { x: 0, z: 0 };
let pan = { x: 50, z: 50 };
let zoom = 1;
let space = false;
let preview: Preview | undefined;
let mode3d = false;
let queued = false;
let autosaveTimer: ReturnType<typeof setTimeout> | undefined;
let inspectorBefore: World | undefined;
let dirty = false;
let recovering = true;
let editRevision = 0;
let drag: {
    mode: 'pan' | 'vertex' | 'move' | 'scale' | 'rotate' | 'terrain';
    start: Point; screen: Point; pan: Point; before: World; vertex: number;
} | undefined;
const brush: Brush = { mode: 'raise', radius: 35, strength: 2, falloff: 70, target: 0 };
let paint = 'grass';
let propType = 'tree';
const palette: Record<string, string> = {
    building: '#cdcdc7', passage: '#cda86a88', grass: '#b8c7a2', road: '#eeeade', water: '#96becd'
};

function notice(message: string) {
    element('notice').textContent = message;
}
function fail(error: unknown) {
    notice(error instanceof Error ? error.message : String(error));
}
function selection() {
    return world.objects.find(e => e.id === selected);
}
function local(x: number, y: number): Point {
    return { x: (x - pan.x) / zoom, z: (y - pan.z) / zoom };
}
function screen(p: Point): Point {
    return { x: p.x * zoom + pan.x, z: p.z * zoom + pan.z };
}
function snapped(p: Point): Point {
    return element<HTMLInputElement>('snap').checked ? { x: Math.round(p.x), z: Math.round(p.z) } : p;
}
function fit() {
    const viewport = element('viewport');
    zoom = Math.min((viewport.clientWidth - 70) / world.width, (viewport.clientHeight - 70) / world.depth);
    zoom = Math.max(0.01, zoom);
    pan = { x: (viewport.clientWidth - world.width * zoom) / 2, z: (viewport.clientHeight - world.depth * zoom) / 2 };
    if (mode3d) preview?.focus(world, { x: world.width / 2, z: world.depth / 2 }, world.width);
    draw();
}
function changed() {
    if (preview?.stopSimulation()) notice('Simulation stopped: map edited');
    dirty = true;
    editRevision++;
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
        try {
            const bytes = encodeMap(world);
            void saves.save('Autosave', bytes).catch(error => notice(`Autosave failed: ${String(error)}. Export MAPX to keep your work.`));
        } catch (error) {
            fail(error);
        }
    }, 700);
    refreshWarnings();
    draw();
}
function commit(before: World) {
    try {
        validateWorld(world);
        if (history.commit(before, world)) changed();
    } catch (error) {
        world = before;
        fail(error);
        draw();
    }
    refreshInspector();
}
function refreshWarnings() {
    const list = element('warnings');
    list.replaceChildren();
    for (const message of warnings(world)) {
        const item = document.createElement('li');
        item.textContent = message;
        list.append(item);
    }
    element('attribution').textContent = [world.source.attribution, world.source.elevation].filter(Boolean).join(' · ');
    refreshSimulationControls();
}
function path(polygon: Array<Point>) {
    context.beginPath();
    polygon.forEach((p, i) => {
        const q = screen(p);
        if (i) context.lineTo(q.x, q.z); else context.moveTo(q.x, q.z);
    });
    context.closePath();
}
function handle(p: Point, radius: number, fill: string, square = false) {
    const q = screen(p);
    context.fillStyle = fill;
    context.strokeStyle = '#faf9f4';
    context.lineWidth = 1.5;
    context.beginPath();
    if (square) context.rect(q.x - radius, q.z - radius, radius * 2, radius * 2);
    else context.arc(q.x, q.z, radius, 0, Math.PI * 2);
    context.fill();
    context.stroke();
}
function transformHandles(e: Entity) {
    const raw = bounds(e.polygon);
    const margin = 18 / zoom;
    const b = { minX: raw.minX - margin, maxX: raw.maxX + margin,
        minZ: raw.minZ - margin, maxZ: raw.maxZ + margin };
    return {
        corners: [{ x: b.minX, z: b.minZ }, { x: b.maxX, z: b.minZ },
            { x: b.maxX, z: b.maxZ }, { x: b.minX, z: b.maxZ }],
        rotation: { x: (b.minX + b.maxX) / 2, z: b.minZ - 30 / zoom }
    };
}
function draw() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
        queued = false;
        if (mode3d) {
            try {
                preview?.sync(world);
            } catch (error) {
                fail(error);
            }
            return;
        }
        const width = canvas.clientWidth, height = canvas.clientHeight, ratio = Math.min(devicePixelRatio, 2);
        if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
            canvas.width = Math.round(width * ratio);
            canvas.height = Math.round(height * ratio);
        }
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        context.clearRect(0, 0, width, height);
        context.fillStyle = '#b9c8a6';
        context.fillRect(pan.x, pan.z, world.width * zoom, world.depth * zoom);
        const t = world.terrain;
        const dx = world.width / (t.columns - 1), dz = world.depth / (t.rows - 1);
        let low = Infinity, high = -Infinity;
        for (const value of t.heights) {
            low = Math.min(low, value);
            high = Math.max(high, value);
        }
        if (high - low > 0.1)
            for (let z = 0; z < t.rows - 1; z++) for (let x = 0; x < t.columns - 1; x++) {
                const p = screen({ x: x * dx, z: z * dz });
                if (p.x > width || p.z > height || p.x + dx * zoom < 0 || p.z + dz * zoom < 0) continue;
                const value = (t.heights[z * t.columns + x] - low) / (high - low);
                context.fillStyle = `hsl(85, 21%, ${72 - value * 14}%)`;
                context.fillRect(p.x, p.z, dx * zoom + 1, dz * zoom + 1);
            }

        const ordered = [
            ...world.objects.filter(e => e.kind === 'region' && e.type !== 'placeable'), ...world.objects.filter(e => e.kind === 'building'),
            ...world.objects.filter(e => !['region', 'building'].includes(e.kind))
        ];
        for (const e of ordered) {
            const c = screen(center(e));
            if (e.polygon.length) {
                const b = bounds(e.polygon);
                if (b.minX * zoom + pan.x > width || b.maxX * zoom + pan.x < 0 ||
                    b.minZ * zoom + pan.z > height || b.maxZ * zoom + pan.z < 0) continue;
                path(e.polygon);
                context.fillStyle = palette[e.kind === 'region' ? e.type : e.kind] || palette.grass;
                context.fill();
                context.strokeStyle = e.id === selected ? '#716282' : e.kind === 'passage' ? '#ac7a36' : '#818b7966';
                context.lineWidth = e.id === selected ? 2 : 1;
                context.setLineDash(e.kind === 'passage' ? [4, 3] : []);
                context.stroke();
                context.setLineDash([]);
                if (e.kind === 'passage') {
                    context.save();
                    context.clip();
                    const b2 = bounds(e.polygon), a = screen({ x: b2.minX, z: b2.minZ });
                    const b3 = screen({ x: b2.maxX, z: b2.maxZ });
                    context.strokeStyle = '#9b783d66';
                    context.beginPath();
                    for (let x = a.x - (b3.z - a.z); x < b3.x; x += 9) {
                        context.moveTo(x, a.z);
                        context.lineTo(x + b3.z - a.z, b3.z);
                    }
                    context.stroke();
                    context.restore();
                }
                if (e.id === selected && e.kind === 'building') {
                    context.fillStyle = '#41483d';
                    context.font = '11px system-ui';
                    context.fillText(`${e.height.toFixed(1)} m`, c.x + 4, c.z - 4);
                }
            } else {
                if (c.x < -150 || c.z < -150 || c.x > width + 150 || c.z > height + 150) continue;
                const radius = e.kind === 'spawn' ? e.radius * zoom : (e.kind === 'prop' ? 5 * e.scale * zoom : 7);
                context.beginPath();
                context.arc(c.x, c.z, Math.max(4, radius), 0, Math.PI * 2);
                context.fillStyle = e.kind === 'objective' ? '#b8824e' : e.kind === 'spawn' ? '#b7728244' : '#6b8d59';
                context.strokeStyle = e.id === selected ? '#716282' : e.kind === 'spawn' ? '#a65d71' : '#64705c';
                context.lineWidth = e.id === selected ? 3 : 1.5;
                context.fill();
                context.stroke();
                context.fillStyle = '#faf9f4';
                context.font = '11px system-ui';
                context.textAlign = 'center';
                context.fillText(e.kind === 'objective' ? 'D' : e.kind === 'spawn' ? 'S' : '', c.x, c.z + 4);
                context.textAlign = 'start';
            }
        }
        context.strokeStyle = '#6d7864';
        context.lineWidth = 1;
        context.strokeRect(pan.x, pan.z, world.width * zoom, world.depth * zoom);
        const e = selection();
        if (e?.polygon.length && tool === 'select') {
            const handles = transformHandles(e);
            context.setLineDash([4, 4]);
            path(handles.corners);
            context.strokeStyle = '#716282';
            context.stroke();
            context.setLineDash([]);
            handles.corners.forEach(p => handle(p, 5, '#716282', true));
            handle(handles.rotation, 6, '#716282');
            e.polygon.forEach((p, i) => {
                const next = e.polygon[(i + 1) % e.polygon.length];
                handle({ x: (p.x + next.x) / 2, z: (p.z + next.z) / 2 }, 3.5, '#a08eb3');
                handle(p, i === vertex ? 6 : 4.5, i === vertex ? '#b57944' : '#716282');
            });
        }
        if (points.length) {
            const closing = points.length >= 3 &&
                Math.hypot(cursor.x - points[0].x, cursor.z - points[0].z) * zoom < 10;
            context.beginPath();
            [...points, closing ? points[0] : cursor].forEach((p, i) => {
                const q = screen(p);
                if (i) context.lineTo(q.x, q.z); else context.moveTo(q.x, q.z);
            });
            context.strokeStyle = '#716282';
            context.lineWidth = 1.5;
            context.stroke();
            points.forEach((p, i) => handle(p, i === 0 ? closing ? 7 : 5 : 4, '#716282'));
            if (closing) {
                const q = screen(points[0]);
                context.fillStyle = '#716282';
                context.fillText('Close polygon', q.x + 12, q.z - 12);
            }
        }
        if (tool === 'terrain') {
            const p = screen(cursor);
            context.beginPath();
            context.arc(p.x, p.z, brush.radius * zoom, 0, Math.PI * 2);
            context.strokeStyle = '#716282';
            context.stroke();
        }
        const scale = 10 ** Math.floor(Math.log10(100 / zoom));
        context.strokeStyle = '#41483d';
        context.beginPath();
        context.moveTo(16, 25);
        context.lineTo(16 + scale * zoom, 25);
        context.stroke();
        context.fillStyle = '#41483d';
        context.font = '11px system-ui';
        context.fillText(`${scale} m`, 16, 17);
        element('status').textContent = `${world.width.toFixed(0)} × ${world.depth.toFixed(0)} m · ` +
            `X ${cursor.x.toFixed(1)} / Z ${cursor.z.toFixed(1)} m · ${world.objects.length} objects` +
            (e ? ` · ${e.kind}${vertex >= 0 ? ` / vertex ${vertex + 1}` : ''}` : '');
    });
}

function button(label: string, action: () => void) {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = action;
    properties.append(b);
}
function heading(text: string) {
    const h = document.createElement('h2');
    h.textContent = text;
    properties.append(h);
}
function choice(label: string, value: string, options: Array<string>, change: (value: string) => void) {
    const row = document.createElement('label');
    row.textContent = label;
    const input = document.createElement('select');
    for (const option of options) input.add(new Option(option, option));
    input.value = value;
    input.onchange = () => change(input.value);
    row.append(input);
    properties.append(row);
}
function numberControl(
    label: string, value: number, min: number, max: number, step: number,
    change: (value: number) => void, transaction = false, slider = true
) {
    const row = document.createElement('label');
    row.textContent = label;
    const controls = document.createElement('span');
    controls.className = 'value-control';
    const range = document.createElement('input'), input = document.createElement('input');
    range.type = 'range';
    input.type = 'number';
    for (const field of [range, input]) {
        field.min = String(min);
        field.max = String(max);
        field.step = String(step);
        field.value = String(value);
        field.setAttribute('aria-label', label);
        field.oninput = () => {
            const next = Number(field.value);
            if (!field.value || !Number.isFinite(next) || next < min || next > max) return;
            if (transaction && !inspectorBefore) inspectorBefore = cloneWorld(world);
            change(next);
            range.value = input.value = String(next);
            draw();
        };
        field.onchange = () => {
            if (transaction && inspectorBefore) {
                const before = inspectorBefore;
                inspectorBefore = undefined;
                commit(before);
            }
        };
    }
    if (slider) controls.append(range);
    controls.append(input);
    row.append(controls);
    properties.append(row);
}
function textControl(label: string, value: string, change: (value: string) => void) {
    const row = document.createElement('label');
    row.textContent = label;
    const input = document.createElement('input');
    input.value = value;
    input.maxLength = 200;
    input.onchange = () => {
        const before = cloneWorld(world);
        try {
            change(input.value);
            commit(before);
        } catch (error) {
            world = before;
            fail(error);
            refreshInspector();
        }
    };
    row.append(input);
    properties.append(row);
}
function refreshInspector() {
    properties.replaceChildren();
    element<HTMLInputElement>('map-name').value = world.name;
    const e = selection();
    if (tool === 'terrain') {
        heading('Terrain');
        choice('Brush', brush.mode, ['raise', 'lower', 'flatten', 'smooth', 'set', 'reset'], value => {
            brush.mode = value;
        });
        const t = world.terrain;
        const spacing = Math.hypot(world.width / (t.columns - 1), world.depth / (t.rows - 1));
        const minimum = Math.max(2, Math.ceil(spacing / 2));
        brush.radius = Math.max(minimum, brush.radius);
        numberControl('Radius (m)', brush.radius, minimum, Math.max(100, minimum), 1, value => {
            brush.radius = value;
        });
        numberControl('Strength (m)', brush.strength, 0.1, 10, 0.1, value => {
            brush.strength = value;
        });
        numberControl('Falloff (%)', brush.falloff, 0, 100, 1, value => {
            brush.falloff = value;
        });
        numberControl('Target elevation (m)', brush.target, world.terrain.base - 1000, world.terrain.base + 1000,
            0.1, value => {
                brush.target = value;
            }, false, false);
        button('Sample target at cursor', () => {
            brush.target = elevation(world, cursor); refreshInspector();
        });
        button('Reset all terrain', () => {
            if (!confirm('Restore all imported elevations?')) return;
            const before = cloneWorld(world);
            world.terrain.heights = world.terrain.original.slice();
            commit(before);
        });
        return;
    }
    if (tool === 'paint') {
        heading('Land cover');
        choice('Material', paint, ['grass', 'road', 'water'], value => {
            paint = value;
        });
        return;
    }
    if (tool === 'prop') {
        heading('Large prop');
        choice('Type', propType, ['tree', 'cluster', 'tank', 'container', 'rock', 'barrier', 'fence', 'tower'], value => {
            propType = value;
        });
        return;
    }
    if (!e) {
        heading('Battlefield');
        textControl('Win time (h:mm:ss)', formatTime(world.rules?.winTime ?? 720), value => {
            const seconds = parseTime(value);
            if (!seconds) throw Error('Win time must be positive');
            world.rules ??= { winTime: seconds, waves: {} };
            world.rules.winTime = seconds;
        });
        const summary = waveSummary(world), info = document.createElement('p');
        info.textContent = `First wave: ${summary.first === undefined ? 'None' : formatTime(summary.first)} · ${summary.total} / 100000 zombies`;
        properties.append(info);
        const p = document.createElement('p');
        p.textContent = 'Select an object to edit. Draw polygons with clicks; press Enter to finish.';
        properties.append(p);
        return;
    }
    heading(e.kind);
    textControl('Name', e.name, value => {
        e.name = value;
    });
    const number = (label: string, key: 'height' | 'clearance' | 'floor' | 'radius' | 'scale' | 'weight' | 'rotation',
        min: number, max: number, step: number) => {
        numberControl(label, e[key], min, max, step, value => {
            e[key] = value;
            if (key === 'height') e.generated = false;
        }, true);
    };
    if (e.kind === 'building') {
        number('Height (m)', 'height', 1, Math.max(150, e.height), 0.5);
        choice('Roof', e.roof, ['flat', 'pitched'], value => {
            const before = cloneWorld(world); e.roof = value; commit(before);
        });
        choice('Roof details', String(e.detail), ['0', '1', '2'], value => {
            const before = cloneWorld(world); e.detail = Number(value); commit(before);
        });
        numberControl('Detail seed', e.seed, 0, 0xffffffff, 1, value => {
            e.seed = value;
        }, true, false);
        button('Draw passage', () => setTool('passage'));
    }
    if (e.kind === 'passage') {
        number('Floor offset (m)', 'floor', -20, 20, 0.25);
        number('Clearance (m)', 'clearance', 0.25, 20, 0.25);
        const help = document.createElement('p');
        help.textContent = 'Floor is relative to building base. A below-ground opening does not excavate terrain.';
        properties.append(help);
    }
    if (e.kind === 'spawn') {
        number('Radius (m)', 'radius', 1, 100, 1);
        if (!world.rules?.waves[e.id]) number('Relative weight', 'weight', 0, 10, 0.1);
        waveEditor(properties, world, e.id, commit);
    }
    if (e.kind === 'prop') number('Scale', 'scale', 0.5, 3, 0.05);
    if (!e.polygon.length) number('Rotation (radians)', 'rotation', -Math.PI, Math.PI, 0.01);
    if (e.kind === 'region') choice('Area type', e.type, ['grass', 'road', 'water'], value => {
        const before = cloneWorld(world); e.type = value; commit(before);
    });
    if (vertex >= 0) button('Delete selected vertex', removeSelected);
    button('Delete object', () => {
        vertex = -1; removeSelected();
    });
}

function setTool(next: string) {
    if (next === 'passage') {
        const e = selection();
        if (!e || !['building', 'passage'].includes(e.kind)) {
            notice('Select a building before drawing a passage');
            return;
        }
        passageParent = e.kind === 'building' ? e.id : e.parent;
    }
    tool = next;
    points = [];
    vertex = -1;
    document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach(b => {
        b.setAttribute('aria-pressed', String(b.dataset.tool === tool));
    });
    notice(tool === 'select' ? 'Drag vertices to reshape; click midpoints to insert. Purple squares scale; the upper circle rotates.'
        : ['building', 'passage', 'paint'].includes(tool)
            ? 'Click to outline edges, then click near the first point to close. Enter also finishes; Escape cancels.'
            : tool === 'terrain' ? 'Drag to sculpt. Terrain is edited in 2D; inspect the result in 3D.' : `Click to ${tool === 'delete' ? 'delete an object' : `place ${tool}`}.`);
    refreshInspector();
    draw();
}
function finishPolygon() {
    if (!['building', 'passage', 'paint'].includes(tool)) return;
    const error = polygonError(points);
    if (error) {
        notice(error); return;
    }
    const before = cloneWorld(world);
    const e = entity(tool === 'building' ? 'building' : tool === 'passage' ? 'passage' : 'region');
    e.polygon = points.map(p => ({ ...p }));
    if (tool === 'passage') e.parent = passageParent;
    if (tool === 'paint') e.type = paint;
    world.objects.push(e);
    selected = e.id;
    try {
        validateWorld(world);
        points = [];
        commit(before);
        setTool('select');
    } catch (error2) {
        world = before; fail(error2);
    }
    draw();
}
function removeSelected() {
    const e = selection();
    if (!e) return;
    const before = cloneWorld(world);
    if (vertex >= 0 && e.polygon.length) {
        if (e.polygon.length <= 3) {
            notice('A polygon must keep at least three vertices'); return;
        }
        e.polygon.splice(vertex, 1);
        vertex = -1;
    } else {
        const children = world.objects.filter(p => p.parent === e.id).length;
        if (children && !confirm(`Delete this building and its ${children} passages?`)) return;
        world.objects = world.objects.filter(p => p.id !== e.id && p.parent !== e.id);
        if (world.rules) delete world.rules.waves[e.id];
        selected = '';
    }
    commit(before);
}
function hit(p: Point) {
    const pointObjects = world.objects.filter(e => !e.polygon.length).reverse();
    return pointObjects.find(e => Math.hypot(e.x - p.x, e.z - p.z) * zoom < Math.max(9, e.kind === 'spawn' ? e.radius * zoom : 9)) ||
        ['passage', 'building', 'region'].map(kind => world.objects.filter(e => e.kind === kind && (e.kind !== 'region' || e.type !== 'placeable')).reverse()
            .find(e => contains(e.polygon, p))).find(Boolean);
}
function transform(e: Entity, original: Entity, pivot: Point, scale: number, angle: number, offset: Point) {
    const move = (p: Point) => ({
        x: pivot.x + ((p.x - pivot.x) * Math.cos(angle) - (p.z - pivot.z) * Math.sin(angle)) * scale + offset.x,
        z: pivot.z + ((p.x - pivot.x) * Math.sin(angle) + (p.z - pivot.z) * Math.cos(angle)) * scale + offset.z
    });
    e.polygon = original.polygon.map(move);
    const p = move(original);
    e.x = p.x;
    e.z = p.z;
    e.rotation = original.rotation + angle;
}
canvas.onpointerdown = event => {
    if (mode3d || recovering) return;
    canvas.focus();
    canvas.setPointerCapture(event.pointerId);
    const pointer = local(event.offsetX, event.offsetY);
    const p = snapped(pointer);
    cursor = pointer;
    const before = cloneWorld(world);
    const startDrag = (dragMode: NonNullable<typeof drag>['mode'], index = -1) => {
        drag = { mode: dragMode, start: p, screen: { x: event.offsetX, z: event.offsetY },
            pan: { ...pan }, before, vertex: index };
    };
    if (event.button === 1 || space || event.button === 2) {
        startDrag('pan'); return;
    }
    if (tool === 'terrain') {
        if (brush.mode === 'flatten') brush.target = elevation(world, p);
        sculpt(world, p, brush, 0.25);
        startDrag('terrain');
        draw();
        return;
    }
    if (['building', 'passage', 'paint'].includes(tool)) {
        const closing = points.length >= 3 &&
            Math.hypot(pointer.x - points[0].x, pointer.z - points[0].z) * zoom < 10;
        if (closing) finishPolygon(); else points.push(p);
        draw();
        return;
    }
    if (['prop', 'objective', 'spawn'].includes(tool)) {
        const e = tool === 'objective' ? world.objects.find(object => object.kind === 'objective') || entity('objective', p)
            : entity(tool === 'prop' ? 'prop' : 'spawn', p);
        e.x = p.x;
        e.z = p.z;
        if (tool === 'prop') e.type = propType;
        if (!world.objects.includes(e)) world.objects.push(e);
        selected = e.id;
        commit(before);
        return;
    }
    const e = selection();
    if (e?.polygon.length && tool === 'select') {
        const close = (q: Point) => Math.hypot(q.x - p.x, q.z - p.z) * zoom < 9;
        const index = e.polygon.findIndex(close);
        if (index >= 0) {
            vertex = index;
            startDrag('vertex', index);
            refreshInspector();
            draw();
            return;
        }
        for (let i = 0; i < e.polygon.length; i++) {
            const a = e.polygon[i], b = e.polygon[(i + 1) % e.polygon.length];
            const midpoint = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
            if (close(midpoint)) {
                e.polygon.splice(i + 1, 0, midpoint);
                vertex = i + 1;
                startDrag('vertex', vertex);
                draw();
                return;
            }
        }
        const handles = transformHandles(e);
        if (handles.corners.some(close)) {
            vertex = -1; startDrag('scale'); return;
        }
        if (close(handles.rotation)) {
            vertex = -1; startDrag('rotate'); return;
        }
    }
    const found = hit(p);
    selected = found?.id || '';
    vertex = -1;
    if (tool === 'delete') removeSelected();
    else if (found) startDrag('move');
    refreshInspector();
    draw();
};
canvas.onpointermove = event => {
    const p = snapped(local(event.offsetX, event.offsetY));
    cursor = local(event.offsetX, event.offsetY);
    if (drag)
        if (drag.mode === 'pan') pan = {
            x: drag.pan.x + event.offsetX - drag.screen.x, z: drag.pan.z + event.offsetY - drag.screen.z
        };
        else if (drag.mode === 'terrain') {
            const length = Math.hypot(p.x - drag.start.x, p.z - drag.start.z);
            const count = Math.min(60, Math.max(1, Math.ceil(length / (brush.radius / 4))));
            for (let i = 1; i <= count; i++) sculpt(world, {
                x: drag.start.x + (p.x - drag.start.x) * i / count,
                z: drag.start.z + (p.z - drag.start.z) * i / count
            }, brush, 0.25);
            drag.start = p;
        } else {
            const e = selection(), original = drag.before.objects.find(object => object.id === selected);
            if (e && original)
                if (drag.mode === 'vertex') e.polygon[drag.vertex] = p;
                else {
                    const pivot = center(original);
                    const angle = drag.mode === 'rotate' ? Math.atan2(p.z - pivot.z, p.x - pivot.x) -
                        Math.atan2(drag.start.z - pivot.z, drag.start.x - pivot.x) : 0;
                    const scale = drag.mode === 'scale' ? Math.max(0.05, Math.hypot(p.x - pivot.x, p.z - pivot.z) /
                        Math.max(0.01, Math.hypot(drag.start.x - pivot.x, drag.start.z - pivot.z))) : 1;
                    const offset = drag.mode === 'move' ? { x: p.x - drag.start.x, z: p.z - drag.start.z } : { x: 0, z: 0 };
                    transform(e, original, pivot, scale, angle, offset);
                    for (const child of world.objects.filter(object => object.parent === e.id)) {
                        const old = drag.before.objects.find(object => object.id === child.id)!;
                        transform(child, old, pivot, scale, angle, offset);
                    }
                }
        }

    draw();
};
canvas.onpointerup = () => {
    if (!drag) return;
    const previous = drag;
    drag = undefined;
    if (previous.mode !== 'pan') commit(previous.before);
};
canvas.onpointercancel = () => {
    if (drag && drag.mode !== 'pan') world = drag.before;
    drag = undefined;
    refreshInspector();
    draw();
};
window.addEventListener('contextmenu', event => {
    if (event.target instanceof Element && event.target.closest('canvas, #preview')) {
        event.preventDefault(); event.stopImmediatePropagation();
    }
}, { capture: true, passive: false });
for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'auxclick'] as const)
    window.addEventListener(type, event => {
        if (event.button === 2 && event.target instanceof Element && event.target.closest('canvas, #preview'))
            event.preventDefault();
    }, { capture: true, passive: false });
canvas.addEventListener('mousedown', event => {
    if (event.button === 2) event.preventDefault();
}, { capture: true, passive: false });
canvas.onwheel = event => {
    event.preventDefault();
    const p = local(event.offsetX, event.offsetY);
    zoom = Math.max(0.005, Math.min(100, zoom * Math.exp(-event.deltaY * 0.001)));
    pan = { x: event.offsetX - p.x * zoom, z: event.offsetY - p.z * zoom };
    draw();
};

async function setView(use3d: boolean) {
    try {
        const viewport = element('viewport');
        const width = viewport.clientWidth, height = viewport.clientHeight;
        const focus = local(width / 2, height / 2);
        if (use3d && !preview) {
            preview = new Preview(element('preview'));
            preview.onSimulationChange = refreshSimulationControls;
            preview.onStats = (fps, frameMs, tickMs) => {
                const counts = preview?.runtimeStats, enemies = preview?.enemyCount;
                element('preview-stats').textContent = `${fps.toFixed(0)} FPS · Frame CPU ${frameMs.toFixed(1)} ms` +
                    (enemies === undefined ? '' : ` · ${enemies.toLocaleString('en-US')} Enemies`) +
                    (tickMs === undefined ? '' : `\n${counts ? `${counts.entities} entities · ` +
                        `${counts.projectiles} projectiles · ` : ''}${tickMs.toFixed(1)} ms/tick`);
            };
        }
        if (!use3d && preview && mode3d) {
            preview.stopSimulation();
            zoom = width / Math.max(10, preview.distance / 1.2);
            pan = { x: width / 2 - preview.target.x * zoom, z: height / 2 - preview.target.z * zoom };
        }
        mode3d = use3d;
        canvas.hidden = use3d;
        element('preview').hidden = !use3d;
        element('preview-controls').hidden = !use3d;
        element('view-2d').setAttribute('aria-pressed', String(!use3d));
        element('view-3d').setAttribute('aria-pressed', String(use3d));
        element('tools').querySelectorAll<HTMLButtonElement>('[data-tool]').forEach(b => {
            b.disabled = use3d;
        });
        if (use3d) preview?.focus(world, focus, width / zoom);
        refreshSimulationControls();
        draw();
    } catch (error) {
        fail(error);
    }
}
function undo(redo = false) {
    if (drag || inspectorBefore) return;
    if (history.apply(world, redo)) {
        vertex = -1;
        if (!selection()) selected = '';
        changed();
        refreshInspector();
    }
}
document.onkeydown = event => {
    if (preview?.defending) return;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement ||
        event.target instanceof HTMLTextAreaElement || document.querySelector('dialog[open]')) return;
    if (event.code === 'Space') {
        event.preventDefault(); space = true;
    }
    if (event.key === 'Escape') {
        if (drag && drag.mode !== 'pan') world = drag.before;
        drag = undefined;
        points = [];
        vertex = -1;
        draw();
    }
    if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
        event.preventDefault(); undo(event.shiftKey || event.key.toLowerCase() === 'y');
    }
    if (event.key === 'Enter' && points.length) finishPolygon();
    if (['Delete', 'Backspace'].includes(event.key) && !mode3d) {
        event.preventDefault(); removeSelected();
    }
};
document.onkeyup = event => {
    if (event.code === 'Space') space = false;
};
window.addEventListener('blur', () => {
    space = false;
});
window.addEventListener('beforeunload', event => {
    if (dirty) {
        event.preventDefault(); event.returnValue = '';
    }
});

function replaceWorld(next: World) {
    validateWorld(next);
    clearTimeout(autosaveTimer);
    world = next;
    history = new History();
    selected = '';
    vertex = -1;
    points = [];
    inspectorBefore = undefined;
    setTool('select');
    fit();
    changed();
}
function mayReplace() {
    return !dirty || confirm('Replace the current map? Export or save it first if you need to keep it.');
}
element('new').onclick = () => {
    if (!mayReplace()) return;
    const width = Number(prompt('Map width in meters (10–20000)', '1000'));
    const depth = Number(prompt('Map depth in meters (10–20000)', String(width)));
    if (![width, depth].every(n => Number.isFinite(n) && n >= 10 && n <= 20000)) {
        notice('Invalid map dimensions'); return;
    }
    replaceWorld(blankWorld(width, depth));
};
element('undo').onclick = () => undo();
element('redo').onclick = () => undo(true);
element('fit').onclick = fit;
element('finish').onclick = finishPolygon;
element('view-2d').onclick = () => {
    void setView(false);
};
element('view-3d').onclick = () => {
    void setView(true);
};
function refreshSimulationControls() {
    const simulateButton = element<HTMLButtonElement>('simulate');
    simulateButton.textContent = preview?.simulating ? 'Stop' : 'Simulate spawn';
    simulateButton.setAttribute('aria-pressed', String(!!preview?.simulating));
    const reason = !navigator.gpu ? 'WebGPU is required. Use a supported browser over HTTPS or localhost.'
        : !world.objects.some(e => e.kind === 'objective') ? 'Place one primary objective'
            : !world.objects.some(e => e.kind === 'spawn') ? 'Place at least one spawn' : '';
    simulateButton.disabled = !!reason && !preview?.simulating;
    simulateButton.title = reason;
    const defenseButton = element<HTMLButtonElement>('defense');
    defenseButton.disabled = !!reason && !preview?.defending;
    defenseButton.setAttribute('aria-pressed', String(!!preview?.defending));
    defenseButton.textContent = preview?.defending ? 'Stop defense' : 'Defense';
    element('notice').hidden = !!preview?.defending;
    element('preview-help').textContent = preview?.defending
        ? 'WASD/arrows: pan · Middle drag: grab · Right click: order · Shift: append/path · Wheel: zoom'
        : 'Drag: orbit · Shift/right drag: pan · Wheel: zoom';
    if (reason && mode3d) notice(reason);
    const flow = element<HTMLInputElement>('flowfield');
    flow.disabled = !preview?.simulationReady;
    preview?.showFlow(flow.checked);
    element<HTMLInputElement>('continuous-spawn').disabled = !!preview?.simulating;
}
element('simulate').onclick = () => {
    if (!preview) return;
    if (preview.simulating) preview.stopSimulation();
    else void preview.startSimulation(world, notice, false,
        element<HTMLInputElement>('continuous-spawn').checked,
        element<HTMLInputElement>('skip-preparation').checked).catch(fail);
};
element('defense').onclick = () => {
    if (!preview) return;
    if (preview.defending) preview.stopSimulation();
    else {
        preview.stopSimulation();
        void preview.startSimulation(world, notice, true,
            element<HTMLInputElement>('continuous-spawn').checked,
            element<HTMLInputElement>('skip-preparation').checked, { unlimitedEconomy: true }).catch(fail);
    }
};
element<HTMLInputElement>('flowfield').onchange = event => {
    preview?.showFlow((event.target as HTMLInputElement).checked);
};
element<HTMLInputElement>('roof-details').onchange = event => {
    if (preview) preview.details = (event.target as HTMLInputElement).checked;
    draw();
};
element<HTMLInputElement>('overlays').onchange = event => {
    if (preview) preview.overlays = (event.target as HTMLInputElement).checked;
    draw();
};
element<HTMLInputElement>('map-name').onchange = event => {
    const before = cloneWorld(world);
    world.name = (event.target as HTMLInputElement).value;
    commit(before);
};
document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach(b => {
    b.onclick = () => setTool(b.dataset.tool!);
});
element('export').onclick = async () => {
    try {
        const messages = warnings(world);
        if (messages.length && !confirm(`Export with these warnings?\n\n${messages.join('\n')}`)) return;
        const revision = editRevision, exported = cloneWorld(world);
        exported.preview = await mapPreview(exported);
        downloadMap(exported, `${exported.name.replace(/[^a-z0-9_-]/gi, '_') || 'battlefield'}.mapx`);
        if (revision === editRevision) dirty = false;
        notice('MAPX exported. Coordinates: 1 cm; elevation: 0.1 m. All authored fields are included.');
    } catch (error) {
        fail(error);
    }
};
element('import').onclick = () => element<HTMLInputElement>('map-file').click();
element<HTMLInputElement>('map-file').onchange = async event => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !mayReplace()) return;
    const revision = editRevision;
    try {
        const next = await readMapFile(file);
        if (revision !== editRevision && !mayReplace()) return;
        replaceWorld(next);
        notice('MAPX loaded');
    } catch (error) {
        fail(error);
    }
};
element('save').onclick = async () => {
    try {
        const revision = editRevision;
        await saves.save(world.name || 'Untitled', encodeMap(world));
        if (revision === editRevision) dirty = false;
        notice('Saved locally in this browser');
    } catch (error) {
        fail(error);
    }
};
element('load').onclick = async () => {
    try {
        const slots = await saves.slots();
        const input = element<HTMLSelectElement>('save-slots');
        input.replaceChildren(...slots.map(name => new Option(name, name)));
        element<EditorDialog>('saves-dialog').showModal();
    } catch (error) {
        fail(error);
    }
};
element('open-slot').onclick = async () => {
    if (!mayReplace()) return;
    try {
        const value = await saves.load(element<HTMLSelectElement>('save-slots').value);
        if (!value) throw Error('No saved map selected');
        replaceWorld(decodeMap(value));
        element<EditorDialog>('saves-dialog').close();
        notice('Local map loaded');
    } catch (error) {
        fail(error);
    }
};
element('close-saves').onclick = () => element<EditorDialog>('saves-dialog').close();
const regionDialog = element<EditorDialog>('region-dialog');
let importController: AbortController | undefined;
let searchController: AbortController | undefined;
let lastSearch = 0;
const picker = new RegionPicker(element<HTMLCanvasElement>('picker'), rectangle => {
    const [south, west, north, east] = rectangle;
    const size = project({ lat: south, lon: east }, { lat: north, lon: west });
    const requests = Math.ceil((Math.ceil(size.x / ELEVATION_SAMPLE_SPACING) + 1) *
        (Math.ceil(size.z / ELEVATION_SAMPLE_SPACING) + 1) / 100);
    element('region-size').textContent = `${size.x.toFixed(0)} × ${size.z.toFixed(0)} m · ` +
        `${(size.x * size.z / 1e6).toFixed(2)} km² · Maximum 10 km per side. ` +
        `One OSM request (one gateway failover); ${requests} DEM requests unless flat. Data cap: 24 MiB.`;
});
element('geography').onclick = () => {
    regionDialog.showModal(); picker.draw();
};
element('picker-pan').onclick = () => {
    picker.mode = 'pan';
    element('picker-pan').setAttribute('aria-pressed', 'true');
    element('picker-bounds').setAttribute('aria-pressed', 'false');
};
element('picker-bounds').onclick = () => {
    picker.mode = 'bounds';
    element('picker-pan').setAttribute('aria-pressed', 'false');
    element('picker-bounds').setAttribute('aria-pressed', 'true');
};
element('go-location').onclick = () => {
    const lat = Number(element<HTMLInputElement>('latitude').value);
    const lon = Number(element<HTMLInputElement>('longitude').value);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 84 || Math.abs(lon) > 180) {
        element('import-progress').textContent = 'Invalid latitude or longitude'; return;
    }
    picker.lat = lat; picker.lon = lon; picker.draw();
};
element<HTMLFormElement>('search-form').onsubmit = async event => {
    event.preventDefault();
    if (Date.now() - lastSearch < 1500) return;
    lastSearch = Date.now();
    searchController?.abort();
    searchController = new AbortController();
    const query = element<HTMLInputElement>('search').value.trim();
    const cacheKey = `Geocoder:${query}`;
    const progress = element('import-progress');
    try {
        const endpoint = new URL(element<HTMLInputElement>('search-endpoint').value);
        if (endpoint.protocol !== 'https:') throw Error('Use an HTTPS search endpoint');
        endpoint.search = new URLSearchParams({ q: query, format: 'jsonv2', limit: '5' }).toString();
        // Nominatim uses a snake-case field in its public response.
        // eslint-disable-next-line @typescript-eslint/naming-convention
        let results: Array<{ lat: string; lon: string; display_name: string }>;
        const cached = sessionStorage.getItem(cacheKey);
        if (cached) results = JSON.parse(cached);
        else {
            progress.textContent = 'Searching…';
            results = await jsonRequest(endpoint.href, searchController.signal) as typeof results;
            sessionStorage.setItem(cacheKey, JSON.stringify(results));
        }
        if (!Array.isArray(results)) throw Error('Invalid search response');
        const select = element<HTMLSelectElement>('search-results');
        select.replaceChildren(...results.map((p, i) => new Option(p.display_name, String(i))));
        select.hidden = !results.length;
        const go = () => {
            const result = results[Number(select.value)];
            if (!result) return;
            const lat = Number(result.lat), lon = Number(result.lon);
            if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 84 || Math.abs(lon) > 180) throw Error('Invalid search location');
            picker.lat = lat; picker.lon = lon; picker.zoom = 15; picker.draw();
            element<HTMLInputElement>('latitude').value = String(lat);
            element<HTMLInputElement>('longitude').value = String(lon);
        };
        select.onchange = () => {
            try {
                go();
            } catch (error) {
                progress.textContent = String(error);
            }
        };
        go();
        progress.textContent = results.length ? 'Select a result, then draw an import rectangle' : 'No results';
    } catch (error) {
        progress.textContent = String(error);
    }
};
element('start-import').onclick = async () => {
    if (importController || !mayReplace()) return;
    const progress = element('import-progress');
    const start = element<HTMLButtonElement>('start-import');
    const revision = editRevision;
    importController = new AbortController();
    start.disabled = true;
    const timeout = setTimeout(() => importController?.abort(), 600000);
    try {
        const endpoint = new URL(element<HTMLInputElement>('overpass-endpoint').value);
        if (endpoint.protocol !== 'https:') throw Error('Use an HTTPS Overpass endpoint');
        const tolerance = Number(element<HTMLInputElement>('tolerance').value);
        if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 5) throw Error('Invalid simplification tolerance');
        const result = await importRegion(picker.selection, tolerance, element<HTMLInputElement>('flat-terrain').checked,
            importController.signal, text => {
                progress.textContent = text;
            }, endpoint.href);
        if (importController.signal.aborted) throw Error('Import cancelled');
        if (revision !== editRevision && !mayReplace()) return;
        replaceWorld(result.world);
        await saves.save(`Import ${world.source.imported}`, encodeMap(world));
        regionDialog.close();
        notice(`Imported ${world.objects.length} objects; ${result.skipped} unsupported or invalid source features skipped. Original imported map cached locally.`);
    } catch (error) {
        progress.textContent = `Import not completed: ${String(error)}`;
    } finally {
        clearTimeout(timeout);
        importController = undefined;
        start.disabled = false;
    }
};
function cancelRegion() {
    importController?.abort(); searchController?.abort();
}
element('close-region').onclick = () => {
    cancelRegion(); regionDialog.close();
};
regionDialog.addEventListener('cancel', cancelRegion);
new ResizeObserver(() => {
    draw(); if (regionDialog.open) picker.draw();
}).observe(element('viewport'));
fit();
refreshInspector();
refreshWarnings();
void (async () => {
    try {
        const bytes = await saves.load('Autosave');
        if (bytes && confirm('Restore the last autosaved map?')) replaceWorld(decodeMap(bytes));
    } catch (error) {
        fail(error);
    } finally {
        recovering = false;
    }
})();
