import { PlanetDesc } from './map-desc.js';
import { SolidField } from './solid-field.js';
import { ColliderWorld } from '../world/collider-world.js';
import { V3, dot, fromTuple, normalize, vec } from '../math/vec3.js';

export const LAND_NODES: Array<V3> = Array.from({ length: 600 }, (_, i) => {
    const y = 1 - 2 * (i + 0.5) / 600, a = i * 2.399963229728653, r = Math.sqrt(1 - y * y);
    return vec(Math.cos(a) * r, y, Math.sin(a) * r);
});
const edges = LAND_NODES.map((a, i) => LAND_NODES.map((b, j) => dot(a, b) > Math.cos(0.245) && i !== j ? j : -1)
    .filter(j => j >= 0));

export function connectedLand(planet: PlanetDesc, points: Array<V3>): boolean {
    const field = new SolidField(planet.holes, planet.radius);
    const tall = { ...planet, id: 0, obstacles: planet.obstacles.filter(o => o.height > 2.8) };
    const world = new ColliderWorld([tall]);
    const free = (d: V3) => field.isSolid(d) && world.clearance(0, d, 1.3);
    if (!points.every(free)) return false;
    const valid = LAND_NODES.map(free);
    const nearest = points.map(p => {
        let best = -1, score = -2;
        LAND_NODES.forEach((n, i) => {
            const d = dot(p, n);
            if (valid[i] && d > score) {
                score = d;
                best = i;
            }
        });
        return best;
    });
    if (nearest.some(i => i < 0)) return false;
    const visited = new Set<number>([nearest[0]]), queue = [nearest[0]], midpoint = vec();
    for (let head = 0; head < queue.length; head++) {
        const i = queue[head], a = LAND_NODES[i];
        for (const j of edges[i]) {
            if (!valid[j] || visited.has(j)) continue;
            const b = LAND_NODES[j];
            normalize(midpoint, { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
            if (!free(midpoint)) continue;
            visited.add(j);
            queue.push(j);
        }
    }
    return nearest.every(i => visited.has(i));
}
export function minClearance(planet: PlanetDesc): boolean {
    const field = new SolidField(planet.holes, planet.radius), world = new ColliderWorld([{ ...planet, id: 0 }]);
    return planet.spawnPoints.every(p => field.signedDistance(fromTuple(p)) >= 3 &&
        world.clearance(0, fromTuple(p), 3));
}
