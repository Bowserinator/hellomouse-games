import { Vector3 } from './vector3.js';

export function distanceSquaredFromSegmentToBox(start: Vector3, end: Vector3,
    minimum: Vector3, maximum: Vector3): number {
    const axes = ['x', 'y', 'z'] as const;
    const breaks = [0, 1];
    for (const axis of axes) {
        const delta = end[axis] - start[axis];
        if (delta === 0) continue;
        for (const bound of [minimum[axis], maximum[axis]]) {
            const crossing = (bound - start[axis]) / delta;
            if (crossing > 0 && crossing < 1) breaks.push(crossing);
        }
    }
    breaks.sort((first, second) => first - second);
    let nearestSquared = Infinity;
    for (let index = 0; index < breaks.length - 1; index++) {
        const left = breaks[index], right = breaks[index + 1], middle = (left + right) / 2;
        let linear = 0, quadratic = 0;
        for (const axis of axes) {
            const delta = end[axis] - start[axis];
            const middlePoint = start[axis] + middle * delta;
            const bound = middlePoint < minimum[axis] ? minimum[axis]
                : middlePoint > maximum[axis] ? maximum[axis] : null;
            if (bound === null) continue;
            linear += (start[axis] - bound) * delta;
            quadratic += delta * delta;
        }
        const parameter = quadratic === 0 ? left : Math.max(left, Math.min(right, -linear / quadratic));
        let squared = 0;
        for (const axis of axes) {
            const point = start[axis] + parameter * (end[axis] - start[axis]);
            const distance = Math.max(minimum[axis] - point, 0, point - maximum[axis]);
            squared += distance * distance;
        }
        nearestSquared = Math.min(nearestSquared, squared);
        if (nearestSquared === 0) return 0;
    }
    return nearestSquared;
}
