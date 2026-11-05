import { V3, add, copy, cross, distance, dot, fromTuple, lerp, normalize, reproject, rotate, scale, sub, vec }
    from './vec3.js';
import { slerpDir } from './sphere.js';
import { LaunchRingDesc, LaunchStarDesc, MapDesc } from '../mapgen/map-desc.js';
import { STAR_HEIGHT, STAR_PATH_CLEARANCE, STAR_PATH_RISE, TANK_HEIGHT } from '../../vars.js';

export class FlightPath {
    readonly duration: number;
    private controls: Array<V3> = [];
    private work: Array<V3> = [];
    private samples: Array<number> = [0];
    private u: V3;
    private v: V3;
    private startFwd: V3;
    private turnAxis: V3;
    private turnAngle: number;
    constructor(map: MapDesc, ring: LaunchRingDesc, readonly star: LaunchStarDesc) {
        const src = map.planets[star.planet], dst = map.planets[star.destPlanet];
        this.u = fromTuple(star.dir);
        this.v = fromTuple(star.landDir);
        const centers = map.planets.map(p => fromTuple(p.center));
        const start = add(vec(), centers[star.planet], scale(vec(), this.u, src.radius + STAR_HEIGHT));
        const departure = add(vec(), centers[star.planet],
            scale(vec(), this.u, src.radius + (STAR_HEIGHT + 10 * TANK_HEIGHT) * 1.5));
        const end = add(vec(), centers[star.destPlanet], scale(vec(), this.v, dst.radius));
        this.startFwd = reproject(vec(), sub(vec(), end, start), this.u);
        this.turnAxis = normalize(vec(), cross(vec(), this.u, slerpDir(vec(), this.u, this.v, .5)));
        this.turnAngle = Math.acos(Math.max(-1, Math.min(1, dot(this.u, this.v))));
        const clearance = map.planets.map((p, i) => p.radius +
            (i === star.planet || i === star.destPlanet ? 0 : STAR_PATH_CLEARANCE) - 1e-7);
        // Subdivision bounds the entire Bézier, not just the sampled trail vertices.
        const safe = (points: Array<V3>, planet: number, depth = 0): boolean => {
            const center = centers[planet];
            const low = vec(Infinity, Infinity, Infinity), high = vec(-Infinity, -Infinity, -Infinity);
            for (const p of points) for (const axis of ['x', 'y', 'z'] as const) {
                low[axis] = Math.min(low[axis], p[axis]);
                high[axis] = Math.max(high[axis], p[axis]);
            }
            const nearest = vec(Math.max(low.x, Math.min(high.x, center.x)),
                Math.max(low.y, Math.min(high.y, center.y)), Math.max(low.z, Math.min(high.z, center.z)));
            if (distance(center, nearest) >= clearance[planet]) return true;
            if (depth === 12 || distance(center, points[0]) < clearance[planet] ||
                distance(center, points[points.length - 1]) < clearance[planet]) return false;
            const work = points.map(p => ({ ...p })), left = [work[0]], right = [work[work.length - 1]];
            for (let n = work.length - 1; n > 0; n--) {
                for (let i = 0; i < n; i++) work[i] = lerp(vec(), work[i], work[i + 1], .5);
                left.push(work[0]);
                right.unshift(work[n - 1]);
            }
            return safe(left, planet, depth + 1) && safe(right, planet, depth + 1);
        };
        for (let attempt = 0; attempt < 8; attempt++) {
            const padding = 4 * 2 ** attempt;
            const nodes = [add(vec(), centers[star.planet],
                scale(vec(), this.u, src.radius + STAR_PATH_RISE + padding)),
            add(vec(), centers[star.destPlanet], scale(vec(), this.v, dst.radius + STAR_PATH_RISE + padding))];
            map.planets.forEach((p, i) => {
                for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
                    if (!x && !y && !z) continue;
                    const direction = normalize(vec(), vec(x, y, z));
                    nodes.push(add(vec(), centers[i], scale(direction, direction,
                        p.radius + STAR_PATH_CLEARANCE + padding + 12)));
                }
            });
            const clear = (a: V3, b: V3): boolean => {
                const delta = sub(vec(), b, a), lengthSq = dot(delta, delta);
                return centers.every((center, i) => {
                    const t = lengthSq ? Math.max(0, Math.min(1, dot(sub(vec(), center, a), delta) / lengthSq)) : 0;
                    return distance(centers[i], add(vec(), a, scale(vec(), delta, t))) >= clearance[i] + padding;
                });
            };
            const costs = nodes.map(() => Infinity), previous = nodes.map(() => -1), visited = new Set<number>();
            costs[0] = 0;
            for (let step = 0; step < nodes.length; step++) {
                let current = -1;
                for (let i = 0; i < nodes.length; i++)
                    if (!visited.has(i) && (current < 0 || costs[i] < costs[current])) current = i;
                if (current < 0 || !Number.isFinite(costs[current]) || current === 1) break;
                visited.add(current);
                for (let i = 0; i < nodes.length; i++) {
                    if (visited.has(i)) continue;
                    const cost = costs[current] + distance(nodes[current], nodes[i]);
                    if (cost >= costs[i] || !clear(nodes[current], nodes[i])) continue;
                    costs[i] = cost;
                    previous[i] = current;
                }
            }
            if (!Number.isFinite(costs[1])) continue;
            const route: Array<V3> = [];
            for (let i = 1; i >= 0; i = previous[i]) route.unshift(nodes[i]);
            for (let weight = 1; weight <= 8; weight *= 2) {
                this.controls = [start, departure,
                    ...route.flatMap(p => Array.from({ length: weight }, () => p)),
                    lerp(vec(), route[route.length - 1], end, .5), end];
                if (centers.every((_, i) => safe(this.controls, i))) break;
                this.controls = [];
            }
            if (this.controls.length) break;
        }
        if (!this.controls.length) throw new Error('Cannot route launch Bézier around planets');
        this.work = this.controls.map(() => vec());
        let previousSample = start, total = 0;
        for (let i = 1; i <= 256; i++) {
            const p = this.point(i / 256, vec());
            total += distance(previousSample, p);
            previousSample = p;
            this.samples.push(total);
        }
        this.duration = ring.durationMs / 1000;
    }
    sample(s: number, pos: V3, up: V3, fwd: V3): void {
        s = Math.max(0, Math.min(1, s));
        const e = s * s * (3 - 2 * s), d = e * this.samples[this.samples.length - 1];
        let i = 1;
        while (i < this.samples.length - 1 && this.samples[i] < d) i++;
        const span = this.samples[i] - this.samples[i - 1];
        this.point((i - 1 + (span ? (d - this.samples[i - 1]) / span : 0)) / (this.samples.length - 1), pos);
        slerpDir(up, this.u, this.v, e);
        normalize(up, up);
        rotate(fwd, this.startFwd, this.turnAxis, this.turnAngle * e);
        reproject(fwd, fwd, up);
    }
    private point(t: number, out: V3): V3 {
        this.controls.forEach((p, i) => copy(this.work[i], p));
        for (let n = this.work.length - 1; n > 0; n--)
            for (let i = 0; i < n; i++) lerp(this.work[i], this.work[i], this.work[i + 1], t);
        return copy(out, this.work[0]);
    }
}
