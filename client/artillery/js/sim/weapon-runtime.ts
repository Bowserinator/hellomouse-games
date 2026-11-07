import { airstrikeLineHoverInVoxels, airstrikeLineSegmentLengthInVoxels, projectileFiringSpeedMultiplier,
    tankSettledHeightToleranceInVoxels, worldHeightInVoxels, worldIndestructibleMaximumLayerIndex,
    worldWaterSurfaceHeightInVoxels } from '../config.js';
import { SimulationEvent } from '../types.js';
import { maximumTerrainReach } from '../data/terrain-reach.js';
import { Rng } from '../../../shared/ts/seeded-random.js';
import { DamageQueue } from './damage.js';
import { Deployable } from './deployable.js';
import { LiquidField } from './liquid-field.js';
import { arcTangent2, cosineOfRadians, fullCircleInRadians, radiansPerDegree,
    sineOfRadians } from './math/deterministic-math.js';
import { decodePitch, decodeYaw } from './math/fixed-quantize.js';
import { StateHash } from './math/hash.js';
import { launchVelocity } from './math/projectile-ballistics.js';
import { Vector3, addVectors, createVector3, crossProduct, distanceBetweenVectors,
    normalizeVector, scaleVector, vectorLength } from './math/vector3.js';
import { CollisionModel, rotateModelVector } from './model-collision.js';
import { Projectile } from './projectile.js';
import { ProjectileHook, ProjectileTarget, stepProjectile } from './projectile-step.js';
import { Tank } from './tank.js';
import { tickTankPhysics } from './tank-physics.js';
import { ProgressiveTerrainEdit, applyTerrainProfile } from './terrain-profiles.js';
import { ImmediateWeaponAction, WeaponActionContext, WeaponActionRunner } from './weapon-actions.js';
import { fireWeaponRay } from './weapon-ray.js';
import { TerrainOverrides, WeaponDataFiles, WeaponDefinition } from './weapon-types.js';
import { TerrainEditResult } from './world/terrain-edit.js';
import { VoxelWorld } from './world/voxel-world.js';

export class WeaponRuntime {
    public tickInTicks = 0;
    public turnIndex = 0;
    public readonly projectiles: Array<Projectile> = [];
    public readonly deployables: Array<Deployable> = [];
    public readonly events: Array<SimulationEvent> = [];
    public readonly damage = new DamageQueue();
    public readonly liquids: LiquidField;
    public readonly selectedWeapons = new Map<number, string>();
    private readonly actions = new WeaponActionRunner((action, context) => this.perform(action, context));
    private readonly terrainJobs: Array<{ edit: ProgressiveTerrainEdit; context: WeaponActionContext;
        identifier: string }> = [];
    private readonly projectileContexts = new Map<number, WeaponActionContext>();
    private readonly models = new Map<string, CollisionModel>();
    private readonly weapons = new Map<string, WeaponDefinition>();
    private readonly random: Rng;
    private readonly maximumTerrainReachInVoxels: number;
    public readonly tanks: Array<Tank>;

    constructor(public readonly world: VoxelWorld, tanks: ReadonlyArray<Tank>,
        private readonly data: WeaponDataFiles, matchSeed: number, private readonly physicsDataHash: number) {
        this.tanks = [...tanks].sort((first, second) => first.seatIndex - second.seatIndex);
        this.random = new Rng(matchSeed);
        this.liquids = new LiquidField(world.mapEdgeLengthInVoxels);
        this.maximumTerrainReachInVoxels = maximumTerrainReach(data.terrainProfiles);
        for (const weapon of data.weapons) this.weapons.set(weapon.identifier, weapon);
    }

    public selectWeapon(seatIndex: number, identifier: string): void {
        if (!this.tanks.some(tank => tank.seatIndex === seatIndex) || !this.weapons.has(identifier))
            throw new Error('Invalid weapon selection');
        this.selectedWeapons.set(seatIndex, identifier);
    }

    public fire(seatIndex: number, identifier: string): boolean {
        const tank = this.tanks.find(candidate => candidate.seatIndex === seatIndex);
        const weapon = this.weapons.get(identifier);
        if (!tank || tank.isWreck || !weapon || !(tank.ammunition.get(identifier)! > 0)) return false;
        this.actions.advanceTo(this.tickInTicks);
        this.selectWeapon(seatIndex, identifier);
        tank.ammunition.set(identifier, tank.ammunition.get(identifier)! - 1);
        tank.statistics.shotsFired++;
        const serial = this.actions.beginFire();
        this.actions.run(weapon.onFire, { weaponIdentifier: identifier, ownerSeatIndex: seatIndex,
            fireSerial: serial, sourceSerial: serial, position: { ...tank.position },
            yawInRadians: decodeYaw(tank.turretYawQuantized), pitchInRadians: decodePitch(tank.turretPitchQuantized),
            powerCentipercent: tank.powerCentipercent,
            random: this.random.fork(this.turnIndex).fork(serial), projectile: null,
            targetSeatIndex: null, actionDepth: 0 }, 'onFire');
        return true;
    }

    private model(identifier: string): CollisionModel {
        let model = this.models.get(identifier);
        if (!model) {
            model = new CollisionModel(this.data.models[identifier]);
            this.models.set(identifier, model);
        }
        return model;
    }

    public collisionTargets(): Array<ProjectileTarget> {
        return this.tanks.map(tank => {
            const identifier = this.selectedWeapons.get(tank.seatIndex) ?? this.data.weapons[0].identifier;
            const turret = this.data.turrets[this.weapons.get(identifier)!.turretIdentifier];
            const yaw = decodeYaw(tank.turretYawQuantized), pitch = decodePitch(tank.turretPitchQuantized);
            const turretPosition = addVectors(createVector3(), tank.position, createVector3(...turret.turretPivot));
            const barrelPosition = addVectors(createVector3(), turretPosition,
                rotateModelVector(createVector3(...turret.barrelPivot), yaw, 0));
            return { tank, hullModel: this.model('tank_hull'), additionalModels: [
                { model: this.model(turret.turretModelIdentifier), pose: {
                    position: turretPosition, yawInRadians: yaw, pitchInRadians: 0 } },
                { model: this.model(turret.barrelModelIdentifier), pose: {
                    position: barrelPosition, yawInRadians: yaw, pitchInRadians: pitch } }
            ] };
        });
    }

    private origin(context: WeaponActionContext, origin: 'context' | 'owner' | 'sky' = 'context'): Vector3 {
        const owner = this.tanks.find(tank => tank.seatIndex === context.ownerSeatIndex)!;
        if (origin === 'owner') return { ...owner.position };
        if (origin === 'sky') return createVector3(context.position.x, worldHeightInVoxels, context.position.z);
        const position = { ...context.position };
        if (context.sourceSerial === context.fireSerial) {
            const turret = this.data.turrets[this.weapons.get(context.weaponIdentifier)!.turretIdentifier];
            const pivot = createVector3(...turret.turretPivot);
            const barrel = rotateModelVector(createVector3(...turret.barrelPivot), context.yawInRadians, 0);
            const muzzle = rotateModelVector(createVector3(...turret.muzzleOffset),
                context.yawInRadians, context.pitchInRadians);
            addVectors(position, position, addVectors(pivot, pivot, addVectors(barrel, barrel, muzzle)));
        }
        return position;
    }

    /** Living tanks that are neither the owner nor on the owner's team. */
    private hostileTanks(ownerSeatIndex: number): Array<Tank> {
        const ownerTeam = this.tanks.find(tank => tank.seatIndex === ownerSeatIndex)?.teamIndex;
        return this.tanks.filter(tank => !tank.isWreck && tank.seatIndex !== ownerSeatIndex &&
            tank.teamIndex !== ownerTeam);
    }

    private direction(context: WeaponActionContext, target = 'aim'): Vector3 {
        if (target === 'up' || target === 'down') return createVector3(0, target === 'up' ? 1 : -1, 0);
        if (target === 'nearestTank') {
            const candidates = this.hostileTanks(context.ownerSeatIndex)
                .sort((first, second) => distanceBetweenVectors(first.position, context.position) -
                    distanceBetweenVectors(second.position, context.position) || first.seatIndex - second.seatIndex);
            const tank = candidates.find(candidate => candidate.seatIndex === context.targetSeatIndex) ?? candidates[0];
            if (tank) return normalizeVector(createVector3(), createVector3(tank.position.x - context.position.x,
                tank.position.y + 1.5 - context.position.y, tank.position.z - context.position.z));
        }
        return normalizeVector(createVector3(), rotateModelVector(createVector3(0, 0, 1),
            context.yawInRadians, context.pitchInRadians));
    }

    private emit(context: WeaponActionContext, type: SimulationEvent['type'],
        details: Partial<SimulationEvent> = {}): void {
        this.events.push({ type, tick: this.tickInTicks, serial: context.sourceSerial,
            position: { ...context.position }, weaponIdentifier: context.weaponIdentifier,
            seatIndex: context.ownerSeatIndex, ...details });
    }

    private terrain(context: WeaponActionContext, edit: TerrainEditResult): void {
        if (edit.removedCount || edit.addedCount) this.emit(context, 'terrainAdded',
            { amount: edit.addedCount - edit.removedCount, removedVoxelSamples: edit.removedVoxelSamples });
    }

    /** Applies a terrain profile now, or starts spreading it over time when the profile asks for that. */
    private editTerrain(identifier: string, context: WeaponActionContext, overrides?: TerrainOverrides): void {
        const profile = this.data.terrainProfiles[identifier];
        const seed = context.random.fork(context.sourceSerial).seed;
        if (!profile.durationSeconds) {
            this.terrain(context, applyTerrainProfile(this.world, profile, context.position,
                this.direction(context), seed, overrides));
            return;
        }
        const job = { edit: new ProgressiveTerrainEdit(profile, context.position, seed, overrides),
            context: { ...context, position: { ...context.position }, projectile: null }, identifier };
        this.terrainJobs.push(job);
        this.advanceTerrainJob(job);
    }

    private advanceTerrainJob(job: { edit: ProgressiveTerrainEdit; context: WeaponActionContext }): void {
        this.terrain(job.context, job.edit.advance(this.world));
    }

    private advanceTerrainJobs(finishAll: boolean): void {
        for (const job of this.terrainJobs)
            while (!job.edit.isFinished) {
                this.advanceTerrainJob(job);
                if (!finishAll) break;
            }
        for (let index = this.terrainJobs.length - 1; index >= 0; index--)
            if (this.terrainJobs[index].edit.isFinished) this.terrainJobs.splice(index, 1);
    }

    private perform(action: ImmediateWeaponAction, context: WeaponActionContext): void {
        const source = this.tanks.find(tank => tank.seatIndex === context.ownerSeatIndex) ?? null;
        switch (action.action) {
            case 'launchProjectile': {
                const weapon = this.weapons.get(context.weaponIdentifier)!;
                const definition = weapon.projectiles[action.projectileIdentifier];
                const aim = { ...context,
                    yawInRadians: context.yawInRadians + (action.yawOffsetDegrees ?? 0) * radiansPerDegree,
                    pitchInRadians: context.pitchInRadians + (action.pitchOffsetDegrees ?? 0) * radiansPerDegree };
                const fixedSpeed = action.speedInVoxelsPerSecond ?? definition.speedInVoxelsPerSecond;
                const speed = fixedSpeed !== undefined ? fixedSpeed * projectileFiringSpeedMultiplier
                    : vectorLength(launchVelocity(0, 0, context.powerCentipercent,
                        definition.massClass ?? weapon.massClass!,
                        (action.speedScale ?? 1) * (definition.speedScale ?? 1)));
                const velocity = action.velocity
                    ? scaleVector(createVector3(), createVector3(...action.velocity), projectileFiringSpeedMultiplier)
                    : scaleVector(createVector3(), this.direction(aim, action.target), speed);
                const serial = this.actions.allocateSerial();
                const projectile = new Projectile({ serial,
                    ownerSeatIndex: context.ownerSeatIndex, weaponIdentifier: context.weaponIdentifier,
                    definitionIdentifier: action.projectileIdentifier, definition,
                    position: this.origin(aim, action.origin), velocity,
                    randomSeed: this.random.fork(this.turnIndex).fork(serial).seed, actionDepth: context.actionDepth,
                    yawOffsetInRadians: ((aim.yawInRadians - decodeYaw(source!.turretYawQuantized) + Math.PI) %
                        fullCircleInRadians + fullCircleInRadians) % fullCircleInRadians - Math.PI,
                    pitchOffsetInRadians: aim.pitchInRadians - decodePitch(source!.turretPitchQuantized) });
                scaleVector(projectile.velocity, velocity, 1);
                this.projectiles.push(projectile);
                this.projectileContexts.set(projectile.serial, context);
                this.emit(context, 'projectileSpawn', { serial: projectile.serial, position: { ...projectile.position } });
                if (definition.onLaunch) this.actions.run(definition.onLaunch,
                    { ...context, projectile, random: projectile.random,
                        sourceSerial: projectile.serial, position: projectile.position },
                    `${weapon.identifier}.${action.projectileIdentifier}.onLaunch`);
                break;
            }
            case 'explode':
            case 'applyDamage': {
                if (action.action === 'explode' && context.position.y <= worldIndestructibleMaximumLayerIndex) break;
                const profile = { ...this.data.damageProfiles[action.damageProfileIdentifier],
                    ...action.damageOverrides };
                this.damage.enqueueExplosion(context.position, profile, this.collisionTargets(), source,
                    context.targetSeatIndex);
                if (action.action === 'applyDamage') break;
                this.editTerrain(action.terrainProfileIdentifier, context, action.terrainOverrides);
                this.liquids.igniteNear(context.position, profile.splashRadiusInVoxels ?? 0);
                this.emit(context, 'explosion', { effectProfileIdentifier: action.effectProfileIdentifier,
                    radiusInVoxels: profile.splashRadiusInVoxels });
                break;
            }
            case 'applyTerrain':
                this.editTerrain(action.terrainProfileIdentifier, context, action.terrainOverrides);
                break;
            case 'playEffect':
                this.emit(context, 'effect', { effectProfileIdentifier: action.effectProfileIdentifier });
                break;
            case 'setProjectileMode': context.projectile?.setMode(action); break;
            case 'setProjectileVelocity': {
                if (!context.projectile) break;
                const velocity = context.projectile.velocity;
                if (action.velocity)
                    scaleVector(velocity, createVector3(...action.velocity), projectileFiringSpeedMultiplier);
                else if (action.target || action.speedInVoxelsPerSecond !== undefined)
                    scaleVector(velocity, this.direction(context, action.target),
                        action.speedInVoxelsPerSecond !== undefined
                            ? action.speedInVoxelsPerSecond * projectileFiringSpeedMultiplier : vectorLength(velocity));
                if (action.horizontalSpeedScale !== undefined) {
                    velocity.x *= action.horizontalSpeedScale;
                    velocity.z *= action.horizontalSpeedScale;
                }
                if (action.verticalSpeedInVoxelsPerSecond !== undefined)
                    velocity.y = action.verticalSpeedInVoxelsPerSecond * projectileFiringSpeedMultiplier;
                break;
            }
            case 'destroySelf': if (context.projectile) context.projectile.isAlive = false; break;
            case 'igniteLiquidNear': this.liquids.igniteNear(context.position, action.radiusInVoxels); break;
            case 'createLiquid': {
                const profile = action.damageProfileIdentifier
                    ? this.data.damageProfiles[action.damageProfileIdentifier].damageOverTime : undefined;
                for (let index = 0; index < action.cellCount; index++) {
                    const radius = Math.sqrt(index), angle = index * 2.399963229728653;
                    const position = createVector3(context.position.x + cosineOfRadians(angle) * radius,
                        context.position.y + 1, context.position.z + sineOfRadians(angle) * radius);
                    this.liquids.addCell(this.world, position, { kind: action.kind, sourceSerial: context.sourceSerial,
                        ownerSeatIndex: context.ownerSeatIndex, randomSeed: context.random.fork(index).seed,
                        spreadBudget: action.spreadBudget, igniteAfterSeconds: action.igniteAfterSeconds,
                        durationSeconds: action.durationSeconds ?? profile?.durationSeconds,
                        damagePerSecond: profile?.amountPerSecond });
                }
                this.emit(context, 'burnStart');
                break;
            }
            case 'deployEntity':
            case 'liftColumn': {
                const definition = action.action === 'deployEntity' ? action.definition : {
                    kind: 'elevator' as const, radiusInVoxels: action.radiusInVoxels,
                    thicknessInVoxels: action.thicknessInVoxels, liftInVoxels: action.liftInVoxels,
                    speedInVoxelsPerSecond: action.speedInVoxelsPerSecond, effectProfileIdentifier: '' };
                const entity = new Deployable(this.actions.allocateSerial(), definition,
                    { ...context, random: this.random.fork(this.turnIndex) }, this.world.mapEdgeLengthInVoxels);
                this.deployables.push(entity);
                if (definition.kind === 'airstrike') this.markAirstrikeRun(entity, context);
                this.emit(context, 'deployable', { serial: entity.serial,
                    effectProfileIdentifier: definition.effectProfileIdentifier });
                break;
            }
            case 'fireRay': {
                if (action.target === 'allLivingTanks') {
                    const targets = this.hostileTanks(context.ownerSeatIndex).filter(tank =>
                        distanceBetweenVectors(tank.position, context.position) <=
                        (action.targetRangeInVoxels ?? Infinity));
                    if (!targets.length) this.perform({ ...action, target: 'down' }, context);
                    for (const tank of targets) {
                        const direction = normalizeVector(createVector3(), createVector3(
                            tank.position.x - context.position.x, tank.position.y + 1.5 - context.position.y,
                            tank.position.z - context.position.z));
                        this.perform({ ...action, target: action.origin === 'sky' ? 'down' : 'aim' }, {
                            ...context, targetSeatIndex: tank.seatIndex,
                            position: action.origin === 'sky' ? { ...tank.position } : context.position,
                            yawInRadians: arcTangent2(direction.x, direction.z),
                            pitchInRadians: arcTangent2(direction.y, Math.sqrt(
                                direction.x * direction.x + direction.z * direction.z)) });
                    }
                    break;
                }
                const direction = this.direction(context, action.target);
                if (action.randomConeDegrees) {
                    const angle = Math.sqrt(context.random.float()) * action.randomConeDegrees * radiansPerDegree;
                    const azimuth = context.random.float() * fullCircleInRadians;
                    const right = normalizeVector(createVector3(), crossProduct(createVector3(), direction,
                        Math.abs(direction.y) < .9 ? createVector3(0, 1, 0) : createVector3(1, 0, 0)));
                    const upward = crossProduct(createVector3(), right, direction);
                    const radial = sineOfRadians(angle);
                    scaleVector(direction, direction, cosineOfRadians(angle));
                    addVectors(direction, direction, scaleVector(right, right, radial * cosineOfRadians(azimuth)));
                    addVectors(direction, direction, scaleVector(upward, upward, radial * sineOfRadians(azimuth)));
                }
                const result = fireWeaponRay(this.world, { origin: this.origin(context, action.origin), direction,
                    lengthInVoxels: action.lengthInVoxels, radiusInVoxels: action.radiusInVoxels,
                    passesThroughTerrain: action.passesThroughTerrain, stopsAtFirstTank: action.stopsAtFirstTank,
                    damageProfile: this.data.damageProfiles[action.damageProfileIdentifier],
                    terrainProfile: action.terrainProfileIdentifier
                        ? this.data.terrainProfiles[action.terrainProfileIdentifier] : undefined,
                    randomSeed: context.random.fork(context.sourceSerial).seed }, this.collisionTargets(), source,
                this.damage);
                if (result.terrainEdit) this.terrain(context, result.terrainEdit);
                this.emit(context, 'beam', { position: this.origin(context, action.origin), endpoint: result.endpoint,
                    seatIndex: context.ownerSeatIndex,
                    radiusInVoxels: action.radiusInVoxels ?? 0,
                    effectProfileIdentifier: action.effectProfileIdentifier });
                break;
            }
        }
    }

    /** Draws the bombing run along the ground as a chain of short lines that follow the terrain. */
    private markAirstrikeRun(entity: Deployable, context: WeaponActionContext): void {
        const segmentCount = Math.max(1, Math.ceil(entity.pathLength / airstrikeLineSegmentLengthInVoxels));
        const pointAt = (index: number): Vector3 => {
            const along = entity.pathLength * index / segmentCount;
            const x = entity.pathStart.x + entity.pathHeading.x * along;
            const z = entity.pathStart.z + entity.pathHeading.z * along;
            const ground = Math.max(this.world.highestSolidY(Math.floor(x), Math.floor(z)) + 1,
                worldWaterSurfaceHeightInVoxels);
            return createVector3(x, ground + airstrikeLineHoverInVoxels, z);
        };
        let previous = pointAt(0);
        for (let index = 1; index <= segmentCount; index++) {
            const next = pointAt(index);
            this.emit(context, 'line', { serial: entity.serial, position: previous, endpoint: next, radiusInVoxels: .35,
                effectProfileIdentifier: entity.definition.effectProfileIdentifier });
            previous = next;
        }
    }

    /** Removes the bombing run line once its aircraft is gone. */
    private clearAirstrikeLine(entity: Deployable): void {
        if (entity.definition.kind === 'airstrike')
            this.emit(entity.context, 'lineEnd', { serial: entity.serial, position: { ...entity.pathStart } });
    }

    private hook(projectile: Projectile, hook: ProjectileHook, targetSeatIndex: number | null): void {
        const specification = projectile.definition[hook];
        if (!specification) return;
        const actions = Array.isArray(specification) ? specification
            : (specification as { actions: ReadonlyArray<ImmediateWeaponAction> }).actions;
        const stored = this.projectileContexts.get(projectile.serial)!;
        this.actions.run(actions, { ...stored, sourceSerial: projectile.serial, projectile,
            position: projectile.position, targetSeatIndex, random: projectile.random,
            actionDepth: projectile.actionDepth,
            yawInRadians: arcTangent2(projectile.velocity.x, projectile.velocity.z),
            pitchInRadians: arcTangent2(projectile.velocity.y, Math.sqrt(
                projectile.velocity.x * projectile.velocity.x + projectile.velocity.z * projectile.velocity.z)) },
        `${projectile.weaponIdentifier}.${projectile.definitionIdentifier}.${hook}`);
    }

    public step(movementInputs: ReadonlyMap<number, number> = new Map(), movementBudgetInTicks = 0): void {
        this.actions.advanceTo(this.tickInTicks);
        const targets = this.collisionTargets();
        for (const projectile of [...this.projectiles]) stepProjectile(this.world, projectile, targets,
            (current, hook, context) => this.hook(current, hook, context.targetSeatIndex ?? null),
            this.maximumTerrainReachInVoxels);
        this.liquids.step(this.world, this.tanks, this.damage);
        for (const entity of [...this.deployables]) entity.step(this.world, this.tanks,
            (actions, context, path) => this.actions.run(actions, context, path),
            edit => this.terrain(entity.context, edit));
        this.advanceTerrainJobs(false);
        for (const tank of this.tanks) tickTankPhysics(this.world, tank,
            movementInputs.get(tank.seatIndex) ?? 0, movementBudgetInTicks, this.tanks);
        this.damage.flush((tank, _source, amount, killed) => this.events.push({ type: killed ? 'tankKilled' : 'tankDamaged',
            tick: this.tickInTicks, serial: this.actions.allocateSerial(), position: { ...tank.position },
            seatIndex: tank.seatIndex, amount }));
        for (let index = 0; index < this.projectiles.length;) {
            const projectile = this.projectiles[index];
            if (projectile.isAlive) {
                index++;
                continue;
            }
            this.emit(this.projectileContexts.get(projectile.serial)!, 'projectileRemoved',
                { serial: projectile.serial, position: { ...projectile.position } });
            this.projectileContexts.delete(projectile.serial);
            this.projectiles.splice(index, 1);
        }
        for (let index = this.deployables.length - 1; index >= 0; index--)
            if (!this.deployables[index].isAlive) this.clearAirstrikeLine(this.deployables.splice(index, 1)[0]);
        this.tickInTicks++;
    }

    public finishResolve(): void {
        this.actions.clearPendingActions();
        this.advanceTerrainJobs(true);
        for (const projectile of this.projectiles)
            this.emit(this.projectileContexts.get(projectile.serial)!, 'projectileRemoved',
                { serial: projectile.serial, position: { ...projectile.position } });
        this.projectiles.length = 0;
        this.projectileContexts.clear();
        for (let index = this.deployables.length - 1; index >= 0; index--) {
            const entity = this.deployables[index];
            if (!entity.isPersistent || --entity.remainingTurns <= 0) {
                this.deployables.splice(index, 1);
                this.clearAirstrikeLine(entity);
            }
        }
        this.liquids.finishResolve(this.world, this.tanks, this.damage);
        this.damage.flush((tank, _source, amount, killed) => this.events.push({ type: killed ? 'tankKilled' : 'tankDamaged',
            tick: this.tickInTicks, serial: this.actions.allocateSerial(), position: { ...tank.position },
            seatIndex: tank.seatIndex, amount }));
    }

    /** Whether any deployable is still doing something, as opposed to merely lingering between turns. */
    public get hasActiveDeployables(): boolean {
        return this.deployables.some(entity => entity.isBusy);
    }

    public get isActive(): boolean {
        return this.projectiles.length > 0 || this.terrainJobs.length > 0 || this.hasActiveDeployables ||
            this.actions.hasPendingActions ||
            this.liquids.isActive || this.tanks.some(tank => !tank.isBuried && (!tank.isGrounded ||
                Math.abs(tank.position.y - tank.standingSupportHeight) > tankSettledHeightToleranceInVoxels));
    }

    public appendHash(hash: StateHash): void {
        hash.unsignedInteger(this.physicsDataHash).unsignedInteger(this.tickInTicks).unsignedInteger(this.turnIndex)
            .number(this.random.seed)
            .number(this.random.currentState).unsignedInteger(this.selectedWeapons.size);
        for (const [seat, identifier] of this.selectedWeapons) hash.unsignedInteger(seat).string(identifier);
        this.actions.appendHash(hash);
        this.world.appendHash(hash);
        for (const tank of this.tanks) tank.appendHash(hash);
        hash.unsignedInteger(this.projectiles.length);
        for (const projectile of this.projectiles) {
            projectile.appendHash(hash);
            const context = this.projectileContexts.get(projectile.serial)!;
            hash.unsignedInteger(context.fireSerial).unsignedInteger(context.powerCentipercent);
        }
        hash.unsignedInteger(this.terrainJobs.length);
        for (const job of this.terrainJobs) hash.string(job.identifier).number(job.edit.progress);
        hash.unsignedInteger(this.deployables.length);
        for (const entity of this.deployables) entity.appendHash(hash);
        this.liquids.appendHash(hash);
        this.damage.appendHash(hash);
    }
}
