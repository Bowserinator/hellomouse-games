function hash3(x: number, y: number, z: number): number {
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function valueNoise(x: number, y: number, z: number): number {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    const fx = x - ix, fy = y - iy, fz = z - iz;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
    const a000 = hash3(ix, iy, iz), a100 = hash3(ix + 1, iy, iz);
    const a010 = hash3(ix, iy + 1, iz), a110 = hash3(ix + 1, iy + 1, iz);
    const a001 = hash3(ix, iy, iz + 1), a101 = hash3(ix + 1, iy, iz + 1);
    const a011 = hash3(ix, iy + 1, iz + 1), a111 = hash3(ix + 1, iy + 1, iz + 1);
    const x00 = a000 + (a100 - a000) * u, x10 = a010 + (a110 - a010) * u;
    const x01 = a001 + (a101 - a001) * u, x11 = a011 + (a111 - a011) * u;
    const y0 = x00 + (x10 - x00) * v, y1 = x01 + (x11 - x01) * v;
    return y0 + (y1 - y0) * w;
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
