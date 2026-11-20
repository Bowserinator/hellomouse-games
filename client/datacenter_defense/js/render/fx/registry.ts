export interface Emission {
    pool: 'additive' | 'alpha' | 'streak';
    count: number; life: number; size: number; endSize: number;
    speed: number; up?: number; color: number; end: number;
    kind?: number; delay?: number; alpha?: number;
    /** All particles share one speed (hollow spherical shell instead of a filled ball). */
    shell?: boolean;
    /** Use the burst's randomly chosen palette colour instead of color/end. */
    tinted?: boolean;
}
export interface EffectSpec {
    emit: Array<Emission>;
    ring?: { radius: number; life: number; color: string };
    shake?: number;
    /** Set false to suppress the white impact-flash sphere for splash projectiles using this effect. */
    flash?: boolean;
    /** Each trigger picks one of these [bright, fade] pairs for `tinted` emissions. */
    palette?: Array<[number, number]>;
}
const sparks: Emission = { pool: 'additive', count: 35, life: 0.6, size: 0.12, endSize: 0.02,
    speed: 12, up: 0.5, color: 0xffe5a0, end: 0xcc4a16 };
const smoke: Emission = { pool: 'alpha', count: 24, life: 1.5, size: 0.7, endSize: 2.4,
    speed: 3, up: 0.8, color: 0x736e64, end: 0x555555, kind: 2, alpha: 0.5 };
export const EFFECTS = new Map<string, EffectSpec>([
    ['muzzle', { emit: [{ ...sparks, count: 4, life: 0.07, size: 0.25, speed: 3 }] }],
    ['bullet', { emit: [{ ...sparks, count: 6, life: 0.18, speed: 3, size: 0.06 },
        { ...smoke, count: 3, life: 0.3, size: 0.12, endSize: 0.3 }] }],
    ['sniper', { emit: [{ ...sparks, count: 15, life: 0.3 }, { ...smoke, count: 6 }] }],
    ['explosion', { emit: [sparks, smoke], ring: { radius: 8, life: 0.5, color: '#e6ad68' }, shake: 0.1 }],
    ['water', { emit: [
        // droplets thrown up and out, falling back under gravity
        { ...sparks, pool: 'alpha', count: 40, life: 0.7, size: 0.2, endSize: 0.07, speed: 6, up: 1.0,
            color: 0xe4f6ff, end: 0x4a9ad4, alpha: 0.9 },
        // soft mist
        { ...smoke, count: 8, life: 0.7, size: 0.5, endSize: 1.6, speed: 2, color: 0xd6efff,
            end: 0xb4dcf5, alpha: 0.3 }],
    ring: { radius: 2.5, life: 0.5, color: '#9fdcff' } }],
    ['gas', { emit: [{ ...smoke, count: 36, life: 4, size: 1.2, endSize: 4,
        speed: 1, color: 0xa5ae76, end: 0x7f8d64, alpha: 0.35 }] }],
    ['firework', { palette: [[0xff4d4d, 0xaa1030], [0x58ff7a, 0x108a40], [0x5aa8ff, 0x2030b0],
        [0xffd84a, 0xc86a10], [0xff6ee0, 0x8a1c9a], [0x6af0ff, 0x1a70b0]],
    emit: [
        // glowing streak petals radiating from the burst
        { ...sparks, pool: 'streak', kind: 1, count: 70, life: 1.5, size: 0.09, endSize: 0.03,
            speed: 9, shell: true, up: 0.1, tinted: true },
        // round embers on the same shell, they droop as they fall
        { ...sparks, count: 70, life: 1.7, size: 0.16, endSize: 0.03, speed: 9, shell: true, tinted: true },
        // initial white flash
        { ...sparks, count: 16, life: 0.2, size: 0.5, endSize: 0.1, speed: 1, color: 0xffffff, end: 0xffe0a0 },
        // late white glitter crackle
        { ...sparks, count: 40, delay: 0.5, life: 0.5, size: 0.1, speed: 7, shell: true,
            color: 0xffffff, end: 0xffd070 }], shake: 0.06, flash: false }],
    ['tomahawk', { emit: [{ ...sparks, count: 200, life: 1.5, speed: 25 },
        { ...smoke, count: 50, life: 3, size: 2, endSize: 7, speed: 5 }],
    ring: { radius: 15, life: 0.8, color: '#e8b66c' }, shake: 0.35 }]
]);
