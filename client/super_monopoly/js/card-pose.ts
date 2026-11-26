import type { Pose } from './types.js';

export const CARD_WIDTH = 214;
export const CARD_HEIGHT = 124;
export const TABLE_RADIUS = 1800;

export function validPose(pose: Pose, width: number, height: number): boolean {
    if (![pose.x, pose.y, pose.angle].every(Number.isFinite) || Math.abs(pose.angle) >= 360) return false;
    const angle = pose.angle * Math.PI / 180;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const axes = [[1, 0], [0, 1], [cos, sin], [-sin, cos]];
    for (const x of [-CARD_WIDTH / 2, CARD_WIDTH / 2])
        for (const y of [-CARD_HEIGHT / 2, CARD_HEIGHT / 2])
            if (Math.hypot(pose.x + x * cos - y * sin, pose.y + x * sin + y * cos) > TABLE_RADIUS) return false;


    return axes.some(([x, y]) => Math.abs(pose.x * x + pose.y * y) >=
        width / 2 * Math.abs(x) + height / 2 * Math.abs(y) +
        CARD_WIDTH / 2 * Math.abs(x * cos + y * sin) + CARD_HEIGHT / 2 * Math.abs(-x * sin + y * cos));
}
