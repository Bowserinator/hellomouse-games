import type * as T from 'three';
import { SurfaceType } from '../../types.js';
import { Rng } from '../../sim/math/rng.js';

export interface SurfaceStyle {
    tint: number; spec: number; shine: number; reflect: number; bump: number;
    /** Size of the texture features relative to the default */
    scale?: number;
    /** Strength of the large-scale variation that hides the texture repeating */
    variety?: number;
}
export const SURFACE_STYLES: Record<SurfaceType, SurfaceStyle> = {
    [SurfaceType.ROCK]: { tint: 0x84786b, spec: 0.1, shine: 8, reflect: 0, bump: 0.28, variety: 1 },
    [SurfaceType.ICE]: { tint: 0x88c9f8, spec: 1, shine: 90, reflect: 0.3, bump: 0.75, scale: 2.5 },
    [SurfaceType.GRASS]: { tint: 0x62d03a, spec: 0.05, shine: 8, reflect: 0, bump: 0.1 },
    [SurfaceType.MIRROR]: { tint: 0xd5daeb, spec: 1, shine: 120, reflect: 1, bump: 0 },
    [SurfaceType.SNOW]: { tint: 0xd6e6ff, spec: 0, shine: 65, reflect: 0, bump: 0.1, variety: 1 },
    [SurfaceType.PLASTIC]: { tint: 0xd66ea0, spec: 0.5, shine: 55, reflect: 0.15, bump: 1.5 },
    [SurfaceType.SAND]: { tint: 0xf0dc9c, spec: 0.04, shine: 6, reflect: 0, bump: 0.18, variety: 1 }
};

/** Texture kind for obstacles, drawn instead of the planet surface */
export const STONE_TEXTURE = 100;
export const STONE_STYLE: SurfaceStyle = { tint: 0xa5a5ab, spec: 0.1, shine: 8, reflect: 0, bump: 0.3 };
/** Stone textures tinted as soil, for the walls of holes on grass planets */
export const DIRT_STYLE: SurfaceStyle = { tint: 0x7a5233, spec: 0.03, shine: 6, reflect: 0, bump: 0.3 };

const GRASS_DARK = 0.86, GRASS_BRIGHT = 1.12;
/** Brightness multipliers of the two mowing tones; the bright tone sits 60% closer to the dark one */
export const GRASS_TONES = { dark: GRASS_DARK, bright: GRASS_DARK + (GRASS_BRIGHT - GRASS_DARK) * 0.4 };

type TextureKind = SurfaceType | typeof STONE_TEXTURE;

const TAU = Math.PI * 2;
const byte = (v: number) => Math.max(0, Math.min(255, v * 255));
const smooth = (a: number, b: number, x: number) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
};

/** Tileable Voronoi facets with a random shade and tilt per cell */
function facets(size: number, cells: number, rng: Rng) {
    const points = Array.from({ length: cells * cells }, () => [rng.float(), rng.float(), rng.float(), rng.float()]);
    const height = new Float32Array(size * size), shade = new Float32Array(size * size);
    for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
            const u = x / size * cells, v = y / size * cells, cx = Math.floor(u), cy = Math.floor(v);
            let nearest = 9, best = points[0], bx = 0, by = 0;
            for (let oy = -1; oy <= 1; oy++)
                for (let ox = -1; ox <= 1; ox++) {
                    const gx = cx + ox, gy = cy + oy;
                    const p = points[((gy % cells + cells) % cells) * cells + (gx % cells + cells) % cells];
                    const d = Math.hypot(gx + p[0] - u, gy + p[1] - v);
                    if (d < nearest) {
                        nearest = d;
                        best = p;
                        bx = gx + p[0];
                        by = gy + p[1];
                    }
                }
            const angle = best[3] * TAU, i = y * size + x;
            height[i] = 0.5 + ((u - bx) * Math.cos(angle) + (v - by) * Math.sin(angle)) * 0.6;
            shade[i] = best[2];
        }
    return { height, shade };
}

/** Thin straight scratches with random direction and strength, wrapping around the tile edges */
function scratches(size: number, count: number, rng: Rng) {
    const out = new Float32Array(size * size);
    for (let n = 0; n < count; n++) {
        const angle = rng.float() * TAU, length = size * (0.1 + rng.float() * 0.3);
        const strength = 0.35 + rng.float() * 0.65, x0 = rng.float() * size, y0 = rng.float() * size;
        for (let t = 0; t < length; t++) {
            const x = Math.floor(x0 + Math.cos(angle) * t), y = Math.floor(y0 + Math.sin(angle) * t);
            const i = (((y % size) + size) % size) * size + ((x % size) + size) % size;
            out[i] = Math.max(out[i], strength * (1 - t / length * 0.6));
        }
    }
    return out;
}

export function makeTextures(kind: TextureKind, size: number): { albedo: T.DataTexture; bump: T.DataTexture } {
    const rng = new Rng(9384 + kind), grid = new Float32Array(64 * 64);
    for (let i = 0; i < grid.length; i++) grid[i] = rng.float();
    // Wraps at the scale so the texture tiles seamlessly
    const noise = (x: number, y: number, scale: number) => {
        x *= scale;
        y *= scale;
        const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
        const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
        const at = (dx: number, dy: number) =>
            grid[(((iy + dy) % scale) * 64 + (ix + dx) % scale + scale * 1009) % grid.length];
        return (at(0, 0) * (1 - u) + at(1, 0) * u) * (1 - v) + (at(0, 1) * (1 - u) + at(1, 1) * u) * v;
    };
    const ice = kind === SurfaceType.ICE
        ? { ...facets(size, 6, rng), scratch: scratches(size, Math.round(size * 0.35), rng) } : null;
    const colors = new Uint8Array(size * size * 4), heights = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
            const u = x / size, v = y / size, i = (y * size + x) * 4;
            const n = noise(u, v, 8) * 0.55 + noise(u, v, 32) * 0.3 + noise(u, v, 64) * 0.15;
            let c = 0.6 + n * 0.6, h = n, rgb = [1, 1, 1];
            if (ice) {
                const j = y * size + x;
                const frost = noise(u, v, 64);
                c = 0.77 + ice.shade[j] * 0.22 + frost * 0.08 + ice.scratch[j] * 0.3;
                h = ice.height[j] * 0.85 + n * 0.1 - ice.scratch[j] * 0.1;
                rgb = [0.9 + ice.shade[j] * 0.1, 0.96, 1];
            }
            if (kind === SurfaceType.SNOW) c = 0.94 + n * 0.06;
            if (kind === SurfaceType.GRASS) {
                const mow = noise(u, v, 6);
                c = 0.8 + n * 0.28;
                h = noise(u, v, 8) * 0.6 + noise(u, v, 16) * 0.4;
                rgb = [0.9 + mow * 0.2, 1, 0.9];
            }
            if (kind === SurfaceType.SAND) {
                const ripple = 0.5 + 0.5 * Math.sin(TAU * (5 * u + 2 * v) + noise(u, v, 8) * 6);
                c = 0.86 + noise(u, v, 4) * 0.1 + noise(u, v, 64) * 0.05 - ripple * 0.05 + rng.float() * 0.04;
                h = ripple * 0.5 + noise(u, v, 16) * 0.3 + rng.float() * 0.05;
            }
            if (kind === STONE_TEXTURE) {
                const strata = Math.sin(TAU * (3 * u + 2 * v) + noise(u, v, 8) * 5);
                c = 0.78 + n * 0.25 - Math.pow(Math.abs(strata), 10) * 0.22 + strata * 0.04;
                h = n * 0.6 + (0.5 + 0.5 * strata) * 0.3;
            }
            if (kind === SurfaceType.PLASTIC) {
                const dx = (u * 8 % 1) - 0.5, dy = (v * 8 % 1) - 0.5, r = Math.hypot(dx, dy);
                const top = 1 - smooth(0.2, 0.3, r);
                c = 0.94 + top * 0.06 - (1 - top) * smooth(0.5, 0.3, r) * 0.14;
                h = top;
            }
            if (kind === SurfaceType.MIRROR) {
                c = 1;
                h = 0;
            }
            colors[i] = byte(c * rgb[0]);
            colors[i + 1] = byte(c * rgb[1]);
            colors[i + 2] = byte(c * rgb[2]);
            colors[i + 3] = 255;
            heights[i] = heights[i + 1] = heights[i + 2] = byte(h);
            heights[i + 3] = 255;
        }
    const texture = (data: Uint8Array) => {
        const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.generateMipmaps = true;
        t.minFilter = THREE.LinearMipmapLinearFilter;
        t.magFilter = THREE.LinearFilter;
        t.anisotropy = 4;
        t.needsUpdate = true;
        return t;
    };
    return { albedo: texture(colors), bump: texture(heights) };
}
