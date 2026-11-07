function hash3(x: number, y: number, z: number): number {
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function valueNoise(x: number, y: number, z: number): number {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    const fx = x - ix, fy = y - iy, fz = z - iz;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
    const at = (dx: number, dy: number, dz: number) => hash3(ix + dx, iy + dy, iz + dz);
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    return lerp(lerp(lerp(at(0, 0, 0), at(1, 0, 0), u), lerp(at(0, 1, 0), at(1, 1, 0), u), v),
        lerp(lerp(at(0, 0, 1), at(1, 0, 1), u), lerp(at(0, 1, 1), at(1, 1, 1), u), v), w);
}
export function cloudCover(d: { x: number; y: number; z: number }, offset: number): number {
    let sum = 0, amplitude = 0.5, frequency = 2.4;
    for (let octave = 0; octave < 4; octave++) {
        sum += valueNoise(d.x * frequency + offset, d.y * frequency * 1.6, d.z * frequency - offset) * amplitude;
        amplitude *= 0.5;
        frequency *= 2.1;
    }
    return sum;
}
