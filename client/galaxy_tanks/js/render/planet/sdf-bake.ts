import { SolidField } from '../../sim/mapgen/solid-field.js';
import { V3, normalize, vec } from '../../sim/math/vec3.js';

export function cubeDirection(face: number, u: number, v: number, out: V3 = vec()): V3 {
    const axes = [[1, -v, -u], [-1, -v, u], [u, 1, v], [u, -1, -v], [u, -v, 1], [-u, -v, -1]];
    const a = axes[face];
    out.x = a[0];
    out.y = a[1];
    out.z = a[2];
    return normalize(out, out);
}
export interface SdfBake {
    size: number; faces: Array<Uint8ClampedArray>;
}
export function bakeSdf(field: SolidField, size: number): SdfBake {
    const dir = vec(), faces: Array<Uint8ClampedArray> = [];
    for (let face = 0; face < 6; face++) {
        const bytes = new Uint8ClampedArray(size * size * 4);
        for (let y = 0; y < size; y++)
            for (let x = 0; x < size; x++) {
                cubeDirection(face, 2 * (x + 0.5) / size - 1, 2 * (y + 0.5) / size - 1, dir);
                const value = Math.max(0, Math.min(255, 127.5 + field.signedDistance(dir) * 64));
                const i = (y * size + x) * 4;
                bytes[i] = bytes[i + 1] = bytes[i + 2] = value;
                bytes[i + 3] = 255;
            }
        faces.push(bytes);
    }
    return { size, faces };
}
export function sampleBake(bake: SdfBake, dir: V3): number {
    const x = dir.x, y = dir.y, z = dir.z, ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
    let face: number, u: number, v: number;
    if (ax >= ay && ax >= az) {
        face = x > 0 ? 0 : 1;
        u = x > 0 ? -z / ax : z / ax;
        v = -y / ax;
    } else if (ay >= az) {
        face = y > 0 ? 2 : 3;
        u = x / ay;
        v = y > 0 ? z / ay : -z / ay;
    } else {
        face = z > 0 ? 4 : 5;
        u = z > 0 ? x / az : -x / az;
        v = -y / az;
    }
    const px = Math.max(0, Math.min(bake.size - 1, (u + 1) * bake.size / 2 - 0.5));
    const py = Math.max(0, Math.min(bake.size - 1, (v + 1) * bake.size / 2 - 0.5));
    const ix = Math.floor(px), iy = Math.floor(py), fx = px - ix, fy = py - iy;
    const at = (dx: number, dy: number) => bake.faces[face][
        (Math.min(iy + dy, bake.size - 1) * bake.size + Math.min(ix + dx, bake.size - 1)) * 4] / 255;
    return (at(0, 0) * (1 - fx) + at(1, 0) * fx) * (1 - fy) +
        (at(0, 1) * (1 - fx) + at(1, 1) * fx) * fy;
}
