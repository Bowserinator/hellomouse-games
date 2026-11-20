import type { Point } from '../mapx.js';

const widths = new Map<string, number>([
    ['motorway', 12], ['motorway_link', 6], ['trunk', 10], ['trunk_link', 6],
    ['primary', 12], ['primary_link', 6], ['secondary', 8], ['secondary_link', 5],
    ['tertiary', 7], ['tertiary_link', 5], ['residential', 6], ['unclassified', 6],
    ['living_street', 5], ['service', 4], ['track', 3], ['pedestrian', 4],
    ['footway', 2], ['path', 2], ['steps', 2], ['cycleway', 2], ['bridleway', 3]
]);

export function roadWidth(tags: Record<string, string>): number {
    const explicit = parseFloat(tags.width);
    const lanes = Number(tags.lanes);
    const walking = ['footway', 'path', 'steps', 'cycleway', 'bridleway', 'pedestrian'].includes(tags.highway);
    const width = Number.isFinite(explicit) && explicit > 0 ? explicit
        : !walking && Number.isInteger(lanes) && lanes > 0 ? lanes * 3.25 : widths.get(tags.highway) ?? 6;
    return Math.max(2, Math.min(30, width));
}

export function roadPolygons(points: Array<Point>, width: number): Array<Array<Point>> {
    if (!Number.isFinite(width) || width < 2 || width > 30) throw Error('Road width must be between 2 and 30 m');
    if (points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.z))) throw Error('Invalid road coordinates');
    if (points.length < 2) return [];
    const path = [points[0]], last = points[points.length - 1];
    for (let i = 1; i < points.length - 1; i++) {
        const previous = path[path.length - 1], point = points[i];
        if (Math.hypot(point.x - previous.x, point.z - previous.z) >= width / 4) path.push(point);
    }
    if (path.length > 1 && Math.hypot(last.x - path[path.length - 1].x, last.z - path[path.length - 1].z) < width / 4)
        path.pop();
    path.push(last);
    const closed = points[0].x === last.x && points[0].z === last.z;
    const radius = width / 2;
    // Keep the cap's chord error below the 5 cm edge inset, including MAPX rounding.
    const steps = Math.max(8, Math.ceil(Math.PI / (2 * Math.acos(1 - 0.03 / radius))));
    const result: Array<Array<Point>> = [];
    for (let i = 1; i < path.length; i++) {
        const a = path[i - 1], b = path[i];
        const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
        if (length < 0.1) continue;
        const angle = Math.atan2(dz, dx), nx = -dz / length * radius, nz = dx / length * radius;
        const polygon = [{ x: a.x - nx, z: a.z - nz }];
        if (i < path.length - 1 || closed)
            for (let step = 0; step <= steps; step++) {
                const theta = angle - Math.PI / 2 + step * Math.PI / steps;
                polygon.push({ x: b.x + Math.cos(theta) * radius, z: b.z + Math.sin(theta) * radius });
            }
        else polygon.push({ x: b.x - nx, z: b.z - nz }, { x: b.x + nx, z: b.z + nz });
        if (i > 1 || closed)
            for (let step = 0; step < steps; step++) {
                const theta = angle + Math.PI / 2 + step * Math.PI / steps;
                polygon.push({ x: a.x + Math.cos(theta) * radius, z: a.z + Math.sin(theta) * radius });
            }
        else polygon.push({ x: a.x + nx, z: a.z + nz });
        result.push(polygon);
    }
    return result;
}
