export interface V3 {
    x: number; y: number; z: number;
}
export type Tuple3 = [number, number, number];
export const vec = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });
export const tuple = (a: V3): Tuple3 => [a.x, a.y, a.z];
export const fromTuple = (a: Tuple3): V3 => vec(...a);
export function set(out: V3, x: number, y: number, z: number): V3 {
    out.x = x;
    out.y = y;
    out.z = z;
    return out;
}
export const copy = (out: V3, a: V3): V3 => set(out, a.x, a.y, a.z);
export const add = (out: V3, a: V3, b: V3): V3 => set(out, a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (out: V3, a: V3, b: V3): V3 => set(out, a.x - b.x, a.y - b.y, a.z - b.z);
export const scale = (out: V3, a: V3, s: number): V3 => set(out, a.x * s, a.y * s, a.z * s);
export const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const length = (a: V3): number => Math.hypot(a.x, a.y, a.z);
export const distance = (a: V3, b: V3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const clamp = (n: number, a: number, b: number): number => Math.max(a, Math.min(b, n));
export function cross(out: V3, a: V3, b: V3): V3 {
    return set(out, a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
}
export function normalize(out: V3, a: V3): V3 {
    const n = length(a);
    return scale(out, a, n > 1e-10 ? 1 / n : 0);
}
export function lerp(out: V3, a: V3, b: V3, t: number): V3 {
    return set(out, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
}
export function tangentProject(out: V3, a: V3, up: V3): V3 {
    const d = dot(a, up);
    return set(out, a.x - up.x * d, a.y - up.y * d, a.z - up.z * d);
}
export function reproject(out: V3, a: V3, up: V3): V3 {
    tangentProject(out, a, up);
    if (length(out) < 1e-8) {
        set(out, Math.abs(up.y) < 0.9 ? 0 : 1, Math.abs(up.y) < 0.9 ? 1 : 0, 0);
        tangentProject(out, out, up);
    }
    return normalize(out, out);
}
export function tangentBasis(up: V3): [V3, V3] {
    const x = reproject(vec(), vec(1, 0, 0), up);
    return [x, normalize(vec(), cross(vec(), x, up))];
}
export function rotate(out: V3, v: V3, axis: V3, angle: number): V3 {
    const c = Math.cos(angle), s = Math.sin(angle), d = dot(v, axis) * (1 - c);
    return set(out, v.x * c + (axis.y * v.z - axis.z * v.y) * s + axis.x * d,
        v.y * c + (axis.z * v.x - axis.x * v.z) * s + axis.y * d,
        v.z * c + (axis.x * v.y - axis.y * v.x) * s + axis.z * d);
}
export function reflect(out: V3, velocity: V3, normal: V3): V3 {
    const inward = 2 * dot(velocity, normal);
    return set(out, velocity.x - inward * normal.x, velocity.y - inward * normal.y, velocity.z - inward * normal.z);
}
export function finiteTuple(value: unknown): value is Tuple3 {
    return Array.isArray(value) && value.length === 3 && value.every(n => typeof n === 'number' && Number.isFinite(n));
}
