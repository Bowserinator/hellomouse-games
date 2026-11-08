import { simulationTicksPerSecond, weaponMaximumActionDepth, weaponMaximumSpawnsPerFire } from '../config.js';
import { Rng } from '../../../shared/ts/seeded-random.js';
import { arcTangent2, cosineOfRadians, sineOfRadians } from './math/deterministic-math.js';
import { StateHash } from './math/hash.js';
import { Vector3, createVector3 } from './math/vector3.js';
import { Projectile } from './projectile.js';
import { projectilePattern } from './projectile-pattern.js';
import { WeaponAction } from './weapon-types.js';

export interface WeaponActionContext {
    weaponIdentifier: string;
    ownerSeatIndex: number;
    fireSerial: number;
    sourceSerial: number;
    position: Vector3;
    yawInRadians: number;
    pitchInRadians: number;
    powerCentipercent: number;
    random: Rng;
    projectile: Projectile | null;
    targetSeatIndex: number | null;
    actionDepth: number;
    projectedImpact?: Vector3 | null;
}

export type ImmediateWeaponAction = Exclude<WeaponAction,
{ action: 'schedule' | 'repeat' | 'spawnProjectiles' }>;

interface ScheduledActions {
    tick: number;
    serial: number;
    actions: ReadonlyArray<WeaponAction>;
    actionPath: string;
    context: WeaponActionContext;
}

export class WeaponActionRunner {
    private tick = 0;
    private nextSerial = 1;
    private readonly queue: Array<ScheduledActions> = [];
    private readonly fireSpawnCounts = new Map<number, number>();

    constructor(private readonly perform: (action: ImmediateWeaponAction, context: WeaponActionContext) => void) {}

    public allocateSerial(): number {
        return this.nextSerial++;
    }

    public beginFire(): number {
        const serial = this.allocateSerial();
        this.fireSpawnCounts.set(serial, 0);
        return serial;
    }

    public run(actions: ReadonlyArray<WeaponAction>, context: WeaponActionContext, actionPath: string): void {
        if (context.actionDepth > weaponMaximumActionDepth) throw new RangeError('Weapon action depth exceeded');
        const sine = sineOfRadians(context.yawInRadians), cosine = cosineOfRadians(context.yawInRadians);
        for (let index = 0; index < actions.length; index++) {
            const action = actions[index], path = `${actionPath}.${index}`;
            const offset = 'offset' in action ? action.offset : undefined;
            const current = { ...context, position: createVector3(
                context.position.x + (offset?.[0] ?? 0) * cosine + (offset?.[2] ?? 0) * sine,
                context.position.y + (offset?.[1] ?? 0),
                context.position.z - (offset?.[0] ?? 0) * sine + (offset?.[2] ?? 0) * cosine) };
            switch (action.action) {
                case 'schedule':
                    this.schedule(action.actions, { ...current, actionDepth: current.actionDepth + 1 },
                        `${path}.actions`, Math.ceil(action.delaySeconds * simulationTicksPerSecond));
                    break;
                case 'repeat':
                    for (let iteration = 0; iteration < action.count; iteration++) {
                        const step = action.offsetPerIteration;
                        const repeated = { ...current, actionDepth: current.actionDepth + 1,
                            position: createVector3(current.position.x + iteration *
                                ((step?.[0] ?? 0) * cosine + (step?.[2] ?? 0) * sine),
                            current.position.y + iteration * (step?.[1] ?? 0),
                            current.position.z + iteration *
                                (-(step?.[0] ?? 0) * sine + (step?.[2] ?? 0) * cosine)) };
                        this.schedule(action.actions, repeated, `${path}.actions`,
                            Math.ceil((action.intervalSeconds * simulationTicksPerSecond) * iteration));
                    }
                    break;
                case 'spawnProjectiles': {
                    const impact = action.aimAtProjectedImpact ? current.projectedImpact : null;
                    let yaw = current.yawInRadians, pitch = current.pitchInRadians;
                    if (impact) {
                        const offsetX = impact.x - current.position.x, offsetZ = impact.z - current.position.z;
                        yaw = arcTangent2(offsetX, offsetZ);
                        pitch = arcTangent2(impact.y - current.position.y,
                            Math.sqrt(offsetX * offsetX + offsetZ * offsetZ));
                    }
                    const pattern = projectilePattern(impact ? { ...action, pitchDegrees: undefined } : action,
                        yaw, pitch, current.random);
                    for (let launchIndex = 0; launchIndex < pattern.length; launchIndex++) {
                        const launch = pattern[launchIndex];
                        const spawned = { ...current, actionDepth: current.actionDepth + 1,
                            position: createVector3(current.position.x + launch.offset.x,
                                current.position.y + launch.offset.y, current.position.z + launch.offset.z),
                            yawInRadians: arcTangent2(launch.direction.x, launch.direction.z),
                            pitchInRadians: arcTangent2(launch.direction.y, Math.sqrt(
                                launch.direction.x * launch.direction.x + launch.direction.z * launch.direction.z)) };
                        const launchAction: ImmediateWeaponAction = { action: 'launchProjectile',
                            projectileIdentifier: action.projectileIdentifier,
                            speedInVoxelsPerSecond: action.speedInVoxelsPerSecond };
                        if (launch.delayInTicks === 0)
                            this.run([launchAction], spawned, `${path}.pattern:${launchIndex}`);
                        else this.schedule([launchAction], spawned, `${path}.pattern:${launchIndex}`, launch.delayInTicks);
                    }
                    break;
                }
                case 'launchProjectile': {
                    const count = this.fireSpawnCounts.get(current.fireSerial);
                    if (count === undefined) throw new Error('Unregistered weapon fire');
                    if (count >= weaponMaximumSpawnsPerFire) throw new RangeError('Weapon spawn budget exceeded');
                    this.fireSpawnCounts.set(current.fireSerial, count + 1);
                    this.perform(action, current);
                    break;
                }
                default: this.perform(action, current);
            }
        }
    }

    private schedule(actions: ReadonlyArray<WeaponAction>, context: WeaponActionContext, actionPath: string,
        delayInTicks: number): void {
        if (context.actionDepth > weaponMaximumActionDepth) throw new RangeError('Weapon action depth exceeded');
        const serial = this.allocateSerial();
        this.queue.push({ tick: this.tick + delayInTicks, serial, actions, actionPath,
            context: { ...context, position: { ...context.position }, random: context.random.fork(serial) } });
        this.queue.sort((first, second) => first.tick - second.tick || first.serial - second.serial);
    }

    public advanceTo(tick: number): void {
        if (!Number.isInteger(tick) || tick < this.tick) throw new RangeError('Invalid weapon action tick');
        this.tick = tick;
        while (this.queue.length && this.queue[0].tick <= tick) {
            const next = this.queue.shift()!;
            this.run(next.actions, next.context, next.actionPath);
        }
    }

    public clearPendingActions(): void {
        this.queue.length = 0;
    }

    public get hasPendingActions(): boolean {
        return this.queue.length !== 0;
    }

    public appendHash(hash: StateHash): void {
        hash.number(this.tick).number(this.nextSerial).unsignedInteger(this.fireSpawnCounts.size);
        for (const [fireSerial, count] of this.fireSpawnCounts) hash.number(fireSerial).number(count);
        hash.unsignedInteger(this.queue.length);
        // Action paths identify immutable, version-locked weapon data.
        for (const entry of this.queue) {
            const context = entry.context;
            hash.number(entry.tick).number(entry.serial).string(entry.actionPath).string(context.weaponIdentifier)
                .number(context.ownerSeatIndex).number(context.fireSerial).number(context.sourceSerial)
                .number(context.position.x).number(context.position.y).number(context.position.z)
                .number(context.yawInRadians).number(context.pitchInRadians).number(context.powerCentipercent)
                .number(context.random.seed).number(context.random.currentState)
                .number(context.projectile?.serial ?? -1).number(context.targetSeatIndex ?? -1)
                .number(context.actionDepth);
        }
    }
}
