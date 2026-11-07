import { simulationTicksPerSecond, tankHullHeightInVoxels, worldHeightInVoxels,
    worldWaterSurfaceHeightInVoxels } from '../config.js';
import { arcTangent2, cosineOfRadians, fullCircleInRadians, sineOfRadians } from './math/deterministic-math.js';
import { StateHash } from './math/hash.js';
import { Vector3, createVector3, crossProduct, distanceBetweenVectors, normalizeVector } from './math/vector3.js';
import { Tank } from './tank.js';
import { WeaponActionContext } from './weapon-actions.js';
import { DeployableDefinition, WeaponAction } from './weapon-types.js';
import { Material } from './world/material-table.js';
import { estimateSurfaceNormal } from './world/surface-normal.js';
import { carveRavine, liftColumn, setVoxel, TerrainEditResult } from './world/terrain-edit.js';
import { VoxelWorld } from './world/voxel-world.js';

export type RunDeployableActions = (actions: ReadonlyArray<WeaponAction>, context: WeaponActionContext,
    actionPath: string) => void;

export class Deployable {
    public ageInTicks = 0;
    public isAlive = true;
    public shotsFired = 0;
    public progressInVoxels = 0;
    public remainingTurns: number;
    private targetSeatIndices: Array<number> | null = null;
    /** For airstrikes: where the run enters the map, its unit heading across the ground and its length. */
    public readonly pathStart: Vector3 = createVector3();
    public readonly pathHeading = { x: 0, z: 0 };
    public pathLength = 0;
    public readonly context: WeaponActionContext;
    public readonly weaponIdentifier: string;
    public readonly yawOffsetInRadians: number;
    public readonly pitchOffsetInRadians: number;

    constructor(public readonly serial: number, public readonly definition: DeployableDefinition,
        context: WeaponActionContext, mapEdgeInVoxels = 0) {
        this.context = { ...context, position: { ...context.position }, projectile: null,
            sourceSerial: serial, random: context.random.fork(serial) };
        this.remainingTurns = definition.persistTurns ?? 0;
        this.weaponIdentifier = context.weaponIdentifier;
        this.yawOffsetInRadians = context.projectile?.yawOffsetInRadians ?? 0;
        this.pitchOffsetInRadians = context.projectile?.pitchOffsetInRadians ?? 0;
        if (definition.kind === 'airstrike') this.planRun(mapEdgeInVoxels);
    }

    /** Picks a random heading and the stretch of it, through the landing point, that crosses the whole map. */
    private planRun(mapEdge: number): void {
        const heading = this.context.random.float() * fullCircleInRadians;
        const headingX = sineOfRadians(heading), headingZ = cosineOfRadians(heading);
        const origin = this.context.position;
        const low = 1, high = mapEdge - 1;
        const x = Math.max(low, Math.min(high, origin.x)), z = Math.max(low, Math.min(high, origin.z));
        let entry = -Infinity, exit = Infinity;
        for (const [start, direction] of [[x, headingX], [z, headingZ]]) {
            if (Math.abs(direction) < 1e-9) continue;
            const first = (low - start) / direction, second = (high - start) / direction;
            entry = Math.max(entry, Math.min(first, second));
            exit = Math.min(exit, Math.max(first, second));
        }
        this.pathHeading.x = headingX;
        this.pathHeading.z = headingZ;
        this.pathStart.x = x + headingX * entry;
        this.pathStart.z = z + headingZ * entry;
        this.pathStart.y = this.definition.heightInVoxels!;
        this.pathLength = Math.max(0, exit - entry);
        this.context.yawInRadians = heading;
    }

    /** Where the aircraft is, a fraction of a tick ahead of or behind the simulation to keep motion smooth. */
    public visualPosition(interpolation: number): Vector3 {
        if (this.definition.kind !== 'airstrike') return this.context.position;
        const speedPerTick = this.definition.speedInVoxelsPerSecond! / simulationTicksPerSecond;
        const travelled = Math.max(0, Math.min(this.pathLength,
            this.progressInVoxels - (1 - interpolation) * speedPerTick));
        return createVector3(this.pathStart.x + this.pathHeading.x * travelled, this.pathStart.y,
            this.pathStart.z + this.pathHeading.z * travelled);
    }

    /** Whether the deployable still has work to do this turn. */
    public get isBusy(): boolean {
        return this.isAlive && this.definition.kind !== 'marker';
    }

    /** Whether the deployable stays on the battlefield after the turn that created it ends. */
    public get isPersistent(): boolean {
        return this.isAlive && this.definition.kind === 'marker';
    }

    public step(world: VoxelWorld, tanks: ReadonlyArray<Tank>, runActions: RunDeployableActions,
        onTerrainEdit: (edit: TerrainEditResult) => void): void {
        if (!this.isAlive) return;
        const elapsed = this.ageInTicks++;
        const definition = this.definition;
        if (definition.kind === 'marker') return;
        if (definition.kind === 'spider') {
            this.stepDetonation(elapsed, world, runActions);
            return;
        }
        if (definition.kind === 'airstrike') {
            this.stepAirstrike(elapsed, world, runActions);
            return;
        }
        if (definition.kind === 'turret' || definition.kind === 'storm') {
            this.stepShots(elapsed, world, tanks, runActions);
            return;
        }
        if (definition.kind === 'wall' || definition.kind === 'dome') {
            const layers = definition.kind === 'wall' ? definition.heightInVoxels! : Math.ceil(definition.radiusInVoxels!);
            const completed = Math.min(layers, Math.floor(this.ageInTicks /
                (definition.durationSeconds! * simulationTicksPerSecond) * layers));
            while (this.progressInVoxels < completed) {
                this.buildLayer(world, this.progressInVoxels, onTerrainEdit);
                this.progressInVoxels++;
            }
            this.isAlive = this.progressInVoxels < layers;
            return;
        }
        const maximum = definition.kind === 'elevator' ? definition.liftInVoxels! : definition.lengthInVoxels!;
        const progress = Math.min(maximum, this.ageInTicks * definition.speedInVoxelsPerSecond! /
            simulationTicksPerSecond);
        if (definition.kind === 'elevator') {
            const height = Math.floor(progress), change = height - this.progressInVoxels;
            if (change <= 0) return;
            const position = this.context.position;
            const surface = position.y + this.progressInVoxels;
            const riders = tanks.filter(tank => tank.isGrounded && Math.abs(tank.position.y - surface) < 1 &&
                (tank.position.x - position.x) * (tank.position.x - position.x) +
                (tank.position.z - position.z) * (tank.position.z - position.z) <=
                definition.radiusInVoxels! * definition.radiusInVoxels!);
            onTerrainEdit(liftColumn(world, createVector3(position.x,
                Math.floor(surface) - definition.thicknessInVoxels!, position.z),
            definition.radiusInVoxels!, change, definition.thicknessInVoxels!));
            for (const tank of riders) {
                tank.position.y += change;
                tank.standingSupportHeight += change;
                tank.airbornePeakHeight += change;
            }
            this.progressInVoxels = height;
        } else {
            const position = this.context.position;
            const forwardX = sineOfRadians(this.context.yawInRadians);
            const forwardZ = cosineOfRadians(this.context.yawInRadians);
            onTerrainEdit(carveRavine(world,
                createVector3(position.x + forwardX * this.progressInVoxels, worldHeightInVoxels - 1,
                    position.z + forwardZ * this.progressInVoxels),
                createVector3(position.x + forwardX * progress, worldHeightInVoxels - 1,
                    position.z + forwardZ * progress), definition.widthInVoxels! / 2,
                definition.heightInVoxels!, this.context.random.seed));
            this.progressInVoxels = progress;
        }
        this.isAlive = this.progressInVoxels < maximum;
    }

    private buildLayer(world: VoxelWorld, layer: number, onTerrainEdit: (edit: TerrainEditResult) => void): void {
        const definition = this.definition, position = this.context.position;
        const material = Material[definition.materialIdentifier! as keyof typeof Material] as Material;
        const radius = definition.kind === 'dome' ? definition.radiusInVoxels!
            : (definition.widthInVoxels! + definition.thicknessInVoxels!) / 2;
        const y = Math.floor(position.y) + layer - (definition.embeddedDepthInVoxels ?? 0);
        const sine = sineOfRadians(this.context.yawInRadians), cosine = cosineOfRadians(this.context.yawInRadians);
        for (let z = Math.floor(position.z - radius); z <= Math.ceil(position.z + radius); z++)
            for (let x = Math.floor(position.x - radius); x <= Math.ceil(position.x + radius); x++) {
                const offsetX = x + .5 - position.x, offsetZ = z + .5 - position.z;
                if (definition.kind === 'wall') {
                    const across = offsetX * cosine - offsetZ * sine;
                    const forward = offsetX * sine + offsetZ * cosine;
                    if (across <= -definition.widthInVoxels! / 2 || across > definition.widthInVoxels! / 2 ||
                        forward <= -definition.thicknessInVoxels! / 2 || forward > definition.thicknessInVoxels! / 2)
                        continue;
                } else {
                    const offsetY = y + .5 - position.y;
                    const squared = offsetX * offsetX + offsetY * offsetY + offsetZ * offsetZ;
                    if (squared > radius * radius || squared <
                        (radius - definition.thicknessInVoxels!) * (radius - definition.thicknessInVoxels!)) continue;
                }
                if (!world.contains(x, y, z) || world.isSolid(x, y, z)) continue;
                const edit = setVoxel(world, x, y, z, material);
                if (edit.touchedChunks.length) onTerrainEdit(edit);
            }
    }

    private stepAirstrike(elapsed: number, world: VoxelWorld, runActions: RunDeployableActions): void {
        const definition = this.definition;
        const delay = Math.ceil((definition.delaySeconds ?? 0) * simulationTicksPerSecond);
        if (elapsed < delay) return;
        this.progressInVoxels = (elapsed - delay) * definition.speedInVoxelsPerSecond! / simulationTicksPerSecond;
        const interval = definition.intervalSeconds! * simulationTicksPerSecond;
        while (this.shotsFired < definition.shotCount! && this.progressInVoxels <= this.pathLength &&
            elapsed - delay >= Math.ceil(this.shotsFired * interval)) {
            const shot = this.shotsFired++;
            const position = createVector3(this.pathStart.x + this.pathHeading.x * this.progressInVoxels,
                this.pathStart.y, this.pathStart.z + this.pathHeading.z * this.progressInVoxels);
            // Bombs are only released over land
            if (world.highestSolidY(Math.floor(position.x), Math.floor(position.z)) <=
                worldWaterSurfaceHeightInVoxels) continue;
            runActions([{ action: 'launchProjectile', projectileIdentifier: definition.projectileIdentifier!,
                target: 'down', speedInVoxelsPerSecond: definition.dropSpeedInVoxelsPerSecond ?? 0 }],
            { ...this.context, position, targetSeatIndex: null }, `deployable:${this.serial}.bomb:${shot}`);
        }
        this.isAlive = this.progressInVoxels <= this.pathLength && this.shotsFired < definition.shotCount!;
    }

    private stepDetonation(elapsed: number, world: VoxelWorld, runActions: RunDeployableActions): void {
        const definition = this.definition;
        if (elapsed < Math.ceil((definition.delaySeconds ?? 0) * simulationTicksPerSecond)) return;
        const position = this.context.position;
        const normal = estimateSurfaceNormal(world, position);
        const reference = Math.abs(normal.y) < .9 ? createVector3(0, 1, 0) : createVector3(1, 0, 0);
        const first = normalizeVector(createVector3(), crossProduct(createVector3(), normal, reference));
        const second = crossProduct(createVector3(), normal, first);
        const origin = createVector3(position.x + normal.x, position.y + normal.y, position.z + normal.z);
        const ray: WeaponAction = { action: 'fireRay', lengthInVoxels: definition.rangeInVoxels!,
            radiusInVoxels: 1, passesThroughTerrain: true, stopsAtFirstTank: true,
            damageProfileIdentifier: definition.damageProfileIdentifier!,
            terrainProfileIdentifier: definition.terrainProfileIdentifier,
            effectProfileIdentifier: definition.effectProfileIdentifier };
        for (let index = 0; index < definition.shotCount!; index++) {
            const angle = index * fullCircleInRadians / definition.shotCount!;
            const along = cosineOfRadians(angle), across = sineOfRadians(angle);
            const x = first.x * along + second.x * across, y = first.y * along + second.y * across;
            const z = first.z * along + second.z * across;
            runActions([ray], { ...this.context, position: { ...origin }, yawInRadians: arcTangent2(x, z),
                pitchInRadians: arcTangent2(y, Math.sqrt(x * x + z * z)) },
            `deployable:${this.serial}.detonation:${index}`);
        }
        this.isAlive = false;
    }

    private finish(runActions: RunDeployableActions): void {
        const actions = this.definition.onFinish;
        this.isAlive = false;
        if (actions?.length) runActions(actions, { ...this.context, position: { ...this.context.position } },
            `deployable:${this.serial}.finish`);
    }

    private stepShots(elapsed: number, world: VoxelWorld, tanks: ReadonlyArray<Tank>,
        runActions: RunDeployableActions): void {
        const definition = this.definition;
        const delay = Math.ceil((definition.delaySeconds ?? 0) * simulationTicksPerSecond);
        const interval = (definition.intervalSeconds ?? 0) * simulationTicksPerSecond;
        if (elapsed < delay + Math.ceil(this.shotsFired * interval)) return;
        const position = this.context.position;
        const owner = tanks.find(tank => tank.seatIndex === this.context.ownerSeatIndex);
        // Owners and their teammates are never targeted
        const hostile = [...tanks].filter(tank => !tank.isWreck && tank.seatIndex !== this.context.ownerSeatIndex &&
            tank.teamIndex !== owner?.teamIndex).sort((first, second) => first.seatIndex - second.seatIndex);
        let target: Tank | undefined;
        let maximumShots: number;
        if (definition.kind === 'turret') {
            let nearestDistance = Infinity;
            for (const tank of hostile) {
                const distance = distanceBetweenVectors(position, tank.position);
                if (distance < nearestDistance) {
                    nearestDistance = distance;
                    target = tank;
                }
            }
            maximumShots = definition.shotCount!;
        } else {
            if (this.targetSeatIndices === null)
                this.targetSeatIndices = hostile.filter(tank => distanceBetweenVectors(position, tank.position) <=
                    definition.rangeInVoxels!).map(tank => tank.seatIndex);
            maximumShots = Math.max(1, this.targetSeatIndices.length);
            target = hostile.find(tank => tank.seatIndex === this.targetSeatIndices![this.shotsFired]);
        }
        if (this.shotsFired >= maximumShots) {
            this.finish(runActions);
            return;
        }
        const shot = this.shotsFired++;
        if (target || definition.kind === 'storm' && this.targetSeatIndices?.length === 0) {
            const context = { ...this.context, targetSeatIndex: target?.seatIndex ?? null,
                position: { ...position } };
            const actions: Array<WeaponAction> = [];
            if (definition.kind === 'storm') {
                if (target) context.position = { ...target.position };
                else {
                    // Without anyone in range the bolt lands somewhere random under the clouds
                    const angle = this.context.random.float() * fullCircleInRadians;
                    const radius = Math.sqrt(this.context.random.float()) * definition.rangeInVoxels!;
                    context.position.x += sineOfRadians(angle) * radius;
                    context.position.z += cosineOfRadians(angle) * radius;
                    const top = world.highestSolidY(Math.floor(context.position.x), Math.floor(context.position.z));
                    if (top >= 0) context.position.y = top + 1;
                }
                actions.push({ action: 'applyTerrain', terrainProfileIdentifier: definition.terrainProfileIdentifier! },
                    { action: 'fireRay', origin: 'sky', target: 'down', lengthInVoxels: worldHeightInVoxels,
                        radiusInVoxels: 1.5, passesThroughTerrain: false,
                        damageProfileIdentifier: definition.damageProfileIdentifier!,
                        effectProfileIdentifier: definition.effectProfileIdentifier },
                    { action: 'playEffect', effectProfileIdentifier: definition.effectProfileIdentifier });
            } else {
                context.position.y += 2;
                const direction = createVector3(target!.position.x - context.position.x,
                    target!.position.y + tankHullHeightInVoxels / 2 - context.position.y,
                    target!.position.z - context.position.z);
                context.yawInRadians = arcTangent2(direction.x, direction.z);
                context.pitchInRadians = arcTangent2(direction.y,
                    Math.sqrt(direction.x * direction.x + direction.z * direction.z));
                actions.push({ action: 'launchProjectile', projectileIdentifier: definition.projectileIdentifier! });
            }
            runActions(actions, context, `deployable:${this.serial}.shot:${shot}`);
        }
        this.isAlive = this.shotsFired < maximumShots || !!definition.onFinish?.length;
    }

    public appendHash(hash: StateHash): void {
        const context = this.context;
        hash.number(this.serial).string(this.definition.kind).number(this.ageInTicks)
            .byte(Number(this.isAlive)).number(this.shotsFired).number(this.progressInVoxels)
            .string(context.weaponIdentifier).number(context.ownerSeatIndex).number(context.fireSerial)
            .number(context.sourceSerial).number(context.position.x).number(context.position.y)
            .number(context.position.z)
            .number(this.pathStart.x).number(this.pathStart.z).number(this.pathLength)
            .number(context.yawInRadians).number(context.pitchInRadians).number(context.powerCentipercent)
            .number(context.random.seed).number(context.random.currentState).number(context.actionDepth)
            .number(context.targetSeatIndex ?? -1).number(this.targetSeatIndices?.length ?? -1);
        if (this.targetSeatIndices) for (const seat of this.targetSeatIndices) hash.number(seat);
        const definition = this.definition;
        hash.string(definition.projectileIdentifier ?? '').string(definition.damageProfileIdentifier ?? '')
            .string(definition.terrainProfileIdentifier ?? '').string(definition.materialIdentifier ?? '')
            .number(definition.delaySeconds ?? 0).number(definition.durationSeconds ?? 0)
            .number(definition.intervalSeconds ?? 0).number(definition.shotCount ?? 0)
            .number(definition.rangeInVoxels ?? 0).number(definition.widthInVoxels ?? 0)
            .number(definition.heightInVoxels ?? 0).number(definition.thicknessInVoxels ?? 0)
            .number(definition.radiusInVoxels ?? 0).number(definition.lengthInVoxels ?? 0)
            .number(definition.speedInVoxelsPerSecond ?? 0).number(definition.dropSpeedInVoxelsPerSecond ?? 0)
            .number(definition.liftInVoxels ?? 0)
            .number(definition.embeddedDepthInVoxels ?? 0);
    }
}
