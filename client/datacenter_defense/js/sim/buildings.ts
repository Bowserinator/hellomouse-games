import type { World, Point } from '../mapx.js';
import { bounds, center, elevation } from '../editor/world.js';
import { Q } from './fixed.js';

type Solid = { box: Array<number>; data: Array<number>; edges: Array<number>; passages: Array<number>;
    planes: Array<number>; };

export function bakeBuildings(world: World): Int32Array {
    const solids: Array<Solid> = [];
    const fixed = (value: number) => {
        const result = Math.round(value * 100) * Q / 100;
        if (!Number.isFinite(result) || result < -2147483648 || result > 2147483647)
            throw Error('Building collision exceeds fixed-point limits');
        return Math.round(result);
    };
    for (const building of world.objects) {
        if (building.kind !== 'building') continue;
        const box = bounds(building.polygon), ground = elevation(world, center(building));
        const t = world.terrain, dx = world.width / (t.columns - 1), dz = world.depth / (t.rows - 1);
        let bottom = ground - 1;
        for (let z = Math.max(0, Math.floor(box.minZ / dz)); z <= Math.min(t.rows - 1, Math.ceil(box.maxZ / dz)); z++)
            for (let x = Math.max(0, Math.floor(box.minX / dx));
                x <= Math.min(t.columns - 1, Math.ceil(box.maxX / dx)); x++)
                bottom = Math.min(bottom, t.heights[z * t.columns + x] - 1);
        const roof = building.roof === 'pitched' ? Math.min(5, (box.maxX - box.minX) / 4) : 0;
        const mid = (box.minX + box.maxX) / 2, slope = roof / Math.max(0.01, mid - box.minX);
        const top = ground + building.height, ridge = top + roof;
        const edges: Array<number> = [], passages: Array<number> = [], planes: Array<number> = [];
        const plane = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => {
            const length = Math.hypot(nx, ny, nz);
            planes.push(fixed(x), fixed(y), fixed(z), Math.round(nx / length * Q),
                Math.round(ny / length * Q), Math.round(nz / length * Q));
        };
        const ring = (points: Array<Point>) => {
            const offset = edges.length;
            for (let i = 0; i < points.length; i++) {
                const a = points[i], b = points[(i + 1) % points.length];
                const length = Math.hypot(b.x - a.x, b.z - a.z);
                if (!length) throw Error('Building collision contains a zero-length edge');
                const nx = -(b.z - a.z) / length, nz = (b.x - a.x) / length;
                edges.push(fixed(a.x), fixed(a.z), fixed(b.x), fixed(b.z), Math.round(nx * Q), Math.round(nz * Q));
                plane(a.x, ground, a.z, nx, 0, nz);
            }
            return offset;
        };
        ring(building.polygon);
        for (const passage of world.objects) {
            if (passage.kind !== 'passage' || passage.parent !== building.id) continue;
            const floor = Math.max(bottom, ground + passage.floor);
            const ceiling = Math.min(top, ground + passage.floor + passage.clearance);
            if (floor >= ceiling) continue;
            const offset = ring(passage.polygon);
            passages.push(offset, passage.polygon.length, fixed(floor), fixed(ceiling));
            plane(0, floor, 0, 0, 1, 0); plane(0, ceiling, 0, 0, 1, 0);
        }
        plane(0, bottom, 0, 0, 1, 0);
        plane(mid, ridge, 0, slope, 1, 0);
        if (roof) plane(mid, ridge, 0, -slope, 1, 0);
        solids.push({ box: [fixed(box.minX), fixed(bottom), fixed(box.minZ),
            fixed(box.maxX), fixed(ridge), fixed(box.maxZ)],
        data: [fixed(bottom), fixed(top), fixed(ridge), fixed(mid), Math.round(slope * Q),
            0, building.polygon.length, 0, passages.length / 4, 0, planes.length / 6], edges, passages, planes });
    }
    const nodes: Array<Array<number>> = [];
    const visit = (items: Array<number>) => {
        const index = nodes.length, first = solids[items[0]].box.slice();
        for (const id of items) for (let axis = 0; axis < 3; axis++) {
            first[axis] = Math.min(first[axis], solids[id].box[axis]);
            first[axis + 3] = Math.max(first[axis + 3], solids[id].box[axis + 3]);
        }
        const node = [...first, 0, -1]; nodes.push(node);
        if (items.length === 1) node[7] = items[0];
        else {
            const axis = first[3] - first[0] >= first[5] - first[2] ? 0 : 2;
            items.sort((a, b) => solids[a].box[axis] + solids[a].box[axis + 3] -
                solids[b].box[axis] - solids[b].box[axis + 3] || a - b);
            const middle = Math.floor(items.length / 2);
            visit(items.slice(0, middle)); visit(items.slice(middle));
        }
        node[6] = nodes.length;
        return index;
    };
    if (solids.length) visit(solids.map((_, index) => index));
    const words: Array<number> = [nodes.length, Math.round(world.terrain.base * 10)];
    for (const node of nodes) words.push(...node);
    const offsets = solids.map(solid => {
        const offset = words.length; words.push(...solid.data);
        const edgeOffset = words.length; words[offset + 5] = edgeOffset;
        for (const value of solid.edges) words.push(value);
        words[offset + 7] = words.length;
        for (let i = 0; i < solid.passages.length; i += 4)
            words.push(edgeOffset + solid.passages[i], ...solid.passages.slice(i + 1, i + 4));
        words[offset + 9] = words.length;
        for (const value of solid.planes) words.push(value);
        return offset;
    });
    nodes.forEach((node, index) => {
        if (node[7] >= 0) words[2 + index * 8 + 7] = offsets[node[7]];
    });
    return Int32Array.from(words);
}
