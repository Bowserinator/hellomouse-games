interface RandomDirection {
    x: number;
    y: number;
    z: number;
}

export class Rng {
    private state: number;
    constructor(readonly seed: number) {
        this.state = seed >>> 0;
    }
    get currentState(): number {
        return this.state;
    }
    float(): number {
        let t = this.state += 0x6d2b79f5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
    range(a: number, b: number): number {
        return a + (b - a) * this.float();
    }
    int(a: number, b: number): number {
        return Math.floor(this.range(a, b + 1));
    }
    pick<T>(items: Array<T>): T {
        return items[this.int(0, items.length - 1)];
    }
    weighted<T>(items: Array<T>, weight: (item: T) => number): T {
        let n = this.float() * items.reduce((sum, item) => sum + weight(item), 0);
        for (const item of items) {
            n -= weight(item);
            if (n <= 0) return item;
        }
        return items[items.length - 1];
    }
    unitVec(): RandomDirection {
        const y = this.range(-1, 1), a = this.range(0, Math.PI * 2), r = Math.sqrt(1 - y * y);
        return { x: r * Math.cos(a), y, z: r * Math.sin(a) };
    }
    gauss(): number {
        return Math.sqrt(-2 * Math.log(Math.max(this.float(), 1e-10))) * Math.cos(2 * Math.PI * this.float());
    }
    fork(label: number): Rng {
        return new Rng((this.seed ^ Math.imul(label, 7919)) >>> 0);
    }
}
