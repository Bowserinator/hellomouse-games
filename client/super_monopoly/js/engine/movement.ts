export function walk(start: number, steps: number, length: number): Array<number> {
    return Array.from({ length: Math.abs(steps) }, (_, i) =>
        ((start + (i + 1) * Math.sign(steps)) % length + length) % length);
}
