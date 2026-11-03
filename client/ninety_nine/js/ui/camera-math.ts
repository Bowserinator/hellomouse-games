import type { Size, Vec } from './polygon.js';

export interface Camera {
    x: number;
    y: number;
    scale: number;
}

export const MIN_SCALE = 0.25;
export const MAX_SCALE = 2.5;

export function clampScale(scale: number, min = MIN_SCALE, max = MAX_SCALE): number {
    return Math.min(Math.max(scale, min), max);
}

export function worldToScreen(camera: Camera, point: Vec): Vec {
    return { x: point.x * camera.scale + camera.x, y: point.y * camera.scale + camera.y };
}

export function screenToWorld(camera: Camera, point: Vec): Vec {
    return { x: (point.x - camera.x) / camera.scale, y: (point.y - camera.y) / camera.scale };
}

export function panBy(camera: Camera, dx: number, dy: number): Camera {
    return { x: camera.x + dx, y: camera.y + dy, scale: camera.scale };
}

export function zoomAt(camera: Camera, screen: Vec, factor: number, min = MIN_SCALE, max = MAX_SCALE): Camera {
    const world = screenToWorld(camera, screen);
    const scale = clampScale(camera.scale * factor, min, max);
    return { x: screen.x - world.x * scale, y: screen.y - world.y * scale, scale };
}

export function fitCamera(content: Size, viewport: Size, margin = 40): Camera {
    const scale = clampScale(
        Math.min((viewport.w - margin * 2) / content.w, (viewport.h - margin * 2) / content.h)
    );
    return {
        x: (viewport.w - content.w * scale) / 2,
        y: (viewport.h - content.h * scale) / 2,
        scale
    };
}

export interface HomeFocus {
    top: number;
    bottom: number;
}

export function homeCamera(
    content: Size,
    viewport: Size,
    focus: HomeFocus,
    margin = 12
): Camera {
    const span = Math.max(1, focus.bottom - focus.top);
    const scale = clampScale(Math.min(1, (viewport.h - margin * 2) / span));
    const centerY = Math.min(
        viewport.h * 0.35,
        viewport.h - margin - (focus.bottom - content.h / 2) * scale
    );
    return {
        x: (viewport.w - content.w * scale) / 2,
        y: centerY - (content.h / 2) * scale,
        scale
    };
}

export function contains(camera: Camera, content: Size, viewport: Size): boolean {
    const topLeft = worldToScreen(camera, { x: 0, y: 0 });
    const bottomRight = worldToScreen(camera, { x: content.w, y: content.h });
    return topLeft.x >= 0 && topLeft.y >= 0 && bottomRight.x <= viewport.w && bottomRight.y <= viewport.h;
}
