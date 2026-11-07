import * as T from 'three';
import { particlePoolCapacities, particleMaximumScheduledEmitters, renderingQualityPresets } from '../config.js';
import { Rng } from '../../../shared/ts/seeded-random.js';
import { RemovedVoxelSample } from '../types.js';
import { Vector3 } from '../sim/math/vector3.js';
import { materialTable } from '../sim/world/material-table.js';
import { VoxelWorld } from '../sim/world/voxel-world.js';
import { ParticleEmitterSpec, EffectProfile } from './particle-emitter.js';
import { ParticlePool, ParticleSpawn } from './particle-pool.js';
import { ParticleRenderer, ParticleKind, particleKinds } from './particle-renderer.js';
import { RenderingQuality } from './scene-lighting.js';

interface ScheduledEmitter {
    spec: ParticleEmitterSpec | null;
    time: number;
    origin: Vector3;
    direction: Vector3;
    samples: ReadonlyArray<RemovedVoxelSample> | undefined;
}

export class ParticleEffects {
    readonly group = new THREE.Group();
    readonly pools = new Map<ParticleKind, ParticlePool>();
    readonly renderers: ReadonlyArray<ParticleRenderer>;
    readonly qualityMultiplier: number;
    private readonly random: Rng;
    private readonly scheduled: Array<ScheduledEmitter>;
    private readonly particle: ParticleSpawn = {
        position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 },
        lifetime: 1, startSize: 1, endSize: 0, startColour: 0xffffff, endColour: 0,
        drag: 0, gravityScale: 1, spin: 0, glow: 0
    };
    private elapsedSeconds = 0;

    constructor(seed: number, quality: RenderingQuality = 'high') {
        this.random = new Rng(seed);
        this.qualityMultiplier = renderingQualityPresets[quality].particleMultiplier;
        this.renderers = particleKinds.map(kind => {
            const pool = new ParticlePool(Math.ceil(particlePoolCapacities[kind] * this.qualityMultiplier));
            this.pools.set(kind, pool);
            const renderer = new ParticleRenderer(pool, kind);
            this.group.add(renderer.mesh);
            return renderer;
        });
        this.scheduled = Array.from({ length: particleMaximumScheduledEmitters }, () => ({
            spec: null, time: 0, origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 1, z: 0 }, samples: undefined
        }));
    }

    emitBurst(spec: ParticleEmitterSpec, origin: Vector3, direction: Vector3, random: Rng,
        qualityMultiplier = this.qualityMultiplier, samples?: ReadonlyArray<RemovedVoxelSample>): void {
        const pool = this.pools.get(spec.pool);
        if (!pool || !Number.isFinite(qualityMultiplier) || qualityMultiplier < 0 || qualityMultiplier > 1)
            throw new RangeError('Invalid particle emission');
        const count = Math.round(spec.count * qualityMultiplier);
        const length = Math.hypot(direction.x, direction.y, direction.z);
        const directionX = length > 0 ? direction.x / length : 0;
        const directionY = length > 0 ? direction.y / length : 1;
        const directionZ = length > 0 ? direction.z / length : 0;
        const rightLength = Math.hypot(directionX, directionZ);
        const rightX = rightLength > 0 ? directionZ / rightLength : 1;
        const rightZ = rightLength > 0 ? -directionX / rightLength : 0;
        const upX = directionY * rightZ;
        const upY = directionZ * rightX - directionX * rightZ;
        const upZ = -directionY * rightX;
        const coneCosine = Math.cos((spec.coneAngleInDegrees ?? 0) * Math.PI / 180);
        const startColour = Number.parseInt(spec.colours[0].slice(1), 16);
        const endColour = Number.parseInt(spec.colours[1].slice(1), 16);
        const particle = this.particle;
        particle.startSize = spec.size[0];
        particle.endSize = spec.size[1];
        particle.drag = spec.drag;
        particle.gravityScale = spec.gravityScale;
        particle.glow = spec.glow;
        for (let index = 0; index < count; index++) {
            const angle = random.range(0, Math.PI * 2);
            const cosine = spec.shape === 'shell' ? random.range(-1, 1)
                : spec.shape === 'ring' ? 0 : random.range(coneCosine, 1);
            const sine = Math.sqrt(Math.max(0, 1 - cosine * cosine));
            const across = Math.cos(angle) * sine, vertical = Math.sin(angle) * sine;
            const outwardX = rightX * across + upX * vertical + directionX * cosine;
            const outwardY = upY * vertical + directionY * cosine;
            const outwardZ = rightZ * across + upZ * vertical + directionZ * cosine;
            const speed = random.range(spec.speed[0], spec.speed[1]);
            const radius = spec.radius ? random.range(spec.radius[0], spec.radius[1]) : 0;
            const radialSpeed = spec.shape === 'ring' && spec.radialSpeed
                ? random.range(spec.radialSpeed[0], spec.radialSpeed[1]) : 0;
            particle.position.x = origin.x + (spec.offset?.[0] ?? 0) + outwardX * radius;
            particle.position.y = origin.y + (spec.offset?.[1] ?? 0) + outwardY * radius;
            particle.position.z = origin.z + (spec.offset?.[2] ?? 0) + outwardZ * radius;
            particle.velocity.x = (spec.shape === 'ring' ? directionX : outwardX) * speed + outwardX * radialSpeed;
            particle.velocity.y = (spec.shape === 'ring' ? directionY : outwardY) * speed + outwardY * radialSpeed;
            particle.velocity.z = (spec.shape === 'ring' ? directionZ : outwardZ) * speed + outwardZ * radialSpeed;
            particle.lifetime = random.range(spec.lifetime[0], spec.lifetime[1]);
            particle.spin = random.range(spec.spin[0], spec.spin[1]);
            particle.startColour = startColour;
            particle.endColour = endColour;
            if (spec.pool === 'debris' && samples && samples.length > 0) {
                const sample = samples[random.int(0, samples.length - 1)];
                particle.position.x = sample.position.x;
                particle.position.y = sample.position.y;
                particle.position.z = sample.position.z;
                particle.startColour = materialTable[sample.materialIdentifier]?.baseColour ?? startColour;
                particle.endColour = particle.startColour;
            }
            pool.spawn(particle);
        }
    }

    play(profile: EffectProfile, origin: Vector3, direction: Vector3,
        samples?: ReadonlyArray<RemovedVoxelSample>): void {
        for (let index = 0; index < profile.emitters.length; index++) {
            const spec = profile.emitters[index];
            if (!spec.delaySeconds) {
                this.emitBurst(spec, origin, direction, this.random, this.qualityMultiplier, samples);
                continue;
            }
            let slot: ScheduledEmitter | undefined;
            for (let candidate = 0; candidate < this.scheduled.length; candidate++)
                if (this.scheduled[candidate].spec === null) {
                    slot = this.scheduled[candidate];
                    break;
                }
            if (!slot) {
                slot = this.scheduled[0];
                for (let candidate = 1; candidate < this.scheduled.length; candidate++)
                    if (this.scheduled[candidate].time < slot.time) slot = this.scheduled[candidate];
            }
            slot.spec = spec;
            slot.time = this.elapsedSeconds + spec.delaySeconds;
            slot.origin.x = origin.x;
            slot.origin.y = origin.y;
            slot.origin.z = origin.z;
            slot.direction.x = direction.x;
            slot.direction.y = direction.y;
            slot.direction.z = direction.z;
            slot.samples = samples;
        }
    }

    update(deltaSeconds: number, world?: Pick<VoxelWorld, 'isSolid'>): void {
        if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new RangeError('Invalid particle timestep');
        const endTime = this.elapsedSeconds + deltaSeconds;
        while (true) {
            let next: ScheduledEmitter | undefined;
            for (let index = 0; index < this.scheduled.length; index++) {
                const slot = this.scheduled[index];
                if (slot.spec && slot.time <= endTime && (!next || slot.time < next.time)) next = slot;
            }
            if (!next || !next.spec) break;
            const interval = Math.max(0, next.time - this.elapsedSeconds);
            for (let index = 0; index < this.renderers.length; index++) {
                const renderer = this.renderers[index];
                renderer.pool.step(interval, renderer.kind === 'debris' ? world : undefined);
            }
            this.elapsedSeconds = Math.max(this.elapsedSeconds, next.time);
            this.emitBurst(next.spec, next.origin, next.direction, this.random,
                this.qualityMultiplier, next.samples);
            next.spec = null;
            next.samples = undefined;
        }
        for (let index = 0; index < this.renderers.length; index++) {
            const renderer = this.renderers[index];
            renderer.pool.step(endTime - this.elapsedSeconds, renderer.kind === 'debris' ? world : undefined);
            renderer.update();
        }
        this.elapsedSeconds = endTime;
    }

    /** Pushes a single particle through every pool so first real use does not stall on cold code and buffers. */
    warmUp(): void {
        const warmSpec: ParticleEmitterSpec = { pool: 'debris', count: 1, shape: 'shell', speed: [1, 1],
            lifetime: [.1, .1], size: [1, 1], colours: ['#ffffff', '#000000'], drag: 0, gravityScale: 0,
            spin: [0, 0], glow: 0 };
        const origin = { x: 0, y: 0, z: 0 }, direction = { x: 0, y: 1, z: 0 };
        for (const kind of particleKinds)
            this.emitBurst({ ...warmSpec, pool: kind }, origin, direction, new Rng(0), 1);
        this.update(0);
        for (const renderer of this.renderers) renderer.pool.clear();
        this.update(0);
    }

    setSunDirection(direction: Vector3): void {
        for (let index = 0; index < this.renderers.length; index++) {
            const value = this.renderers[index].material.uniforms.uSunDirection.value as T.Vector3;
            value.set(direction.x, direction.y, direction.z).normalize();
        }
    }

    setLightLevel(level: number): void {
        for (let index = 0; index < this.renderers.length; index++)
            this.renderers[index].material.uniforms.uLightLevel.value = level;
    }

    dispose(): void {
        for (let index = 0; index < this.renderers.length; index++) {
            this.renderers[index].pool.clear();
            this.renderers[index].dispose();
        }
        for (let index = 0; index < this.scheduled.length; index++) {
            this.scheduled[index].spec = null;
            this.scheduled[index].samples = undefined;
        }
        this.group.parent?.remove(this.group);
    }
}
