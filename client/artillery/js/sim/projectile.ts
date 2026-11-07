import { projectileFiringSpeedMultiplier, resolveMaximumDurationInSeconds, simulationTicksPerSecond } from '../config.js';
import { Rng } from '../../../shared/ts/seeded-random.js';
import { StateHash } from './math/hash.js';
import { Vector3, createVector3, vectorLength } from './math/vector3.js';
import { ProjectileDefinition, ProjectileMode, TerrainContact } from './weapon-types.js';

export interface ProjectileLaunch {
    serial: number;
    ownerSeatIndex: number;
    weaponIdentifier: string;
    definitionIdentifier: string;
    definition: ProjectileDefinition;
    position: Vector3;
    velocity: Vector3;
    randomSeed: number;
    actionDepth: number;
    yawOffsetInRadians?: number;
    pitchOffsetInRadians?: number;
}

export class Projectile {
    public readonly serial: number;
    public readonly ownerSeatIndex: number;
    public readonly weaponIdentifier: string;
    public readonly definitionIdentifier: string;
    public readonly definition: ProjectileDefinition;
    public readonly position: Vector3;
    public readonly velocity: Vector3;
    public readonly random: Rng;
    public readonly actionDepth: number;
    public readonly yawOffsetInRadians: number;
    public readonly pitchOffsetInRadians: number;
    public readonly tankHitBounce = new Map<number, number>();
    public ageInTicks = 0;
    public remainingLifetimeInTicks = 0;
    public travelDistanceInVoxels = 0;
    public maximumTravelDistanceInVoxels = Infinity;
    public gravityScale = 1;
    public terrainContact: TerrainContact = 'explode';
    public bounceCount = 0;
    public targetSeatIndex: number | null = null;
    public isAlive = true;
    public isStuck = false;
    public isRolling = false;
    public hasReachedApex = false;
    public hasEnteredTerrain = false;
    public hasFiredTimer = false;
    public hasClearedOwner = false;
    public isGuidanceActive = false;

    constructor(launch: ProjectileLaunch) {
        this.serial = launch.serial;
        this.ownerSeatIndex = launch.ownerSeatIndex;
        this.weaponIdentifier = launch.weaponIdentifier;
        this.definitionIdentifier = launch.definitionIdentifier;
        this.definition = launch.definition;
        this.position = createVector3(launch.position.x, launch.position.y, launch.position.z);
        this.velocity = createVector3(launch.velocity.x, launch.velocity.y, launch.velocity.z);
        this.random = new Rng(launch.randomSeed);
        this.actionDepth = launch.actionDepth;
        this.yawOffsetInRadians = launch.yawOffsetInRadians ?? 0;
        this.pitchOffsetInRadians = launch.pitchOffsetInRadians ?? 0;
        this.setMode({ lifetimeSeconds: resolveMaximumDurationInSeconds, ...launch.definition });
    }

    public setMode(mode: ProjectileMode): void {
        if (mode.terrainContact !== undefined) this.terrainContact = mode.terrainContact;
        if (mode.gravityScale !== undefined) this.gravityScale = mode.gravityScale;
        if (mode.lifetimeSeconds !== undefined)
            this.remainingLifetimeInTicks = Math.ceil(mode.lifetimeSeconds * simulationTicksPerSecond);
        if (mode.maximumTravelDistanceInVoxels !== undefined) {
            this.maximumTravelDistanceInVoxels = mode.maximumTravelDistanceInVoxels;
            this.travelDistanceInVoxels = 0;
        }
        if (mode.speedInVoxelsPerSecond !== undefined) {
            const previousSpeed = vectorLength(this.velocity);
            if (previousSpeed > 0) {
                const scale = mode.speedInVoxelsPerSecond * projectileFiringSpeedMultiplier / previousSpeed;
                this.velocity.x *= scale;
                this.velocity.y *= scale;
                this.velocity.z *= scale;
            }
        }
        if (this.terrainContact !== 'stick') this.isStuck = false;
        if (this.terrainContact !== 'roll') this.isRolling = false;
    }

    public appendHash(hash: StateHash): void {
        hash.unsignedInteger(this.serial).unsignedInteger(this.ownerSeatIndex).string(this.weaponIdentifier)
            .string(this.definitionIdentifier).number(this.random.seed).number(this.random.currentState)
            .unsignedInteger(this.actionDepth);
        for (const vector of [this.position, this.velocity]) hash.number(vector.x).number(vector.y).number(vector.z);
        hash.unsignedInteger(this.ageInTicks).number(this.remainingLifetimeInTicks).number(this.travelDistanceInVoxels)
            .number(this.maximumTravelDistanceInVoxels).number(this.gravityScale).string(this.terrainContact)
            .unsignedInteger(this.bounceCount).number(this.targetSeatIndex ?? -1);
        for (const flag of [this.isAlive, this.isStuck, this.isRolling, this.hasReachedApex, this.hasEnteredTerrain,
            this.hasFiredTimer, this.hasClearedOwner, this.isGuidanceActive]) hash.byte(flag ? 1 : 0);
        hash.unsignedInteger(this.tankHitBounce.size);
        for (const [seatIndex, bounce] of this.tankHitBounce) hash.unsignedInteger(seatIndex).unsignedInteger(bounce);
    }
}
