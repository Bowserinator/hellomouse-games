import { particleGravityInVoxelsPerSecondSquared, particleBounceRestitution,
    particleBounceFriction } from '../config.js';
import { Vector3 } from '../sim/math/vector3.js';
import { VoxelWorld } from '../sim/world/voxel-world.js';

export interface ParticleSpawn {
    position: Vector3;
    velocity: Vector3;
    lifetime: number;
    startSize: number;
    endSize: number;
    startColour: number;
    endColour: number;
    drag: number;
    gravityScale: number;
    spin: number;
    glow: number;
}

export class ParticlePool {
    readonly positions: Float32Array;
    readonly velocities: Float32Array;
    readonly ages: Float32Array;
    readonly lifetimes: Float32Array;
    readonly startSizes: Float32Array;
    readonly endSizes: Float32Array;
    readonly startColours: Float32Array;
    readonly endColours: Float32Array;
    readonly drags: Float32Array;
    readonly gravityScales: Float32Array;
    readonly spins: Float32Array;
    readonly glows: Float32Array;
    private readonly birthSerials: Uint32Array;
    private readonly freeSlots: Uint32Array;
    private readonly scalarArrays: ReadonlyArray<Float32Array>;
    private nextSerial = 0;
    private freeCount: number;
    private count = 0;

    constructor(readonly capacity: number) {
        if (!Number.isSafeInteger(capacity) || capacity < 1)
            throw new RangeError('Invalid particle capacity');
        this.positions = new Float32Array(capacity * 3);
        this.velocities = new Float32Array(capacity * 3);
        this.ages = new Float32Array(capacity);
        this.lifetimes = new Float32Array(capacity);
        this.startSizes = new Float32Array(capacity);
        this.endSizes = new Float32Array(capacity);
        this.startColours = new Float32Array(capacity);
        this.endColours = new Float32Array(capacity);
        this.drags = new Float32Array(capacity);
        this.gravityScales = new Float32Array(capacity);
        this.spins = new Float32Array(capacity);
        this.glows = new Float32Array(capacity);
        this.birthSerials = new Uint32Array(capacity);
        this.freeSlots = new Uint32Array(capacity);
        for (let index = 0; index < capacity; index++) this.freeSlots[index] = capacity - index - 1;
        this.freeCount = capacity;
        this.scalarArrays = [this.ages, this.lifetimes, this.startSizes, this.endSizes, this.startColours,
            this.endColours, this.drags, this.gravityScales, this.spins, this.glows];
    }

    get liveCount(): number {
        return this.count;
    }

    spawn(particle: ParticleSpawn): number {
        if (!Number.isFinite(particle.lifetime) || particle.lifetime <= 0)
            throw new RangeError('Invalid particle lifetime');
        let index: number;
        if (this.freeCount > 0) {
            index = this.freeSlots[--this.freeCount];
            this.count++;
        } else {
            index = 0;
            let oldest = (this.nextSerial - this.birthSerials[0]) >>> 0;
            for (let candidate = 1; candidate < this.capacity; candidate++) {
                const age = (this.nextSerial - this.birthSerials[candidate]) >>> 0;
                if (age > oldest) {
                    index = candidate; oldest = age;
                }
            }
        }
        const offset = index * 3;
        this.positions[offset] = particle.position.x;
        this.positions[offset + 1] = particle.position.y;
        this.positions[offset + 2] = particle.position.z;
        this.velocities[offset] = particle.velocity.x;
        this.velocities[offset + 1] = particle.velocity.y;
        this.velocities[offset + 2] = particle.velocity.z;
        this.ages[index] = 0;
        this.lifetimes[index] = particle.lifetime;
        this.startSizes[index] = particle.startSize;
        this.endSizes[index] = particle.endSize;
        this.startColours[index] = particle.startColour;
        this.endColours[index] = particle.endColour;
        this.drags[index] = particle.drag;
        this.gravityScales[index] = particle.gravityScale;
        this.spins[index] = particle.spin;
        this.glows[index] = particle.glow;
        this.birthSerials[index] = this.nextSerial;
        this.nextSerial = (this.nextSerial + 1) >>> 0;
        return index;
    }

    step(deltaSeconds: number, collisionWorld?: Pick<VoxelWorld, 'isSolid'>): void {
        if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0)
            throw new RangeError('Invalid particle time step');
        let index = 0;
        while (index < this.count) {
            this.ages[index] += deltaSeconds;
            if (this.ages[index] >= this.lifetimes[index]) {
                this.remove(index);
                continue;
            }
            const offset = index * 3;
            const oldX = this.positions[offset], oldY = this.positions[offset + 1], oldZ = this.positions[offset + 2];
            const damping = Math.exp(-this.drags[index] * deltaSeconds);
            this.velocities[offset] *= damping;
            this.velocities[offset + 1] = (this.velocities[offset + 1] -
                particleGravityInVoxelsPerSecondSquared * this.gravityScales[index] * deltaSeconds) * damping;
            this.velocities[offset + 2] *= damping;
            this.positions[offset] += this.velocities[offset] * deltaSeconds;
            this.positions[offset + 1] += this.velocities[offset + 1] * deltaSeconds;
            this.positions[offset + 2] += this.velocities[offset + 2] * deltaSeconds;
            if (collisionWorld?.isSolid(Math.floor(this.positions[offset]), Math.floor(this.positions[offset + 1]),
                Math.floor(this.positions[offset + 2]))) {
                this.positions[offset] = oldX;
                this.positions[offset + 1] = oldY;
                this.positions[offset + 2] = oldZ;
                this.velocities[offset] *= particleBounceFriction;
                this.velocities[offset + 1] = Math.abs(this.velocities[offset + 1]) * particleBounceRestitution;
                this.velocities[offset + 2] *= particleBounceFriction;
            }
            index++;
        }
    }

    clear(): void {
        this.count = 0;
        this.freeCount = this.capacity;
        for (let index = 0; index < this.capacity; index++) this.freeSlots[index] = this.capacity - index - 1;
    }

    private remove(index: number): void {
        const last = --this.count;
        if (index !== last) {
            for (let field = 0; field < this.scalarArrays.length; field++)
                this.scalarArrays[field][index] = this.scalarArrays[field][last];
            for (let axis = 0; axis < 3; axis++) {
                this.positions[index * 3 + axis] = this.positions[last * 3 + axis];
                this.velocities[index * 3 + axis] = this.velocities[last * 3 + axis];
            }
            this.birthSerials[index] = this.birthSerials[last];
        }
        this.freeSlots[this.freeCount++] = last;
    }
}
