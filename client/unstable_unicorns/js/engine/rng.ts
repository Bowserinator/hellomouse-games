export interface Rng {
    s: number;
}

export function seedFrom(text: string): Rng {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return { s: h >>> 0 };
}

export function nextFloat(rng: Rng): number {
    let t = (rng.s = (rng.s + 0x6D2B79F5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function nextInt(rng: Rng, n: number): number {
    return Math.floor(nextFloat(rng) * n);
}

export function pick<T>(rng: Rng, items: Array<T>): T | undefined {
    if (items.length === 0) return undefined;
    return items[nextInt(rng, items.length)];
}

export function shuffle<T>(rng: Rng, items: Array<T>): Array<T> {
    for (let i = items.length - 1; i > 0; i--) {
        const j = nextInt(rng, i + 1);
        const tmp = items[i];
        items[i] = items[j];
        items[j] = tmp;
    }
    return items;
}
