import type * as T from 'three';
import {
    beamGlowIntensity, beamMaximumSegmentCount, beamPillarExtensionInVoxels, beamPillarHoldFraction,
    beamMinimumThicknessInVoxels,
    lightningBranchLengthFraction, lightningBranchLifetimeFraction, lightningBranchStride,
    lightningBranchThicknessFraction, lightningJitterFraction, lightningMaximumDurationInSeconds,
    lightningSegmentCount
} from '../config.js';
import { SimulationEvent } from '../types.js';
import { Vector3 } from '../sim/math/vector3.js';
import { Rng } from '../../../shared/ts/seeded-random.js';
import { additiveEffectBlending, transparentEffectsLayer } from './effects-layer.js';
import { EffectProfile } from './particle-emitter.js';

interface BeamSegment {
    start: T.Vector3;
    end: T.Vector3;
    age: number;
    lifetime: number;
    thickness: number;
    colour: number;
    glow: number;
    hold: number;
    birth: number;
    tag: number;
}

function beamGeometry(): T.BufferGeometry {
    const geometry = new THREE.CylinderGeometry(.5, .5, 1, 16, 1, false);
    geometry.rotateX(Math.PI / 2);
    return geometry;
}

export class BeamEffects {
    readonly mesh: T.InstancedMesh;
    private readonly segments: Array<BeamSegment>;
    private count = 0;
    private serial = 0;
    private readonly random: Rng;
    private readonly start = new THREE.Vector3();
    private readonly end = new THREE.Vector3();
    private readonly direction = new THREE.Vector3();
    private readonly right = new THREE.Vector3();
    private readonly upward = new THREE.Vector3();
    private readonly previous = new THREE.Vector3();
    private readonly point = new THREE.Vector3();
    private readonly branch = new THREE.Vector3();
    private readonly forward = new THREE.Vector3(0, 0, 1);
    private readonly transform = new THREE.Object3D();
    private readonly colour = new THREE.Color();
    private disposed = false;

    constructor(seed: number) {
        this.random = new Rng(seed).fork(8004);
        this.segments = Array.from({ length: beamMaximumSegmentCount }, () => ({
            start: new THREE.Vector3(), end: new THREE.Vector3(), age: 0, lifetime: 0,
            thickness: 0, colour: 0, glow: 0, hold: 0, birth: 0, tag: -1
        }));
        const material = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false,
            toneMapped: false, ...additiveEffectBlending() });
        this.mesh = new THREE.InstancedMesh(beamGeometry(), material, beamMaximumSegmentCount);
        this.mesh.layers.set(transparentEffectsLayer);
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(beamMaximumSegmentCount * 3), 3);
        this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
        this.mesh.frustumCulled = false;
        this.mesh.count = 0;
    }

    play(event: SimulationEvent, profile: EffectProfile): void {
        const isLine = event.type === 'beam' || event.type === 'line';
        if (this.disposed || !isLine || !event.endpoint || profile.durationSeconds <= 0) return;
        this.start.set(event.position.x, event.position.y, event.position.z);
        this.end.set(event.endpoint.x, event.endpoint.y, event.endpoint.z);
        this.direction.subVectors(this.end, this.start);
        if (profile.kind === 'pillar' && this.direction.lengthSq() > 0)
            this.start.addScaledVector(this.direction.normalize(), -beamPillarExtensionInVoxels);
        this.direction.subVectors(this.end, this.start);
        const length = this.direction.length();
        if (!length) return;
        const colour = parseInt(profile.colour.slice(1), 16);
        const glow = Math.max(beamGlowIntensity, profile.glowIntensity);
        const thickness = Math.max(beamMinimumThicknessInVoxels, (event.radiusInVoxels ?? 0) * 2);
        if (profile.kind !== 'lightning') {
            this.add(this.start, this.end, thickness, profile.durationSeconds, colour, glow,
                profile.kind === 'pillar' ? beamPillarHoldFraction : 0, event.type === 'line' ? event.serial : -1);
            return;
        }
        const lifetime = Math.min(profile.durationSeconds, lightningMaximumDurationInSeconds);
        this.direction.multiplyScalar(1 / length);
        this.upward.set(0, 1, 0);
        if (Math.abs(this.direction.y) > .9) this.upward.set(1, 0, 0);
        this.right.crossVectors(this.direction, this.upward).normalize();
        this.upward.crossVectors(this.right, this.direction);
        this.previous.copy(this.start);
        for (let index = 1; index <= lightningSegmentCount; index++) {
            const fraction = index / lightningSegmentCount;
            this.point.lerpVectors(this.start, this.end, fraction);
            if (index < lightningSegmentCount) {
                const jitter = length * lightningJitterFraction * Math.sin(Math.PI * fraction);
                this.point.addScaledVector(this.right, (this.random.float() * 2 - 1) * jitter)
                    .addScaledVector(this.upward, (this.random.float() * 2 - 1) * jitter);
            }
            this.add(this.previous, this.point, thickness, lifetime, colour, glow);
            if (index < lightningSegmentCount && index % lightningBranchStride === 0) {
                const branchLength = length * lightningBranchLengthFraction;
                this.branch.copy(this.point).addScaledVector(this.direction, branchLength)
                    .addScaledVector(this.right, (this.random.float() * 2 - 1) * branchLength)
                    .addScaledVector(this.upward, (this.random.float() * 2 - 1) * branchLength);
                this.add(this.point, this.branch, thickness * lightningBranchThicknessFraction,
                    lifetime * lightningBranchLifetimeFraction, colour, glow);
            }
            this.previous.copy(this.point);
        }
    }

    /** Adds a glowing line that fades out over its lifetime. */
    addStreak(start: Vector3, end: Vector3, thickness: number, lifetime: number, colour: number, glow: number): void {
        if (this.disposed) return;
        this.start.set(start.x, start.y, start.z);
        this.end.set(end.x, end.y, end.z);
        if (this.start.distanceToSquared(this.end) === 0) return;
        this.add(this.start, this.end, thickness, lifetime, colour, glow);
    }

    /** Removes the lines that were drawn for the given event serial. */
    clearTagged(tag: number): void {
        for (let index = this.count - 1; index >= 0; index--)
            if (this.segments[index].tag === tag) {
                const segment = this.segments[index];
                this.segments[index] = this.segments[--this.count];
                this.segments[this.count] = segment;
            }
    }

    update(deltaSeconds: number): void {
        if (this.disposed) return;
        if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new Error('Invalid beam time step');
        let index = 0;
        while (index < this.count) {
            const segment = this.segments[index];
            segment.age += deltaSeconds;
            if (segment.age >= segment.lifetime) {
                this.segments[index] = this.segments[--this.count];
                this.segments[this.count] = segment;
            } else index++;
        }
        for (let slot = 0; slot < this.count; slot++) {
            const segment = this.segments[slot];
            this.direction.subVectors(segment.end, segment.start);
            const length = this.direction.length();
            this.direction.multiplyScalar(1 / length);
            this.transform.position.copy(segment.start).add(segment.end).multiplyScalar(.5);
            this.transform.quaternion.setFromUnitVectors(this.forward, this.direction);
            this.transform.scale.set(segment.thickness, segment.thickness, length);
            this.transform.updateMatrix();
            this.mesh.setMatrixAt(slot, this.transform.matrix);
            this.colour.setHex(segment.colour).convertSRGBToLinear()
                .multiplyScalar(segment.glow * (segment.age < segment.hold * segment.lifetime ? 1
                    : (1 - segment.age / segment.lifetime) / (1 - segment.hold)));
            this.mesh.setColorAt(slot, this.colour);
        }
        this.mesh.count = this.count;
        if (this.count) {
            this.mesh.instanceMatrix.updateRange.count = this.count * 16;
            this.mesh.instanceMatrix.needsUpdate = true;
            if (this.mesh.instanceColor) {
                this.mesh.instanceColor.updateRange.count = this.count * 3;
                this.mesh.instanceColor.needsUpdate = true;
            }
        }
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.count = this.mesh.count = 0;
        this.mesh.parent?.remove(this.mesh);
        this.mesh.dispose();
        this.mesh.geometry.dispose();
        (this.mesh.material as T.MeshBasicMaterial).dispose();
    }

    private add(start: T.Vector3, end: T.Vector3, thickness: number, lifetime: number,
        colour: number, glow: number, hold = 0, tag = -1): void {
        let index = this.count;
        if (index < this.segments.length) this.count++;
        else {
            index = 0;
            for (let slot = 1; slot < this.count; slot++)
                if (this.segments[slot].birth < this.segments[index].birth) index = slot;
        }
        const segment = this.segments[index];
        segment.start.copy(start); segment.end.copy(end);
        segment.age = 0; segment.lifetime = lifetime;
        segment.thickness = thickness; segment.colour = colour; segment.glow = glow;
        segment.hold = hold;
        segment.birth = this.serial++;
        segment.tag = tag;
    }
}
