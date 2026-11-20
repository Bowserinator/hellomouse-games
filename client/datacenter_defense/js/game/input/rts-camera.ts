import type * as T from 'three';
import type { World } from '../../mapx.js';
import { elevation } from '../../editor/world.js';

export class RtsCamera {
    readonly target = new THREE.Vector3();
    distance: number;
    strategic = false;
    fade = 0;
    zombieFade = 0;
    private zombieStrategic = false;
    panEnabled = true;
    orbit = false;
    private orbitDrag?: { x: number; y: number };
    private azimuth = 0;
    private orbitPitch = 85;
    private returning?: { start: number; azimuth: number; pitch: number };
    private desired: number;
    private maximum: number;
    private keys = new Set<string>();
    private pointer?: { x: number; y: number };
    private grab?: T.Vector3;
    private anchor?: { x: number; y: number; point: T.Vector3 };
    private last = 0;
    private controller = new AbortController();
    constructor(readonly camera: T.PerspectiveCamera, readonly canvas: HTMLCanvasElement, readonly world: World) {
        this.maximum = Math.max(60, Math.max(world.width, world.depth) * 1.8);
        this.distance = this.desired = Math.min(this.maximum, 100);
        this.target.set(world.width / 2, 0, world.depth / 2);
        const options = { signal: this.controller.signal };
        canvas.addEventListener('wheel', event => {
            event.preventDefault();
            const point = this.ground(event.clientX, event.clientY);
            if (point) this.anchor = { x: event.clientX, y: event.clientY, point };
            this.desired = Math.max(12, Math.min(this.maximum, this.desired * Math.exp(event.deltaY * 0.0015)));
        }, { ...options, passive: false });
        canvas.addEventListener('contextmenu', event => event.preventDefault(), options);
        canvas.addEventListener('pointerdown', event => {
            if (this.orbit && event.button === 0)
                this.orbitDrag = { x: event.clientX, y: event.clientY };
            else if (event.button === 1)
                this.grab = this.ground(event.clientX, event.clientY);
            else return;
            event.preventDefault(); canvas.setPointerCapture(event.pointerId); this.anchor = undefined;
        }, options);
        canvas.addEventListener('pointermove', event => {
            const bounds = canvas.getBoundingClientRect();
            this.pointer = { x: (event.clientX - bounds.left) / bounds.width,
                y: (event.clientY - bounds.top) / bounds.height };
            if (this.orbitDrag) {
                this.azimuth -= (event.clientX - this.orbitDrag.x) * 0.008;
                this.orbitPitch = Math.max(10, Math.min(89,
                    this.orbitPitch + (event.clientY - this.orbitDrag.y) * 0.3));
                this.orbitDrag = { x: event.clientX, y: event.clientY }; this.apply();
            }
            if (this.grab) {
                const point = this.ground(event.clientX, event.clientY);
                if (point) {
                    this.target.add(this.grab.clone().sub(point)); this.apply();
                }
            }
        }, options);
        const release = () => {
            this.grab = undefined; this.orbitDrag = undefined;
        };
        const returnToRts = () => {
            if (!this.orbit) return;
            this.orbit = false;
            this.azimuth = Math.atan2(Math.sin(this.azimuth), Math.cos(this.azimuth));
            this.returning = { start: performance.now(), azimuth: this.azimuth, pitch: this.orbitPitch };
            release();
        };
        canvas.addEventListener('pointerup', release, options);
        canvas.addEventListener('pointercancel', release, options);
        canvas.addEventListener('pointerleave', () => {
            this.pointer = undefined;
        }, options);
        window.addEventListener('keydown', event => {
            if (event.target instanceof HTMLElement &&
                (event.target.matches('input, select, textarea') || event.target.isContentEditable)) return;
            const key = event.key.toLowerCase();
            if (key === ' ') {
                this.orbit = true; this.returning = undefined; this.grab = undefined; event.preventDefault();
            }
            if (['w', 'a', 's', 'd', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(key)) {
                this.keys.add(key); event.preventDefault();
            }
        }, options);
        window.addEventListener('keyup', event => {
            this.keys.delete(event.key.toLowerCase());
            if (event.key === ' ') returnToRts();
        }, options);
        window.addEventListener('blur', () => {
            this.keys.clear(); this.pointer = undefined; returnToRts(); release();
        }, options);
        this.apply();
    }
    ground(x: number, y: number): T.Vector3 | undefined {
        const bounds = this.canvas.getBoundingClientRect();
        if (!bounds.width || !bounds.height) return;
        const ray = new THREE.Raycaster();
        ray.setFromCamera(new THREE.Vector2((x - bounds.left) / bounds.width * 2 - 1,
            1 - (y - bounds.top) / bounds.height * 2), this.camera);
        let height = this.target.y;
        const point = new THREE.Vector3();
        for (let i = 0; i < 4; i++) {
            if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -height), point)) return;
            height = elevation(this.world, { x: point.x, z: point.z });
        }
        point.y = height;
        return point;
    }
    project(x: number, z: number, height = 0) {
        const bounds = this.canvas.getBoundingClientRect();
        const point = new THREE.Vector3(x, elevation(this.world, { x, z }) + height, z).project(this.camera);
        return { x: bounds.left + (point.x + 1) * bounds.width / 2,
            y: bounds.top + (1 - point.y) * bounds.height / 2, visible: point.z >= -1 && point.z <= 1 };
    }
    update(now: number) {
        const elapsed = this.last ? Math.min(0.05, (now - this.last) / 1000) : 0;
        this.last = now;
        let x = Number(this.keys.has('d') || this.keys.has('arrowright')) -
            Number(this.keys.has('a') || this.keys.has('arrowleft'));
        let z = Number(this.keys.has('s') || this.keys.has('arrowdown')) -
            Number(this.keys.has('w') || this.keys.has('arrowup'));
        if (this.pointer && !this.grab && !this.orbit) {
            x += Number(this.pointer.x > 0.985) - Number(this.pointer.x < 0.015);
            z += Number(this.pointer.y > 0.985) - Number(this.pointer.y < 0.015);
        }
        if (x || z) {
            this.anchor = undefined;
            const scale = this.distance * elapsed * 0.8 / Math.max(1, Math.hypot(x, z));
            this.target.x += x * scale; this.target.z += z * scale;
        }
        this.distance += (this.desired - this.distance) * (1 - Math.exp(-elapsed * 12));
        if (this.returning) {
            const fraction = Math.max(0, Math.min(1, (now - this.returning.start) / 300));
            const eased = fraction * fraction * (3 - 2 * fraction);
            this.azimuth = this.returning.azimuth * (1 - eased);
            this.orbitPitch = this.returning.pitch + (85 - this.returning.pitch) * eased;
            if (fraction === 1) this.returning = undefined;
        }
        this.apply();
        if (this.anchor) {
            const point = this.ground(this.anchor.x, this.anchor.y);
            if (point) {
                this.target.add(this.anchor.point.clone().sub(point)); this.apply();
            }
            if (Math.abs(this.desired - this.distance) < 0.05) this.anchor = undefined;
        }
        const threshold = Math.max(65, Math.max(this.world.width, this.world.depth) * 0.4);
        if (this.distance > threshold * 1.1) this.strategic = true;
        if (this.distance < threshold * 0.9) this.strategic = false;
        this.fade += (Number(this.strategic) - this.fade) * Math.min(1, elapsed * 8);
        if (this.distance > threshold * 1.5 * 1.1) this.zombieStrategic = true;
        if (this.distance < threshold * 1.5 * 0.9) this.zombieStrategic = false;
        this.zombieFade += (Number(this.zombieStrategic) - this.zombieFade) * Math.min(1, elapsed * 8);
    }
    private apply() {
        this.target.x = Math.max(0, Math.min(this.world.width, this.target.x));
        this.target.z = Math.max(0, Math.min(this.world.depth, this.target.z));
        this.target.y = elevation(this.world, { x: this.target.x, z: this.target.z });
        const pitch = this.orbitPitch * Math.PI / 180;
        this.camera.position.set(this.target.x + Math.sin(this.azimuth) * Math.cos(pitch) * this.distance,
            this.target.y + Math.sin(pitch) * this.distance,
            this.target.z + Math.cos(this.azimuth) * Math.cos(pitch) * this.distance);
        this.camera.lookAt(this.target); this.camera.updateMatrixWorld(true);
    }
    destroy() {
        this.controller.abort(); this.keys.clear();
    }
}
