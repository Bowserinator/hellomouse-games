import type { Camera, HomeFocus } from './camera-math.js';
import { fitCamera, homeCamera, panBy, zoomAt } from './camera-math.js';
import type { Size } from './polygon.js';

export const PAN_THRESHOLD = 5;
export const FAR_SCALE = 0.55;

export interface CameraOptions {
    frame: HTMLElement;
    world: HTMLElement;
    content: () => Size;
    home?: () => HomeFocus | null;
    onChange?: (camera: Camera) => void;
}

interface Point {
    x: number;
    y: number;
}

export class CameraController {
    private frame: HTMLElement;
    private world: HTMLElement;
    private content: () => Size;
    private home: () => HomeFocus | null;
    private onChange: (camera: Camera) => void;
    private camera: Camera = { x: 0, y: 0, scale: 1 };
    private pointers = new Map<number, Point>();
    private start: Point | null = null;
    private dragging = false;
    private pinch: { distance: number; camera: Camera; middle: Point } | null = null;
    private moved = false;
    private suppressClick = false;

    constructor(options: CameraOptions) {
        this.frame = options.frame;
        this.world = options.world;
        this.content = options.content;
        this.home = options.home ?? (() => null);
        this.onChange = options.onChange ?? (() => undefined);

        this.frame.addEventListener('wheel', event => this.onWheel(event), { passive: false });
        this.frame.addEventListener('pointerdown', event => this.onDown(event));
        this.frame.addEventListener('pointermove', event => this.onMove(event));
        this.frame.addEventListener('pointerup', event => this.onUp(event));
        this.frame.addEventListener('pointercancel', event => this.onUp(event));
        this.frame.addEventListener('lostpointercapture', event => this.onUp(event));
        this.frame.addEventListener('click', event => {
            if (!this.suppressClick) return;
            this.suppressClick = false;
            event.stopPropagation();
            event.preventDefault();
        }, true);
        window.addEventListener('keydown', event => this.onKey(event));
        window.addEventListener('resize', () => {
            if (!this.moved) this.reset();
        });
        this.reset();
    }

    get current(): Camera {
        return this.camera;
    }

    set(camera: Camera): void {
        this.camera = camera;
        this.world.style.transform =
            `translate(${camera.x.toFixed(2)}px, ${camera.y.toFixed(2)}px) scale(${camera.scale.toFixed(4)})`;
        this.world.dataset.lod = camera.scale < FAR_SCALE ? 'far' : 'near';
        this.onChange(camera);
    }

    fit(): void {
        this.moved = false;
        const content = this.content();
        const viewport = this.viewport();
        if (content.w <= 0 || content.h <= 0 || viewport.w <= 0 || viewport.h <= 0) return;
        this.set(fitCamera(content, viewport));
    }

    reset(): void {
        this.moved = false;
        const content = this.content();
        const viewport = this.viewport();
        if (content.w <= 0 || content.h <= 0 || viewport.w <= 0 || viewport.h <= 0) return;
        const focus = this.home();
        this.set(focus ? homeCamera(content, viewport, focus) : fitCamera(content, viewport));
    }

    zoom(factor: number): void {
        const viewport = this.viewport();
        if (viewport.w <= 0 || viewport.h <= 0) return;
        this.moved = true;
        this.set(zoomAt(this.camera, { x: viewport.w / 2, y: viewport.h / 2 }, factor));
    }

    private viewport(): Size {
        return { w: this.frame.clientWidth, h: this.frame.clientHeight };
    }

    private local(point: Point): Point {
        const box = this.frame.getBoundingClientRect();
        return { x: point.x - box.left, y: point.y - box.top };
    }

    private onWheel(event: WheelEvent): void {
        event.preventDefault();
        const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
        this.moved = true;
        this.set(zoomAt(this.camera, this.local(event), factor));
    }

    private onDown(event: PointerEvent): void {
        if (event.button !== 0) return;
        const point = this.local(event);
        this.pointers.set(event.pointerId, point);
        if (this.pointers.size === 1) {
            this.start = point;
            this.dragging = false;
            this.suppressClick = false;
        } else if (this.pointers.size >= 2)
            this.beginPinch();
    }

    private beginPinch(): void {
        if (this.pointers.size < 2) {
            this.pinch = null;
            return;
        }
        const [first, second] = [...this.pointers.values()];
        this.pinch = {
            distance: Math.hypot(second.x - first.x, second.y - first.y),
            camera: this.camera,
            middle: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
        };
        this.suppressClick = true;
        for (const id of this.pointers.keys()) this.frame.setPointerCapture(id);
    }

    private onMove(event: PointerEvent): void {
        const previous = this.pointers.get(event.pointerId);
        if (!previous) return;
        const next = this.local(event);
        this.pointers.set(event.pointerId, next);

        if (this.pointers.size >= 2 && this.pinch) {
            const [first, second] = [...this.pointers.values()];
            const distance = Math.hypot(second.x - first.x, second.y - first.y);
            if (this.pinch.distance <= 0) return;
            const middle = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
            const base = panBy(this.pinch.camera,
                middle.x - this.pinch.middle.x, middle.y - this.pinch.middle.y);
            this.moved = true;
            this.set(zoomAt(base, middle, distance / this.pinch.distance));
            return;
        }

        if (!this.start) return;
        if (!this.dragging) {
            const travelled = Math.hypot(next.x - this.start.x, next.y - this.start.y);
            if (travelled < PAN_THRESHOLD) return;
            this.dragging = true;
            this.suppressClick = true;
            if (!this.frame.hasPointerCapture(event.pointerId))
                this.frame.setPointerCapture(event.pointerId);
            this.start = next;
            this.world.classList.add('panning');
        }
        this.moved = true;
        this.set(panBy(this.camera, next.x - previous.x, next.y - previous.y));
    }

    private onUp(event: PointerEvent): void {
        if (this.frame.hasPointerCapture(event.pointerId))
            this.frame.releasePointerCapture(event.pointerId);
        this.pointers.delete(event.pointerId);
        if (this.pointers.size >= 2) {
            this.beginPinch();
            return;
        }
        this.pinch = null;
        if (this.pointers.size === 1) {
            const [remaining] = [...this.pointers.values()];
            this.start = { ...remaining };
            this.dragging = false;
            this.world.classList.remove('panning');
            return;
        }
        this.start = null;
        this.dragging = false;
        this.world.classList.remove('panning');
    }

    private onKey(event: KeyboardEvent): void {
        const target = event.target as HTMLElement | null;
        if (target?.closest('input, textarea')) return;

        if (event.key === '+' || event.key === '=') return this.zoom(1.15);
        if (event.key === '-' || event.key === '_') return this.zoom(1 / 1.15);
        if (event.key === '0') return this.fit();

        const step = event.shiftKey ? 120 : 40;
        const moves: Record<string, Point> = {
            arrowleft: { x: step, y: 0 },
            arrowright: { x: -step, y: 0 },
            arrowup: { x: 0, y: step },
            arrowdown: { x: 0, y: -step }
        };
        const move = moves[event.key.toLowerCase()];
        if (!move) return;
        event.preventDefault();
        this.moved = true;
        this.set(panBy(this.camera, move.x, move.y));
    }

    get isDragging(): boolean {
        return this.dragging;
    }
}
