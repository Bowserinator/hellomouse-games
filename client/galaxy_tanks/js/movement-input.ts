import { V3, add, copy, cross, dot, length, normalize, reproject, rotate, scale, vec } from './sim/math/vec3.js';

export class MovementInput {
    private held = new Map<string, { direction: V3; up: V3 }>();
    capture(key: string, right: V3, forward: V3, up: V3): void {
        if (this.held.has(key)) return;
        const horizontal = Number(key === 'd') - Number(key === 'a');
        const vertical = Number(key === 'w') - Number(key === 's');
        if (!horizontal && !vertical) return;
        const direction = add(vec(), scale(vec(), right, horizontal), scale(vec(), forward, vertical));
        this.held.set(key, { direction: reproject(direction, direction, up), up: { ...up } });
    }
    release(key: string): void {
        this.held.delete(key);
    }
    reset(): void {
        this.held.clear();
    }
    direction(up: V3, out: V3): V3 {
        scale(out, out, 0);
        for (const held of this.held.values()) {
            const axis = cross(vec(), held.up, up), sine = length(axis);
            if (sine > 1e-8) {
                scale(axis, axis, 1 / sine);
                rotate(held.direction, held.direction, axis, Math.atan2(sine, dot(held.up, up)));
            }
            reproject(held.direction, held.direction, up);
            copy(held.up, up);
            add(out, out, held.direction);
        }
        if (length(out) > 1) normalize(out, out);
        return out;
    }
}
