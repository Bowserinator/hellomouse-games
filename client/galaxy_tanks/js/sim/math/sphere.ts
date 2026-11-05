import { V3, clamp, dot, length, normalize, set, reproject } from './vec3.js';
export { tangentProject, reproject } from './vec3.js';
export const angDist = (a: V3, b: V3): number => Math.acos(clamp(dot(a, b), -1, 1));

export function advance(dir: V3, vel: V3, dt: number, radius: number): void {
    const speed = length(vel);
    if (speed < 1e-10) return;
    const a = speed * dt / radius, c = Math.cos(a), s = Math.sin(a);
    const x = dir.x, y = dir.y, z = dir.z;
    set(dir, x * c + vel.x / speed * s, y * c + vel.y / speed * s, z * c + vel.z / speed * s);
    set(vel, vel.x * c - x * speed * s, vel.y * c - y * speed * s, vel.z * c - z * speed * s);
    normalize(dir, dir);
}
/** Point at angular distance `theta` from `center`, `phi` around it, given a tangent basis (u, v) at `center` */
export function circlePoint(out: V3, center: V3, u: V3, v: V3, theta: number, phi: number): V3 {
    const c = Math.cos(theta), a = Math.sin(theta) * Math.cos(phi), b = Math.sin(theta) * Math.sin(phi);
    return set(out, center.x * c + u.x * a + v.x * b, center.y * c + u.y * a + v.y * b,
        center.z * c + u.z * a + v.z * b);
}
export function slerpDir(out: V3, a: V3, b: V3, t: number): V3 {
    const angle = angDist(a, b), sine = Math.sin(angle);
    if (angle < 1e-7) return set(out, a.x, a.y, a.z);
    if (Math.abs(sine) < 1e-7) {
        reproject(out, { x: 1, y: 0, z: 0 }, a);
        const c = Math.cos(Math.PI * t), s = Math.sin(Math.PI * t);
        return set(out, a.x * c + out.x * s, a.y * c + out.y * s, a.z * c + out.z * s);
    }
    const u = Math.sin((1 - t) * angle) / sine, v = Math.sin(t * angle) / sine;
    return normalize(out, set(out, a.x * u + b.x * v, a.y * u + b.y * v, a.z * u + b.z * v));
}
