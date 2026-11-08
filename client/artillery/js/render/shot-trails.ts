import type * as T from 'three';
import { shotTrailGlowIntensity, shotTrailLifetimeInSeconds, shotTrailMaximumSegmentCount } from '../config.js';
import { Projectile } from '../sim/projectile.js';
import { Vector3 } from '../sim/math/vector3.js';
import { additiveEffectBlending, transparentEffectsLayer } from './effects-layer.js';

/** Thin fading lines tracing the flight path of every shot a player fired. */
export class ShotTrails {
    readonly mesh: T.LineSegments;
    private readonly positions = new Float32Array(shotTrailMaximumSegmentCount * 6);
    private readonly colours = new Float32Array(shotTrailMaximumSegmentCount * 6);
    private readonly baseColours = new Float32Array(shotTrailMaximumSegmentCount * 3);
    private readonly births = new Float64Array(shotTrailMaximumSegmentCount);
    private readonly positionAttribute: T.BufferAttribute;
    private readonly colourAttribute: T.BufferAttribute;
    private readonly lastPositions = new Map<number, Vector3>();
    private readonly colour = new THREE.Color();
    private tail = 0;
    private count = 0;
    private elapsedSeconds = 0;
    private disposed = false;

    constructor(private readonly seatColours: ReadonlyMap<number, number>) {
        const geometry = new THREE.BufferGeometry();
        this.positionAttribute = new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage);
        this.colourAttribute = new THREE.BufferAttribute(this.colours, 3).setUsage(THREE.DynamicDrawUsage);
        geometry.setAttribute('position', this.positionAttribute);
        geometry.setAttribute('color', this.colourAttribute);
        geometry.setDrawRange(0, 0);
        const material = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false,
            toneMapped: false, ...additiveEffectBlending() });
        this.mesh = new THREE.LineSegments(geometry, material);
        this.mesh.layers.set(transparentEffectsLayer);
        this.mesh.frustumCulled = false;
    }

    /** Extends the trail of every live shot to where it is now. */
    record(projectiles: ReadonlyArray<Projectile>): void {
        if (this.disposed) return;
        for (const projectile of projectiles) {
            if (!projectile.isPrimary || !projectile.isAlive) continue;
            const position = projectile.position, last = this.lastPositions.get(projectile.serial);
            if (last) this.addSegment(last, position, projectile.ownerSeatIndex);
            this.lastPositions.set(projectile.serial, { x: position.x, y: position.y, z: position.z });
        }
    }

    /** Completes the trail of a shot that has just ended at the given position. */
    end(serial: number, position: Vector3, seatIndex: number): void {
        if (this.disposed) return;
        const last = this.lastPositions.get(serial);
        if (!last) return;
        this.addSegment(last, position, seatIndex);
        this.lastPositions.delete(serial);
    }

    update(deltaSeconds: number): void {
        if (this.disposed) return;
        this.elapsedSeconds += deltaSeconds;
        while (this.count > 0 && this.elapsedSeconds - this.births[this.tail] >= shotTrailLifetimeInSeconds) {
            this.colours.fill(0, this.tail * 6, this.tail * 6 + 6);
            this.tail = (this.tail + 1) % shotTrailMaximumSegmentCount;
            this.count--;
        }
        for (let offset = 0; offset < this.count; offset++) {
            const slot = (this.tail + offset) % shotTrailMaximumSegmentCount;
            const fade = 1 - (this.elapsedSeconds - this.births[slot]) / shotTrailLifetimeInSeconds;
            for (let vertex = 0; vertex < 2; vertex++) for (let channel = 0; channel < 3; channel++)
                this.colours[slot * 6 + vertex * 3 + channel] = this.baseColours[slot * 3 + channel] * fade;
        }
        this.colourAttribute.needsUpdate = true;
        this.mesh.geometry.setDrawRange(0, this.count > 0 ? shotTrailMaximumSegmentCount * 2 : 0);
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.lastPositions.clear();
        this.mesh.parent?.remove(this.mesh);
        this.mesh.geometry.dispose();
        (this.mesh.material as T.LineBasicMaterial).dispose();
    }

    private addSegment(start: Vector3, end: Vector3, seatIndex: number): void {
        if (start.x === end.x && start.y === end.y && start.z === end.z) return;
        if (this.count === shotTrailMaximumSegmentCount) {
            this.tail = (this.tail + 1) % shotTrailMaximumSegmentCount;
            this.count--;
        }
        const slot = (this.tail + this.count++) % shotTrailMaximumSegmentCount;
        this.positions.set([start.x, start.y, start.z, end.x, end.y, end.z], slot * 6);
        this.colour.setHex(this.seatColours.get(seatIndex) ?? 0xffffff).convertSRGBToLinear()
            .multiplyScalar(shotTrailGlowIntensity);
        this.baseColours.set([this.colour.r, this.colour.g, this.colour.b], slot * 3);
        this.births[slot] = this.elapsedSeconds;
        this.positionAttribute.needsUpdate = true;
    }
}
