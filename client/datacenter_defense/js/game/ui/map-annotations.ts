import { MARKER_LENGTH, MARKER_LIMIT, PING_KINDS, PLAYER_COLORS, type AnnotationAction, type AnnotationPoint,
    type MapAnnotation, type PingKind } from '../../shared/protocol.js';
import type { RtsCamera } from '../input/rts-camera.js';
import { fontIcon } from './icons.js';

const icons = { note: 'info', warning: 'warning', attack: 'gps_fixed', marker: 'place' };
const labels = { note: 'Note ping', warning: 'Warning ping', attack: 'Attack ping', marker: 'Place marker' };
const shortcuts = { note: 'F6', warning: 'F5', attack: 'F7', marker: 'F8' };
const pingDuration = 1500;
const svgNS = 'http://www.w3.org/2000/svg';

type Tool = keyof typeof icons;
type Pin = AnnotationPoint & { element: HTMLElement };
type Ping = Pin & { expires: number; arrow: HTMLElement; ring: SVGSVGElement; label: HTMLElement };

function pingRing(kind: PingKind) {
    const ring = document.createElementNS(svgNS, 'svg');
    ring.setAttribute('viewBox', '0 0 48 48');
    ring.setAttribute('aria-hidden', 'true');
    ring.classList.add('map-annotations__ring');
    const radii = { note: [22, 11], warning: [22, 15, 8], attack: [22] };
    for (const radius of radii[kind]) {
        const circle = document.createElementNS(svgNS, 'circle');
        circle.setAttribute('cx', '24'); circle.setAttribute('cy', '24');
        circle.setAttribute('r', String(radius));
        ring.append(circle);
    }
    if (kind === 'attack') {
        const marks = document.createElementNS(svgNS, 'path');
        marks.setAttribute('d', 'M24 2v9 M24 37v9 M2 24h9 M37 24h9');
        ring.append(marks);
    }
    return ring;
}

export function annotationToolbar(parent: HTMLElement, select: (tool: Tool) => void) {
    const toolbar = document.createElement('div');
    toolbar.className = 'map-annotation-tools';
    const buttons = [...PING_KINDS, 'marker' as const].map(tool => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.kind = tool;
        button.title = `${labels[tool]} (${shortcuts[tool]})`;
        button.setAttribute('aria-label', labels[tool]);
        button.setAttribute('aria-keyshortcuts', shortcuts[tool]);
        button.setAttribute('aria-pressed', 'false');
        button.append(fontIcon(icons[tool]));
        button.onclick = () => select(tool);
        toolbar.append(button);
        return button;
    });
    parent.append(toolbar);
    return { toolbar, buttons };
}

export class MapAnnotations {
    private controller = new AbortController();
    private layer = document.createElement('div');
    private dialog = document.createElement('dialog') as HTMLDialogElement & { showModal(): void; close(): void };
    private input = document.createElement('input');
    private pins = new Map<number, Pin>();
    private nextLocalPin = 1;
    private pings = new Set<Ping>();
    private tools: ReturnType<typeof annotationToolbar>;
    private armed?: Tool;
    private drag?: { id: number; pointer: number; x: number; y: number; moved: boolean; point?: AnnotationPoint };
    private placementPointer?: number;
    private mouse?: MouseEvent;
    private markerPoint?: AnnotationPoint;

    constructor(private camera: RtsCamera, host: HTMLElement, parent: HTMLElement,
        private send: (action: AnnotationAction) => void, private cancelOrder: () => void,
        private onPing?: () => void) {
        this.layer.className = 'map-annotations';
        this.tools = annotationToolbar(parent, tool => {
            const wasArmed = this.armed === tool;
            this.arm();
            if (wasArmed) return;
            this.cancelOrder();
            this.arm(tool);
        });
        this.dialog.className = 'map-annotation-dialog';
        this.dialog.setAttribute('aria-label', 'Place marker');
        const form = document.createElement('form'), label = document.createElement('label');
        const cancel = document.createElement('button'), place = document.createElement('button');
        label.textContent = 'Marker message'; label.append(this.input);
        this.input.maxLength = MARKER_LENGTH; this.input.required = true;
        this.input.setAttribute('autofocus', '');
        cancel.type = 'button'; cancel.textContent = 'Cancel'; cancel.onclick = () => this.dialog.close();
        place.type = 'submit'; place.textContent = 'Place';
        form.onsubmit = event => {
            event.preventDefault();
            const text = this.input.value.trim();
            if (!text || !this.markerPoint) return;
            this.dialog.close();
            this.send({ op: 'add', text, ...this.markerPoint });
        };
        form.append(label, cancel, place); this.dialog.append(form);
        host.append(this.layer, this.dialog);

        const { canvas } = camera, options = { capture: true, signal: this.controller.signal };
        canvas.addEventListener('pointerdown', event => this.press(event), options);
        canvas.addEventListener('pointermove', event => {
            this.mouse = event;
            this.move(event);
        }, options);
        canvas.addEventListener('pointerleave', () => {
            this.mouse = undefined;
        }, options);
        canvas.addEventListener('pointerup', event => this.release(event), options);
        canvas.addEventListener('lostpointercapture', event => {
            if (this.drag?.pointer === event.pointerId) this.drag = undefined;
            if (this.placementPointer === event.pointerId) this.placementPointer = undefined;
        }, options);
        canvas.addEventListener('dblclick', event => {
            if ((event.shiftKey || event.ctrlKey) && this.hit(event)) event.stopImmediatePropagation();
        }, options);
        window.addEventListener('keydown', event => {
            if (event.key === 'Escape') this.arm();
            if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || this.dialog.hasAttribute('open') ||
                (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]')))
                return;
            const tool = ([...PING_KINDS, 'marker'] as const).find(candidate => shortcuts[candidate] === event.key);
            const point = this.mouse && this.point(this.mouse);
            if (!tool || !point) return;
            event.preventDefault();
            if (event.repeat) return;
            this.arm();
            this.cancelOrder();
            if (tool === 'marker') this.openMarker(point);
            else this.send({ op: 'ping', kind: tool, ...point });
        }, options);
    }

    private openMarker(point: AnnotationPoint) {
        this.markerPoint = point;
        this.input.value = '';
        this.dialog.showModal();
    }

    cancel() {
        this.arm();
    }

    private arm(tool?: Tool) {
        this.armed = tool;
        for (const button of this.tools.buttons)
            button.setAttribute('aria-pressed', String(button.dataset.kind === tool));
        this.camera.canvas.classList.toggle('map-annotation-aim', !!tool);
    }

    private point(event: MouseEvent) {
        const point = this.camera.ground(event.clientX, event.clientY);
        const { width, depth } = this.camera.world;
        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.z) ||
            point.x < 0 || point.x > width || point.z < 0 || point.z > depth) return;
        return { x: point.x, z: point.z };
    }

    private hit(event: MouseEvent) {
        const hits = [...this.pins].reverse();
        return hits.find(([, pin]) => {
            if (pin.element.hidden) return false;
            const box = pin.element.getBoundingClientRect();
            return event.clientX >= box.left && event.clientX <= box.right &&
                event.clientY >= box.top && event.clientY <= box.bottom;
        })?.[0];
    }

    private press(event: PointerEvent) {
        if (this.camera.orbit || (event.button !== 0 && event.button !== 2)) return;
        if (!this.armed) {
            if (!event.shiftKey && !event.ctrlKey) return;
            const id = this.hit(event);
            if (id === undefined) return;
            this.drag = { id, pointer: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
        } else if (event.button === 2) this.arm();
        else this.placementPointer = event.pointerId;
        event.preventDefault(); event.stopImmediatePropagation();
        this.camera.canvas.setPointerCapture(event.pointerId);
    }

    private move(event: PointerEvent) {
        const drag = this.drag;
        if (!drag || event.pointerId !== drag.pointer) return;
        if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) >= 4) drag.moved = true;
        if (drag.moved) drag.point = this.point(event);
        event.stopImmediatePropagation();
    }

    private release(event: PointerEvent) {
        const drag = this.drag;
        if (drag?.pointer === event.pointerId) {
            this.move(event);
            this.drag = undefined;
            if (drag.moved && drag.point) this.send({ op: 'move', id: drag.id, ...drag.point });
            else if (!drag.moved && event.button === 2) this.send({ op: 'remove', id: drag.id });
            return;
        }
        if (this.placementPointer !== event.pointerId) return;
        this.placementPointer = undefined;
        event.stopImmediatePropagation();
        const point = this.point(event), armed = this.armed;
        if (!armed || !point) return;
        this.arm();
        if (armed === 'marker') this.openMarker(point);
        else this.send({ op: 'ping', kind: armed, ...point });
    }

    acceptLocal(action: AnnotationAction, author: string, color: number) {
        if (action.op === 'ping') this.accept({ ...action, author });
        else if (action.op !== 'add') this.accept(action);
        else if (this.pins.size < MARKER_LIMIT)
            this.accept({ ...action, id: this.nextLocalPin++, author, color });
    }

    accept(annotation: MapAnnotation) {
        if (annotation.op === 'remove') {
            this.pins.get(annotation.id)?.element.remove(); this.pins.delete(annotation.id);
        } else if (annotation.op === 'move') {
            const pin = this.pins.get(annotation.id);
            if (pin) {
                pin.x = annotation.x; pin.z = annotation.z;
            }
        } else {
            const { x, z } = annotation;
            const element = document.createElement('div');
            element.className = 'map-annotations__item'; element.hidden = true;
            if (annotation.op === 'add') {
                const text = document.createElement('span');
                text.textContent = annotation.text;
                text.className = 'map-annotations__label';
                element.dataset.kind = 'marker';
                element.style.color = PLAYER_COLORS[annotation.color] ?? PLAYER_COLORS[0];
                element.title = `${annotation.author}: ${annotation.text}`;
                element.append(fontIcon(icons.marker), text);
                this.pins.set(annotation.id, { element, x, z });
            } else {
                const ring = pingRing(annotation.kind), arrow = fontIcon('arrow_forward');
                const label = document.createElement('span');
                label.className = 'map-annotations__ping-author';
                label.textContent = annotation.author;
                element.dataset.kind = annotation.kind; element.append(ring, arrow, label);
                this.pings.add({ element, x, z, ring, arrow, label, expires: performance.now() + pingDuration });
                this.onPing?.();
            }
            this.layer.append(element);
        }
    }

    update(now: number) {
        if (!this.pins.size && !this.pings.size) return;
        const bounds = this.layer.getBoundingClientRect();
        const centreX = bounds.width / 2, centreY = bounds.height / 2;
        const inside = (x: number, y: number) => x >= 0 && x <= bounds.width && y >= 0 && y <= bounds.height;
        const position = (element: HTMLElement, x: number, y: number) => {
            element.style.left = `${x}px`; element.style.top = `${y}px`;
        };
        for (const [id, pin] of this.pins) {
            const point = (this.drag?.id === id && this.drag.point) || pin;
            const projected = this.camera.project(point.x, point.z);
            const x = projected.x - bounds.left, y = projected.y - bounds.top;
            pin.element.hidden = !projected.visible || !inside(x, y);
            if (!pin.element.hidden) position(pin.element, x, y);
        }
        for (const ping of this.pings) {
            if (now >= ping.expires) {
                ping.element.remove(); this.pings.delete(ping); continue;
            }
            const projected = this.camera.project(ping.x, ping.z);
            const x = projected.x - bounds.left, y = projected.y - bounds.top;
            const offscreen = !projected.visible || !inside(x, y);
            ping.element.hidden = false;
            ping.ring.classList.toggle('map-annotations__ring--offscreen', offscreen);
            ping.arrow.hidden = !offscreen;
            ping.label.hidden = offscreen;
            const remaining = ping.expires - now;
            ping.element.style.opacity = String(Math.min(1, remaining / 300));
            if (!offscreen) {
                const scale = remaining > 300 ? 1 + 0.12 * Math.sin((pingDuration - remaining) * Math.PI / 300)
                    : remaining / 300;
                ping.ring.style.setProperty('--ping-scale', String(scale));
                position(ping.element, x, y);
                continue;
            }
            const sign = projected.behind ? -1 : 1;
            const dx = (x - centreX) * sign, dy = (y - centreY) * sign;
            const angle = Number.isFinite(dx + dy) && (dx || dy) ? Math.atan2(dy, dx) : Math.PI / 2;
            const alongX = Math.cos(angle), alongY = Math.sin(angle);
            const scale = Math.min(Math.max(0, centreX - 18) / Math.max(Math.abs(alongX), 0.00001),
                Math.max(0, centreY - 18) / Math.max(Math.abs(alongY), 0.00001));
            position(ping.element, centreX + alongX * scale, centreY + alongY * scale);
            ping.arrow.style.transform = `rotate(${angle}rad)`;
        }
    }

    destroy() {
        this.arm(); this.controller.abort();
        this.layer.remove(); this.dialog.remove(); this.tools.toolbar.remove();
    }
}
