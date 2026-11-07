import { powerDefaultCentipercent, tankDefaultHitPoints, tankMass } from '../config.js';
import { PlayerStatistics } from '../types.js';
import { StateHash } from './math/hash.js';
import { Vector3, createVector3 } from './math/vector3.js';

export class Tank {
    public position: Vector3;
    public readonly velocity = createVector3();
    public hullYawInRadians = 0;
    public turretYawQuantized = 0;
    public turretPitchQuantized = 0;
    public powerCentipercent = powerDefaultCentipercent;
    public isGrounded = true;
    public isBuried = false;
    public isWreck = false;
    public movementTicksUsed = 0;
    public standingSupportHeight: number;
    public airbornePeakHeight: number;
    public hitPoints: number;
    public maximumHitPoints: number;
    public readonly ammunition = new Map<string, number>();
    public readonly statistics: PlayerStatistics;

    constructor(public readonly seatIndex: number, public readonly teamIndex: number,
        position: Vector3, hitPoints = tankDefaultHitPoints) {
        this.position = createVector3(position.x, position.y, position.z);
        this.standingSupportHeight = position.y;
        this.airbornePeakHeight = position.y;
        this.hitPoints = hitPoints;
        this.maximumHitPoints = hitPoints;
        this.statistics = { seatIndex, damageDealt: 0, damageTaken: 0, friendlyFireDamage: 0, shotsFired: 0 };
    }

    public applyImpulse(impulse: Vector3): void {
        if (this.isGrounded) this.airbornePeakHeight = this.position.y;
        this.velocity.x += impulse.x / tankMass;
        this.velocity.y += impulse.y / tankMass;
        this.velocity.z += impulse.z / tankMass;
        this.isGrounded = false;
    }

    public applyDamage(amount: number, source: Tank | null): number {
        if (this.isWreck || !Number.isFinite(amount) || amount <= 0) return 0;
        const damage = Math.min(this.hitPoints, amount);
        this.hitPoints -= damage;
        this.statistics.damageTaken += damage;
        if (source) {
            source.statistics.damageDealt += damage;
            if (source.teamIndex === this.teamIndex) source.statistics.friendlyFireDamage += damage;
        }
        if (this.hitPoints <= 0) this.isWreck = true;
        return damage;
    }

    public appendHash(hash: StateHash): void {
        hash.unsignedInteger(this.seatIndex).unsignedInteger(this.teamIndex);
        hash.number(this.position.x).number(this.position.y).number(this.position.z);
        hash.number(this.velocity.x).number(this.velocity.y).number(this.velocity.z);
        hash.number(this.hullYawInRadians).number(this.standingSupportHeight).number(this.hitPoints);
        hash.number(this.airbornePeakHeight);
        hash.unsignedInteger(this.turretYawQuantized).unsignedInteger(this.turretPitchQuantized);
        hash.unsignedInteger(this.powerCentipercent).unsignedInteger(this.movementTicksUsed);
        hash.byte(this.isGrounded ? 1 : 0).byte(this.isBuried ? 1 : 0).byte(this.isWreck ? 1 : 0);
        hash.unsignedInteger(this.ammunition.size);
        for (const [identifier, remaining] of this.ammunition) hash.string(identifier).number(remaining);
        hash.number(this.statistics.damageDealt).number(this.statistics.damageTaken);
        hash.number(this.statistics.friendlyFireDamage).unsignedInteger(this.statistics.shotsFired);
    }
}
