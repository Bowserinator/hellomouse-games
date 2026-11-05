import { PlanetDesc } from '../mapgen/map-desc.js';
import { ColliderPrim, SHAPE_COLLIDERS } from '../mapgen/shapes.js';
import { V3, clamp, dot, normalize, reproject, set, sub, vec } from '../math/vec3.js';
import { slerpDir } from '../math/sphere.js';
import { STEP_UP, TANK_RADIUS } from '../../vars.js';

export interface Body {
    planet: number; dir: V3; vel: V3; h: number;
}
export class ColliderWorld {
    readonly prims: Array<Array<ColliderPrim>>;
    private normal = vec();
    private sample = vec();
    private travel = vec();
    constructor(readonly planets: Array<PlanetDesc>) {
        this.prims = planets.map(p => p.obstacles.flatMap(o => SHAPE_COLLIDERS[o.kind](o)));
    }
    private penetration(c: ColliderPrim, dir: V3, radius: number, bodyRadius: number): number {
        if (dot(c.dir, dir) < 0.8) return 0;
        const x = dot(dir, c.x) * radius, z = dot(dir, c.z) * radius;
        let nx: number, nz: number, depth: number;
        if (c.t === 'circle') {
            const dist = Math.hypot(x, z);
            depth = Math.max(c.hx, c.hz) + bodyRadius - dist;
            nx = dist > 1e-8 ? x / dist : 1;
            nz = dist > 1e-8 ? z / dist : 0;
        } else {
            const dx = x - clamp(x, -c.hx, c.hx), dz = z - clamp(z, -c.hz, c.hz);
            const dist = Math.hypot(dx, dz);
            if (dist > 1e-8) {
                depth = bodyRadius - dist;
                nx = dx / dist;
                nz = dz / dist;
            } else if (c.hx - Math.abs(x) < c.hz - Math.abs(z)) {
                nx = x >= 0 ? 1 : -1;
                nz = 0;
                depth = c.hx - Math.abs(x) + bodyRadius;
            } else {
                nx = 0;
                nz = z >= 0 ? 1 : -1;
                depth = c.hz - Math.abs(z) + bodyRadius;
            }
        }
        set(this.normal, c.x.x * nx + c.z.x * nz, c.x.y * nx + c.z.y * nz, c.x.z * nx + c.z.z * nz);
        return depth;
    }
    resolve(body: Body, radius = this.planets[body.planet].radius): void {
        for (let pass = 0; pass < 3; pass++)
            for (const c of this.prims[body.planet]) {
                if (c.top <= body.h + STEP_UP || c.bottom >= body.h + 1.5) continue;
                const depth = this.penetration(c, body.dir, radius, TANK_RADIUS);
                if (depth <= 0) continue;
                const n = this.normal, amount = (depth + 0.001) / radius;
                normalize(body.dir, set(body.dir, body.dir.x + n.x * amount,
                    body.dir.y + n.y * amount, body.dir.z + n.z * amount));
                const inward = Math.min(0, dot(body.vel, n));
                set(body.vel, body.vel.x - n.x * inward, body.vel.y - n.y * inward, body.vel.z - n.z * inward);
            }
    }
    supportHeight(planet: number, dir: V3, bodyRadius = TANK_RADIUS, maxHeight = Infinity): number {
        let top = 0;
        for (const c of this.prims[planet])
            if (c.top <= maxHeight + STEP_UP && c.top > top &&
                this.penetration(c, dir, this.planets[planet].radius, bodyRadius) > 0)
                top = c.top;
        return top;
    }
    clearance(planet: number, dir: V3, margin: number): boolean {
        return !this.prims[planet].some(c => this.penetration(c, dir, this.planets[planet].radius, margin) > 0);
    }
    raycastAltitude(planet: number, a: V3, b: V3, altitude: number, bulletRadius = 0.15,
        hitNormal?: V3): number | null {
        if (!this.prims[planet].length) return null;
        const radius = this.planets[planet].radius;
        sub(this.travel, b, a);
        // Swept samples are narrower than the thinnest wall.
        const steps = Math.max(1, Math.ceil(Math.acos(clamp(dot(a, b), -1, 1)) * radius / 0.15));
        for (let i = 0; i <= steps; i++) {
            slerpDir(this.sample, a, b, i / steps);
            for (const c of this.prims[planet])
                if (c.top > altitude && c.bottom < altitude &&
                    this.penetration(c, this.sample, radius, bulletRadius) > 0) {
                    if (hitNormal) {
                        reproject(hitNormal, this.normal, this.sample);
                        if (dot(hitNormal, this.travel) >= 0) continue;
                    }
                    return hitNormal ? Math.max(0, i - 1) / steps : i / steps;
                }
        }
        return null;
    }
}
