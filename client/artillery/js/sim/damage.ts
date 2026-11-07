import { explosionDefaultKnockbackImpulse, explosionDefaultUpwardBias } from '../config.js';
import { StateHash } from './math/hash.js';
import { Vector3, createVector3, normalizeVector } from './math/vector3.js';
import { CollisionModel, ModelPose, distanceToModel } from './model-collision.js';
import { Tank } from './tank.js';

export interface DamageProfile {
    directHitDamage?: number;
    splashDamage?: number;
    splashRadiusInVoxels?: number;
    falloff?: 'constant' | 'linear' | 'quadratic';
    knockbackImpulse?: number;
    knockbackUpwardBias?: number;
    damageOverTime?: { amountPerSecond: number; durationSeconds: number; stacking: 'perSource' };
}

export interface DamageTarget {
    tank: Tank;
    hullModel: CollisionModel;
    additionalModels?: ReadonlyArray<{ model: CollisionModel; pose: ModelPose }>;
}

interface PendingDamage {
    target: Tank;
    source: Tank | null;
    amount: number;
    impulse: Vector3;
}

export class DamageQueue {
    public isFriendlyFireEnabled = true;
    private readonly pending: Array<PendingDamage> = [];

    enqueue(target: Tank, amount: number, source: Tank | null, impulse = createVector3()): void {
        if (!Number.isFinite(amount) || amount < 0 || !Number.isFinite(impulse.x) ||
            !Number.isFinite(impulse.y) || !Number.isFinite(impulse.z)) throw new RangeError('Invalid pending damage');
        this.pending.push({ target, source, amount, impulse: { ...impulse } });
    }

    enqueueExplosion(center: Vector3, profile: DamageProfile, targets: ReadonlyArray<DamageTarget>,
        source: Tank | null, directHitSeatIndex: number | null = null): void {
        const orderedTargets = targets.slice().sort((left, right) => left.tank.seatIndex - right.tank.seatIndex);
        for (const { tank, hullModel } of orderedTargets) {
            const distance = distanceToModel(hullModel, { position: tank.position, yawInRadians: tank.hullYawInRadians,
                pitchInRadians: 0 }, center);
            const isDirectHit = tank.seatIndex === directHitSeatIndex;
            const radius = profile.splashRadiusInVoxels || 0;
            if (!isDirectHit && (radius <= 0 || distance > radius)) continue;
            const proximity = radius > 0 ? Math.max(0, 1 - distance / radius) : isDirectHit ? 1 : 0;
            const falloff = profile.falloff === 'constant' ? 1
                : profile.falloff === 'quadratic' ? proximity * proximity : proximity;
            const amount = isDirectHit ? profile.directHitDamage || 0 : (profile.splashDamage || 0) * falloff;
            const direction = normalizeVector(createVector3(), createVector3(tank.position.x - center.x,
                tank.position.y - center.y, tank.position.z - center.z));
            direction.y += profile.knockbackUpwardBias === undefined ? explosionDefaultUpwardBias
                : profile.knockbackUpwardBias;
            normalizeVector(direction, direction);
            const impulse = (profile.knockbackImpulse === undefined ? explosionDefaultKnockbackImpulse
                : profile.knockbackImpulse) * falloff;
            this.enqueue(tank, amount, source, createVector3(direction.x * impulse, direction.y * impulse,
                direction.z * impulse));
        }
    }

    flush(onDamage?: (target: Tank, source: Tank | null, amount: number, died: boolean) => void): void {
        for (const entry of this.pending) {
            const wasAlive = !entry.target.isWreck;
            const isFriendlyHit = entry.source !== null && entry.source !== entry.target &&
                entry.source.teamIndex === entry.target.teamIndex;
            const amount = entry.target.applyDamage(this.isFriendlyFireEnabled || !isFriendlyHit ? entry.amount : 0,
                entry.source);
            if (entry.impulse.x || entry.impulse.y || entry.impulse.z) entry.target.applyImpulse(entry.impulse);
            if (onDamage && amount > 0) onDamage(entry.target, entry.source, amount,
                wasAlive && entry.target.isWreck);
        }
        this.pending.length = 0;
    }

    appendHash(hash: StateHash): void {
        hash.unsignedInteger(this.pending.length);
        for (const entry of this.pending) {
            hash.number(entry.target.seatIndex);
            hash.number(entry.source ? entry.source.seatIndex : -1);
            hash.number(entry.amount);
            hash.number(entry.impulse.x);
            hash.number(entry.impulse.y);
            hash.number(entry.impulse.z);
        }
    }
}
