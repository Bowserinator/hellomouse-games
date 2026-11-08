import { Rng } from '../../../shared/ts/seeded-random.js';
import { isMatchSettingValid, matchSettingKeys, MatchSettings, protocolVersion,
    resolveMaximumDurationInSeconds, simulationTicksPerSecond, turretDefaultPitchInDegrees } from '../config.js';
import { isPlayerPlan } from '../plan-validation.js';
import { MatchSnapshot, ResolveReport, SeatPlan, TurnKind, TurnLogEntry } from '../types.js';
import { dealWeapons } from './loadout-dealer.js';
import { StateHash } from './math/hash.js';
import { radiansPerDegree } from './math/deterministic-math.js';
import { quantizePitch } from './math/fixed-quantize.js';
import { Tank } from './tank.js';
import { applyTurnLiquidHazard, tickTankPhysics } from './tank-physics.js';
import { WeaponDataFiles } from './weapon-types.js';
import { WeaponRuntime } from './weapon-runtime.js';
import { WorldTheme, resolveTheme } from './world/themes.js';
import { generateBattlefield, GeneratedBattlefield, SpawnSeat } from './world/spawn.js';

type TankMotion = Pick<Tank, 'position' | 'velocity' | 'hullYawInRadians' | 'turretYawQuantized' |
'turretPitchQuantized' | 'powerCentipercent' | 'isGrounded' | 'isBuried' | 'movementTicksUsed' |
'standingSupportHeight' | 'airbornePeakHeight'>;

export class Match {
    public readonly battlefield: GeneratedBattlefield;
    public readonly runtime: WeaponRuntime;
    public readonly settings: Readonly<MatchSettings>;
    public readonly theme: Readonly<WorldTheme>;
    public turnIndex = 0;
    /** What the current turn is planning; rounds alternate between moving and firing. */
    public turnKind: TurnKind = 'MOVING';
    public isResolving = false;
    public lastReport: ResolveReport | null = null;
    private turnStarts: Array<TankMotion> = [];
    private selectedAtTurnStart: Array<[number, string]> = [];
    private plans: Array<SeatPlan> = [];
    private movementTick = 0;
    private movementDuration = 0;
    private elapsedResolveTicks = 0;
    private hasFired = false;
    private resolvingKind: TurnKind = 'MOVING';
    private shotsBeforeResolve = 0;

    constructor(matchSeed: number, settings: Readonly<MatchSettings>, seats: ReadonlyArray<SpawnSeat>,
        data: WeaponDataFiles, physicsDataHash: number, themes: ReadonlyArray<Readonly<WorldTheme>>,
        battlefield?: GeneratedBattlefield) {
        for (const key of matchSettingKeys)
            if (!isMatchSettingValid(key, settings[key])) throw new Error(`Invalid match setting ${key}`);
        if (seats.some(seat => seat.teamIndex >= settings.teamCount) ||
            new Set(seats.map(seat => seat.teamIndex)).size < 2) throw new Error('Match requires two populated teams');
        this.settings = Object.freeze({ ...settings });
        this.theme = resolveTheme(matchSeed, themes, settings.islandTheme);
        if (battlefield && (battlefield.world.mapEdgeLengthInVoxels !== settings.mapEdgeLengthInVoxels ||
            battlefield.generationSeed !== new Rng(matchSeed).fork(battlefield.generationSalt).seed ||
            battlefield.spawns.length !== seats.length || seats.some(seat => !battlefield.spawns.some(spawn =>
            spawn.seatIndex === seat.seatIndex && spawn.teamIndex === seat.teamIndex))))
            throw new Error('Battlefield does not match the requested match');
        this.battlefield = battlefield || generateBattlefield(matchSeed, settings.mapEdgeLengthInVoxels,
            this.theme, seats);
        const tanks = this.battlefield.spawns.map(spawn => {
            const tank = new Tank(spawn.seatIndex, spawn.teamIndex, spawn.position, settings.hitPointsPerTank);
            tank.turretPitchQuantized = quantizePitch(turretDefaultPitchInDegrees * radiansPerDegree);
            return tank;
        });
        const loadouts = dealWeapons(data.weapons.map(weapon => weapon.identifier), tanks.map(tank => tank.seatIndex),
            settings.weaponsPerPlayer, new Rng(matchSeed), settings.isSandbox);
        for (const tank of tanks)
            for (const [identifier, uses] of loadouts.get(tank.seatIndex)!) tank.ammunition.set(identifier, uses);
        this.runtime = new WeaponRuntime(this.battlefield.world, tanks, data, matchSeed, physicsDataHash);
        this.runtime.damage.isFriendlyFireEnabled = settings.isFriendlyFireEnabled;
        this.applyLiquidHazard();
        this.captureTurnStart();
    }

    /** Makes every turn plan movement and firing together, without the moving/firing alternation. */
    public useCombinedTurns(): void {
        this.turnKind = 'COMBINED';
    }

    public previewMovement(seatIndex: number, inputMask: number): boolean {
        const tank = this.runtime.tanks.find(candidate => candidate.seatIndex === seatIndex);
        if (this.isResolving || this.turnKind === 'FIRING' || !tank || tank.isWreck ||
            !Number.isSafeInteger(inputMask) || inputMask < 0 || inputMask > 15) return false;
        const before = tank.movementTicksUsed, previousYaw = tank.hullYawInRadians;
        tickTankPhysics(this.battlefield.world, tank, inputMask, this.movementBudget, this.runtime.tanks);
        return tank.movementTicksUsed !== before || tank.hullYawInRadians !== previousYaw;
    }

    public beginResolve(turnIndex: number, kind: TurnKind, plans: ReadonlyArray<SeatPlan>): void {
        if (this.isResolving || turnIndex !== this.turnIndex || kind !== this.turnKind)
            throw new Error('Resolve does not match the current turn');
        const maximumTicks = kind === 'FIRING' ? 0 : this.settings.movePlanningTimeLimitInSeconds * simulationTicksPerSecond;
        const seen = new Set<number>();
        for (const entry of plans) {
            const tank = this.runtime.tanks.find(candidate => candidate.seatIndex === entry.seatIndex);
            if (!tank || tank.isWreck || seen.has(entry.seatIndex) ||
                !isPlayerPlan(entry.plan, this.movementBudget, maximumTicks)) throw new Error('Invalid seat plan');
            seen.add(entry.seatIndex);
        }
        this.plans = plans.map(entry => ({ seatIndex: entry.seatIndex, plan: { ...entry.plan,
            movementSegments: entry.plan.movementSegments.map(([duration, mask]): [number, number] => [duration, mask])
        } })).sort((first, second) => first.seatIndex - second.seatIndex);
        for (let index = 0; index < this.runtime.tanks.length; index++) {
            const tank = this.runtime.tanks[index];
            const { position, velocity, ...scalars } = this.turnStarts[index];
            Object.assign(tank, scalars);
            Object.assign(tank.position, position);
            Object.assign(tank.velocity, velocity);
        }
        this.runtime.selectedWeapons.clear();
        for (const [seatIndex, identifier] of this.selectedAtTurnStart)
            this.runtime.selectedWeapons.set(seatIndex, identifier);
        for (const entry of this.plans) {
            const tank = this.runtime.tanks.find(candidate => candidate.seatIndex === entry.seatIndex)!;
            if (kind === 'MOVING') continue;
            tank.turretYawQuantized = entry.plan.turretYawQuantized;
            tank.turretPitchQuantized = entry.plan.turretPitchQuantized;
            tank.powerCentipercent = entry.plan.powerCentipercent;
            const identifier = entry.plan.weaponIdentifier;
            if (identifier && tank.ammunition.get(identifier)! > 0)
                this.runtime.selectWeapon(tank.seatIndex, identifier);
        }
        this.movementDuration = this.plans.reduce((maximum, entry) => Math.max(maximum,
            entry.plan.movementSegments.reduce((total, [duration]) => total + duration, 0)), 0);
        this.shotsBeforeResolve = this.runtime.tanks.reduce((total, tank) => total + tank.statistics.shotsFired, 0);
        this.runtime.turnIndex = this.turnIndex;
        this.movementTick = 0;
        this.elapsedResolveTicks = 0;
        this.hasFired = false;
        this.resolvingKind = kind;
        this.isResolving = true;
        this.lastReport = null;
    }

    public stepResolve(): ResolveReport | null {
        if (!this.isResolving) return this.lastReport;
        const inputs = new Map<number, number>();
        if (this.movementTick < this.movementDuration) {
            for (const entry of this.plans) {
                let remaining = this.movementTick;
                for (const [duration, mask] of entry.plan.movementSegments) {
                    if (remaining < duration) {
                        inputs.set(entry.seatIndex, mask);
                        break;
                    }
                    remaining -= duration;
                }
            }
            this.movementTick++;
        } else if (!this.hasFired) {
            if (this.resolvingKind !== 'MOVING')
                for (const entry of this.plans)
                    if (entry.plan.weaponIdentifier) this.runtime.fire(entry.seatIndex, entry.plan.weaponIdentifier);
            this.hasFired = true;
        }
        this.runtime.step(inputs, this.movementBudget);
        this.elapsedResolveTicks++;
        if (this.elapsedResolveTicks >= this.movementDuration +
            resolveMaximumDurationInSeconds * simulationTicksPerSecond ||
            this.hasFired && !this.runtime.isActive) return this.completeResolve();
        return null;
    }

    public resolve(entry: TurnLogEntry): ResolveReport {
        this.beginResolve(entry.turnIndex, entry.kind, entry.plans);
        while (this.isResolving) this.stepResolve();
        return this.lastReport!;
    }

    public appendHash(hash: StateHash): void {
        this.runtime.appendHash(hash);
        hash.unsignedInteger(this.turnIndex);
        hash.string(this.turnKind);
        hash.unsignedInteger(this.movementTick);
        hash.unsignedInteger(this.movementDuration);
        hash.unsignedInteger(this.elapsedResolveTicks);
        hash.byte(this.hasFired ? 1 : 0);
        hash.byte(this.isResolving ? 1 : 0);
        hash.number(this.shotsBeforeResolve);
        hash.unsignedInteger(this.turnStarts.length);
        for (const motion of this.turnStarts)
            for (const value of [motion.position.x, motion.position.y, motion.position.z,
                motion.velocity.x, motion.velocity.y, motion.velocity.z, motion.hullYawInRadians,
                motion.turretYawQuantized, motion.turretPitchQuantized, motion.powerCentipercent,
                motion.isGrounded, motion.isBuried, motion.movementTicksUsed, motion.standingSupportHeight,
                motion.airbornePeakHeight]) hash.number(Number(value));
        for (const key of matchSettingKeys) {
            const value = this.settings[key];
            hash.number(typeof value === 'boolean' ? Number(value) : value);
        }
        hash.unsignedInteger(this.selectedAtTurnStart.length);
        for (const [seatIndex, identifier] of this.selectedAtTurnStart) {
            hash.unsignedInteger(seatIndex);
            hash.string(identifier);
        }
        hash.unsignedInteger(this.plans.length);
        for (const { seatIndex, plan } of this.plans) {
            hash.unsignedInteger(seatIndex);
            hash.unsignedInteger(plan.turretYawQuantized);
            hash.unsignedInteger(plan.turretPitchQuantized);
            hash.unsignedInteger(plan.powerCentipercent);
            hash.string(plan.weaponIdentifier || '');
            hash.unsignedInteger(plan.movementSegments.length);
            for (const [duration, mask] of plan.movementSegments) {
                hash.unsignedInteger(duration);
                hash.unsignedInteger(mask);
            }
        }
    }

    public get isMovementPhase(): boolean {
        return this.isResolving && this.movementTick < this.movementDuration;
    }

    private get movementBudget(): number {
        return this.settings.movementTimePerTurnInSeconds * simulationTicksPerSecond;
    }

    private captureTurnStart(): void {
        this.selectedAtTurnStart = Array.from(this.runtime.selectedWeapons);
        for (const tank of this.runtime.tanks) tank.movementTicksUsed = 0;
        this.turnStarts = this.runtime.tanks.map(tank => ({
            position: { ...tank.position }, velocity: { ...tank.velocity },
            hullYawInRadians: tank.hullYawInRadians, turretYawQuantized: tank.turretYawQuantized,
            turretPitchQuantized: tank.turretPitchQuantized, powerCentipercent: tank.powerCentipercent,
            isGrounded: tank.isGrounded, isBuried: tank.isBuried, movementTicksUsed: 0,
            standingSupportHeight: tank.standingSupportHeight, airbornePeakHeight: tank.airbornePeakHeight }));
    }

    private applyLiquidHazard(): void {
        for (const tank of this.runtime.tanks) {
            const wasAlive = !tank.isWreck;
            const amount = applyTurnLiquidHazard(tank, this.theme.liquid.damagePerTurn);
            if (amount > 0) this.runtime.events.push({ type: 'tankDamaged', tick: this.runtime.tickInTicks,
                serial: tank.seatIndex, position: { ...tank.position }, amount, seatIndex: tank.seatIndex });
            if (wasAlive && tank.isWreck) this.runtime.events.push({ type: 'tankKilled', tick: this.runtime.tickInTicks,
                serial: tank.seatIndex, position: { ...tank.position }, seatIndex: tank.seatIndex });
        }
    }

    private completeResolve(): ResolveReport {
        this.runtime.finishResolve();
        if (this.resolvingKind !== 'MOVING') this.applyLiquidHazard();
        const resolvedTurnIndex = this.turnIndex++;
        const armedSeatIndices = this.runtime.tanks.filter(tank => !tank.isWreck &&
            Array.from(tank.ammunition.values()).some(uses => uses > 0)).map(tank => tank.seatIndex);
        if (this.turnKind !== 'COMBINED') this.turnKind = this.turnKind === 'MOVING' ? 'FIRING' : 'MOVING';
        this.isResolving = false;
        this.captureTurnStart();
        const hash = new StateHash();
        this.appendHash(hash);
        this.lastReport = { turnIndex: resolvedTurnIndex, stateHash: hash.value,
            aliveSeatIndices: this.runtime.tanks.filter(tank => !tank.isWreck).map(tank => tank.seatIndex),
            statistics: this.runtime.tanks.map(tank => ({ ...tank.statistics })),
            shotsFired: this.runtime.tanks.reduce((total, tank) => total + tank.statistics.shotsFired, 0) -
                this.shotsBeforeResolve,
            armedSeatIndices, hasAmmunitionRemaining: armedSeatIndices.length > 0 };
        return this.lastReport;
    }
}

export function replayMatch(snapshot: MatchSnapshot, data: WeaponDataFiles, physicsDataHash: number,
    themes: ReadonlyArray<Readonly<WorldTheme>>): Match {
    if (snapshot.protocolVersion !== protocolVersion || snapshot.weaponDataHash !== physicsDataHash)
        throw new Error('Match version or weapon data does not match');
    const match = new Match(snapshot.matchSeed, snapshot.settings, snapshot.seats, data, physicsDataHash, themes);
    for (const entry of snapshot.planLog) match.resolve(entry);
    return match;
}
