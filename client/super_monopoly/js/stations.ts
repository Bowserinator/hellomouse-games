import type { Pose } from './types.js';

export function station(seat: number, count: number): Pose {
    const side = seat % 3;
    const total = Math.ceil((count - side) / 3);
    const along = (Math.floor(seat / 3) - (total - 1) / 2) * 385;
    if (side === 1) return { x: -785, y: along, angle: 90 };
    return { x: along, y: side === 0 ? -755 : 755, angle: side === 0 ? 180 : 0 };
}
