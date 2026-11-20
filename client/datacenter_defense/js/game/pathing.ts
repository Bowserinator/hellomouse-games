import { Q } from '../sim/fixed.js';

export type PathPoint = { x: number; z: number; recover?: boolean };
export type PathBody = { width: number; depth: number; locomotion: number; flightHeight?: number };
export type PathStructure = PathPoint & { width: number; depth: number; flightHeight?: number };
export type PathResult = { waypoints: Array<PathPoint>; cells: Array<number>; cost: number };
const NEIGHBOURS = [[-1, 0], [0, -1], [1, 0], [0, 1], [-1, -1], [1, -1], [1, 1], [-1, 1]];

export class Pathfinder {
    private blocked: Uint8Array;
    private units: Array<PathStructure> = [];
    private scores: Int32Array;
    private stamps: Uint32Array;
    private parents: Int32Array;
    private generation = 0;
    private heap: Array<{ cell: number; score: number; priority: number }> = [];
    private minimum = 127;
    constructor(readonly columns: number, readonly rows: number, readonly costs: Uint8Array) {
        if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns < 1 || rows < 1 ||
            columns > 2048 || rows > 2048 || costs.length !== columns * rows) throw Error('Invalid pathing grid');
        this.blocked = new Uint8Array(costs.length);
        this.scores = new Int32Array(costs.length); this.stamps = new Uint32Array(costs.length);
        this.parents = new Int32Array(costs.length);
        for (let i = 0; i < costs.length; i++) {
            costs[i] &= 127;
            if (costs[i]) this.minimum = Math.min(this.minimum, costs[i]);
        }
    }
    structures(structures: Array<PathStructure>) {
        this.blocked.fill(0);
        for (const structure of structures) {
            const x0 = Math.max(0, Math.floor(structure.x / Q - structure.width / 2));
            const z0 = Math.max(0, Math.floor(structure.z / Q - structure.depth / 2));
            const x1 = Math.min(this.columns, Math.ceil(structure.x / Q + structure.width / 2));
            const z1 = Math.min(this.rows, Math.ceil(structure.z / Q + structure.depth / 2));
            for (let z = z0; z < z1; z++) this.blocked.fill(1, z * this.columns + x0, z * this.columns + x1);
        }
    }
    setUnits(units: Array<PathStructure>) {
        this.units = units;
    }
    private open(x: number, z: number) {
        return x >= 0 && z >= 0 && x < this.columns && z < this.rows &&
            this.costs[z * this.columns + x] !== 0 && !this.blocked[z * this.columns + x];
    }
    fits(point: PathPoint, body: PathBody) {
        const x = point.x / Q, z = point.z / Q;
        if (x < body.width / 2 || z < body.depth / 2 ||
            x + body.width / 2 > this.columns || z + body.depth / 2 > this.rows) return false;
        if (this.units.some(unit => Math.abs(x - unit.x / Q) < (body.width + unit.width) / 2 &&
            Math.abs(z - unit.z / Q) < (body.depth + unit.depth) / 2)) return false;
        for (let zz = Math.floor(z - body.depth / 2); zz < Math.ceil(z + body.depth / 2); zz++)
            for (let xx = Math.floor(x - body.width / 2); xx < Math.ceil(x + body.width / 2); xx++)
                if (!this.open(xx, zz)) return false;
        return true;
    }
    leg(start: PathPoint, end: PathPoint, body: PathBody) {
        const cuts = [0, 1];
        for (const [a, b, half] of [[start.x, end.x, body.width * Q / 2],
            [start.z, end.z, body.depth * Q / 2]]) {
            if (a === b) continue;
            for (const offset of [-half, 0, half])
                for (let line = Math.ceil((Math.min(a, b) + offset) / Q);
                    line <= Math.floor((Math.max(a, b) + offset) / Q); line++) {
                    const t = (line * Q - offset - a) / (b - a);
                    if (t > 0 && t < 1) cuts.push(t);
                }
        }
        for (const unit of this.units)
            for (const [a, b, centre, half] of [[start.x, end.x, unit.x, (body.width + unit.width) * Q / 2],
                [start.z, end.z, unit.z, (body.depth + unit.depth) * Q / 2]]) {
                if (a === b) continue;
                for (const edge of [centre - half, centre + half]) {
                    const t = (edge - a) / (b - a);
                    if (t > 0 && t < 1) cuts.push(t);
                }
            }
        cuts.sort((a, b) => a - b);
        for (let i = 0; i < cuts.length; i++) {
            const t = cuts[i];
            if (!this.fits({ x: Math.round(start.x + (end.x - start.x) * t),
                z: Math.round(start.z + (end.z - start.z) * t) }, body)) return false;
            if (i > 0) {
                const middle = (cuts[i - 1] + t) / 2;
                if (!this.fits({ x: Math.round(start.x + (end.x - start.x) * middle),
                    z: Math.round(start.z + (end.z - start.z) * middle) }, body)) return false;
            }
        }
        return true;
    }
    private centre(cell: number, body: PathBody): PathPoint {
        return { x: (cell % this.columns + Math.ceil(body.width) % 2 / 2) * Q,
            z: (Math.floor(cell / this.columns) + Math.ceil(body.depth) % 2 / 2) * Q };
    }
    private push(cell: number, score: number, priority: number) {
        let index = this.heap.length;
        const node = { cell, score, priority }; this.heap.push(node);
        while (index > 0) {
            const parent = (index - 1) >>> 1;
            if (this.heap[parent].priority <= priority) break;
            this.heap[index] = this.heap[parent]; index = parent;
        }
        this.heap[index] = node;
    }
    private pop() {
        const first = this.heap[0], last = this.heap.pop()!;
        if (this.heap.length) {
            let index = 0;
            while (index * 2 + 1 < this.heap.length) {
                let child = index * 2 + 1;
                if (child + 1 < this.heap.length && this.heap[child + 1].priority < this.heap[child].priority) child++;
                if (last.priority <= this.heap[child].priority) break;
                this.heap[index] = this.heap[child]; index = child;
            }
            this.heap[index] = last;
        }
        return first;
    }
    find(start: PathPoint, goal: PathPoint, body: PathBody): PathResult {
        if (![start.x, start.z, goal.x, goal.z].every(Number.isFinite) ||
            !Number.isFinite(body.width) || !Number.isFinite(body.depth) || body.width < 0.7 || body.width > 4 ||
            body.depth < 0.7 || body.depth > 4 || ![0, 1].includes(body.locomotion)) throw Error('Invalid path request');
        const empty: PathResult = { waypoints: [], cells: [], cost: 0 };
        let recovered: PathPoint | undefined;
        if (!this.fits(start, body)) {
            let blocked = false;
            for (let z = Math.floor(start.z / Q - body.depth / 2); z < Math.ceil(start.z / Q + body.depth / 2); z++)
                for (let x = Math.floor(start.x / Q - body.width / 2); x < Math.ceil(start.x / Q + body.width / 2); x++)
                    blocked ||= !this.open(x, z);
            if (!blocked) return empty;
            // shortcut: Recovery searches 64 m; extend it for larger building interiors.
            search: for (let radius = 1; radius <= 64; radius++)
                for (let z = -radius; z <= radius; z++) for (let x = -radius; x <= radius; x++) {
                    if (Math.max(Math.abs(x), Math.abs(z)) !== radius) continue;
                    const point = { x: start.x + x * Q, z: start.z + z * Q };
                    if (this.fits(point, body)) {
                        recovered = point; break search;
                    }
                }
            if (!recovered) return empty;
            start = recovered;
        }
        this.generation = (this.generation + 1) >>> 0;
        if (!this.generation) {
            this.stamps.fill(0); this.generation = 1;
        }
        this.heap.length = 0;
        const ox = Math.ceil(body.width) % 2 / 2, oz = Math.ceil(body.depth) % 2 / 2;
        const sx = Math.max(0, Math.min(this.columns - 1, Math.round(start.x / Q - ox)));
        const sz = Math.max(0, Math.min(this.rows - 1, Math.round(start.z / Q - oz)));
        const gx = Math.max(0, Math.min(this.columns - 1, Math.round(goal.x / Q - ox)));
        const gz = Math.max(0, Math.min(this.rows - 1, Math.round(goal.z / Q - oz)));
        const first = sz * this.columns + sx, destination = gz * this.columns + gx;
        const snapped = !this.fits(this.centre(destination, body), body);
        const heuristic = (cell: number) => {
            const dx = Math.abs(cell % this.columns - gx), dz = Math.abs(Math.floor(cell / this.columns) - gz);
            return 5 * Math.max(dx, dz) + 2 * Math.min(dx, dz);
        };
        let closest = -1, closestDistance = Infinity, found = -1;
        this.scores[first] = 0; this.parents[first] = -1; this.stamps[first] = this.generation;
        this.push(first, 0, heuristic(first) * this.minimum);
        while (this.heap.length) {
            const { cell, score } = this.pop();
            if (score !== (this.scores[cell] >>> 0)) continue;
            if (heuristic(cell) < closestDistance || (heuristic(cell) === closestDistance &&
                (closest < 0 || score < (this.scores[closest] >>> 0)))) {
                closest = cell; closestDistance = heuristic(cell);
            }
            if (cell === destination && !snapped) {
                found = cell; break;
            }
            const x = cell % this.columns, z = Math.floor(cell / this.columns);
            for (let direction = 0; direction < 8; direction++) {
                const [dx, dz] = NEIGHBOURS[direction], nx = x + dx, nz = z + dz;
                if (!this.open(nx, nz)) continue;
                const next = nz * this.columns + nx;
                if (!this.fits(this.centre(next, body), body)) continue;
                if (direction >= 4 && (!this.fits(this.centre(z * this.columns + nx, body), body) ||
                    !this.fits(this.centre(nz * this.columns + x, body), body))) continue;
                if (cell === first && !this.leg(start, this.centre(next, body), body)) continue;
                // Half-step costs fit every simple 2048² path in an unsigned 32-bit score.
                const nextScore = score + (direction >= 4 ? 7 : 5) * this.costs[cell];
                if (this.stamps[next] === this.generation && nextScore >= (this.scores[next] >>> 0)) continue;
                this.scores[next] = nextScore; this.stamps[next] = this.generation; this.parents[next] = cell;
                this.push(next, nextScore, nextScore + heuristic(next) * this.minimum);
            }
        }
        if (snapped) found = closest;
        if (found < 0) return empty;
        const cells: Array<number> = [];
        for (let at = found; at >= 0; at = this.parents[at]) cells.push(at);
        cells.reverse();
        const waypoints: Array<PathPoint> = [];
        let from = start, index = 1;
        while (index < cells.length) {
            let furthest = index;
            while (furthest + 1 < cells.length && this.leg(from, this.centre(cells[furthest + 1], body), body))
                furthest++;
            const point = this.centre(cells[furthest], body);
            if (!this.leg(from, point, body)) return empty;
            waypoints.push(point); from = point; index = furthest + 1;
        }
        if (!waypoints.length && this.leg(start, this.centre(found, body), body))
            waypoints.push(this.centre(found, body));
        if (recovered) waypoints.unshift({ ...recovered, recover: true });
        return { waypoints, cells, cost: (this.scores[found] >>> 0) * 2 };
    }
}
