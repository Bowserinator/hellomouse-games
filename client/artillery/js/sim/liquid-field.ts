import { fireDefaultDamagePerSecond, fireDurationInSeconds, fireIgnitionHopDelayInSeconds, fireSplashRadiusInVoxels,
    liquidMaximumCellCount, liquidStepIntervalInTicks, simulationTicksPerSecond, tankHullHeightInVoxels,
    tankHullLengthInVoxels, tankHullWidthInVoxels } from '../config.js';
import { Rng } from '../../../shared/ts/seeded-random.js';
import { DamageQueue } from './damage.js';
import { cosineOfRadians, sineOfRadians } from './math/deterministic-math.js';
import { StateHash } from './math/hash.js';
import { Vector3 } from './math/vector3.js';
import { Tank } from './tank.js';
import { Material } from './world/material-table.js';
import { setVoxel } from './world/terrain-edit.js';
import { VoxelWorld } from './world/voxel-world.js';

export type LiquidKind = 'oil' | 'lava' | 'fire';
export interface LiquidCell {
    x: number;
    y: number;
    z: number;
    kind: LiquidKind;
    sourceSerial: number;
    ownerSeatIndex: number;
    remainingTicks: number;
    spreadBudget: number;
    damagePerSecond: number;
    nextIgnitionTick: number;
    igniteAtTick: number;
    isAtRest: boolean;
    random: Rng;
}
export interface LiquidSource {
    kind: LiquidKind;
    sourceSerial: number;
    ownerSeatIndex: number;
    randomSeed: number;
    durationSeconds?: number;
    spreadBudget?: number;
    igniteAfterSeconds?: number;
    damagePerSecond?: number;
}

const adjacentOffsets = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;

export class LiquidField {
    public readonly cells = new Map<number, LiquidCell>();
    private tick = 0;
    private readonly burnRemainders = new Map<number, Map<number, { numerator: number; ownerSeatIndex: number }>>();

    constructor(private readonly mapEdgeLengthInVoxels: number) {}

    private key(x: number, y: number, z: number): number {
        return x + this.mapEdgeLengthInVoxels * (z + this.mapEdgeLengthInVoxels * y);
    }

    public addCell(world: VoxelWorld, position: Vector3, source: LiquidSource): boolean {
        const x = Math.floor(position.x), y = Math.floor(position.y), z = Math.floor(position.z);
        const key = this.key(x, y, z);
        if (this.cells.size >= liquidMaximumCellCount || this.cells.has(key) || !world.contains(x, y, z) ||
            world.isSolid(x, y, z)) return false;
        this.cells.set(key, { x, y, z, kind: source.kind, sourceSerial: source.sourceSerial,
            ownerSeatIndex: source.ownerSeatIndex,
            remainingTicks: source.kind === 'lava' ? Infinity : source.durationSeconds === undefined
                ? source.kind === 'fire' ? fireDurationInSeconds * simulationTicksPerSecond : Infinity
                : Math.ceil(source.durationSeconds * simulationTicksPerSecond),
            spreadBudget: source.spreadBudget ?? 0,
            damagePerSecond: source.damagePerSecond ?? fireDefaultDamagePerSecond,
            nextIgnitionTick: this.tick + Math.ceil(fireIgnitionHopDelayInSeconds * simulationTicksPerSecond),
            igniteAtTick: source.igniteAfterSeconds === undefined ? Infinity
                : this.tick + Math.ceil(source.igniteAfterSeconds * simulationTicksPerSecond),
            isAtRest: false, random: new Rng(source.randomSeed).fork(key) });
        return true;
    }

    public igniteNear(position: Vector3, radiusInVoxels: number): void {
        for (const cell of this.cells.values()) {
            const deltaX = cell.x + .5 - position.x, deltaY = cell.y + .5 - position.y;
            const deltaZ = cell.z + .5 - position.z;
            if (cell.kind === 'oil' && deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ <=
                radiusInVoxels * radiusInVoxels) this.ignite(cell);
        }
    }

    private ignite(cell: LiquidCell): void {
        cell.kind = 'fire';
        cell.igniteAtTick = Infinity;
        cell.remainingTicks = fireDurationInSeconds * simulationTicksPerSecond;
        cell.nextIgnitionTick = this.tick + Math.ceil(fireIgnitionHopDelayInSeconds * simulationTicksPerSecond);
    }

    private flowCell(world: VoxelWorld, oldKey: number, cell: LiquidCell): void {
        const isFree = (x: number, y: number, z: number): boolean => world.contains(x, y, z) &&
            !world.isSolid(x, y, z) && !this.cells.has(this.key(x, y, z));
        let nextX = cell.x, nextY = cell.y, nextZ = cell.z;
        if (isFree(cell.x, cell.y - 1, cell.z)) nextY--;
        else {
            const downhill: Array<readonly [number, number]> = [];
            let lowestHeight = cell.y;
            for (const [offsetX, offsetZ] of adjacentOffsets) {
                const x = cell.x + offsetX, z = cell.z + offsetZ;
                if (!isFree(x, cell.y, z)) continue;
                let height = cell.y;
                while (isFree(x, height - 1, z)) height--;
                if (height < lowestHeight) {
                    downhill.length = 0;
                    lowestHeight = height;
                }
                if (height === lowestHeight && height < cell.y) downhill.push([x, z]);
            }
            if (downhill.length) [nextX, nextZ] = downhill[cell.random.int(0, downhill.length - 1)];
        }
        cell.isAtRest = nextX === cell.x && nextY === cell.y && nextZ === cell.z;
        if (!cell.isAtRest) {
            this.cells.delete(oldKey);
            cell.x = nextX;
            cell.y = nextY;
            cell.z = nextZ;
            this.cells.set(this.key(nextX, nextY, nextZ), cell);
        } else if (cell.spreadBudget > 0 && this.cells.size < liquidMaximumCellCount) {
            const options = adjacentOffsets.filter(([offsetX, offsetZ]) =>
                isFree(cell.x + offsetX, cell.y, cell.z + offsetZ) &&
                world.isSolid(cell.x + offsetX, cell.y - 1, cell.z + offsetZ));
            if (options.length) {
                const [offsetX, offsetZ] = options[cell.random.int(0, options.length - 1)];
                cell.spreadBudget--;
                this.addCell(world, { x: cell.x + offsetX, y: cell.y, z: cell.z + offsetZ }, {
                    kind: cell.kind, sourceSerial: cell.sourceSerial, ownerSeatIndex: cell.ownerSeatIndex,
                    randomSeed: cell.random.int(0, 0x7fffffff),
                    durationSeconds: cell.remainingTicks / simulationTicksPerSecond,
                    igniteAfterSeconds: cell.igniteAtTick === Infinity ? undefined
                        : Math.max(0, cell.igniteAtTick - this.tick) / simulationTicksPerSecond,
                    damagePerSecond: cell.damagePerSecond });
                cell.isAtRest = false;
            }
        }
    }

    public step(world: VoxelWorld, tanks: ReadonlyArray<Tank>, damage: DamageQueue): void {
        this.tick++;
        const snapshot = [...this.cells.entries()];
        for (const [, cell] of snapshot) if (cell.kind === 'oil' && this.tick >= cell.igniteAtTick) this.ignite(cell);
        for (const [, cell] of snapshot) if (cell.kind === 'fire' && this.tick >= cell.nextIgnitionTick) {
            for (const [offsetX, offsetZ] of adjacentOffsets) {
                const neighbour = this.cells.get(this.key(cell.x + offsetX, cell.y, cell.z + offsetZ));
                if (neighbour?.kind === 'oil') this.ignite(neighbour);
            }
            for (const offsetY of [-1, 1]) {
                const neighbour = this.cells.get(this.key(cell.x, cell.y + offsetY, cell.z));
                if (neighbour?.kind === 'oil') this.ignite(neighbour);
            }
            cell.nextIgnitionTick = this.tick + Math.ceil(fireIgnitionHopDelayInSeconds * simulationTicksPerSecond);
        }
        if (this.tick % liquidStepIntervalInTicks === 0)
            for (const [key, cell] of snapshot) if (this.cells.get(key) === cell) this.flowCell(world, key, cell);
        const orderedTanks = [...tanks].sort((first, second) => first.seatIndex - second.seatIndex);
        for (const tank of orderedTanks) {
            if (tank.isWreck) continue;
            const overlaps = new Map<number, LiquidCell>();
            const cosine = cosineOfRadians(tank.hullYawInRadians), sine = sineOfRadians(tank.hullYawInRadians);
            const cellProjection = .5 * (Math.abs(cosine) + Math.abs(sine));
            const halfWidth = tankHullWidthInVoxels / 2, halfLength = tankHullLengthInVoxels / 2;
            for (const cell of this.cells.values()) {
                if (cell.kind === 'oil') continue;
                const reach = cell.kind === 'fire' ? fireSplashRadiusInVoxels : 0;
                if (cell.y + 1 <= tank.position.y - reach ||
                    cell.y >= tank.position.y + tankHullHeightInVoxels + reach) continue;
                const deltaX = cell.x + .5 - tank.position.x, deltaZ = cell.z + .5 - tank.position.z;
                if (Math.abs(deltaX * cosine - deltaZ * sine) < halfWidth + cellProjection + reach &&
                    Math.abs(deltaX * sine + deltaZ * cosine) < halfLength + cellProjection + reach &&
                    Math.abs(deltaX) < halfWidth * Math.abs(cosine) + halfLength * Math.abs(sine) + .5 + reach &&
                    Math.abs(deltaZ) < halfWidth * Math.abs(sine) + halfLength * Math.abs(cosine) + .5 + reach)
                    overlaps.set(cell.sourceSerial, cell);
            }
            let remainders = this.burnRemainders.get(tank.seatIndex);
            if (!remainders) {
                remainders = new Map();
                this.burnRemainders.set(tank.seatIndex, remainders);
            }
            for (const [sourceSerial, cell] of overlaps) {
                let remainder = remainders.get(sourceSerial);
                if (!remainder) {
                    remainder = { numerator: 0, ownerSeatIndex: cell.ownerSeatIndex };
                    remainders.set(sourceSerial, remainder);
                }
                remainder.numerator += cell.damagePerSecond;
                const amount = Math.floor(remainder.numerator / simulationTicksPerSecond);
                if (amount > 0) {
                    remainder.numerator -= amount * simulationTicksPerSecond;
                    damage.enqueue(tank, amount,
                        orderedTanks.find(owner => owner.seatIndex === cell.ownerSeatIndex) ?? null);
                }
            }
        }
        for (const [key, cell] of this.cells) {
            cell.remainingTicks--;
            if (cell.remainingTicks <= 0) this.cells.delete(key);
        }
        this.flushExpiredSources(orderedTanks, damage);
    }

    private flushExpiredSources(tanks: ReadonlyArray<Tank>, damage: DamageQueue): void {
        const activeSources = new Set<number>();
        for (const cell of this.cells.values()) if (cell.kind !== 'oil') activeSources.add(cell.sourceSerial);
        for (const tank of tanks) {
            const remainders = this.burnRemainders.get(tank.seatIndex);
            if (!remainders) continue;
            for (const [sourceSerial, remainder] of remainders) if (!activeSources.has(sourceSerial)) {
                if (remainder.numerator > 0 && !tank.isWreck)
                    damage.enqueue(tank, remainder.numerator / simulationTicksPerSecond,
                        tanks.find(owner => owner.seatIndex === remainder.ownerSeatIndex) ?? null);
                remainders.delete(sourceSerial);
            }
        }
    }

    public get isActive(): boolean {
        for (const cell of this.cells.values())
            if (cell.kind === 'fire' || !cell.isAtRest || cell.igniteAtTick !== Infinity) return true;
        return false;
    }

    public finishResolve(world: VoxelWorld, tanks: ReadonlyArray<Tank>, damage: DamageQueue): void {
        for (const [key, cell] of this.cells) if (cell.kind !== 'oil') {
            if (cell.kind === 'lava') setVoxel(world, cell.x, cell.y, cell.z, Material.ASH);
            this.cells.delete(key);
        }
        this.flushExpiredSources(tanks, damage);
    }

    public appendHash(hash: StateHash): void {
        hash.unsignedInteger(this.mapEdgeLengthInVoxels).unsignedInteger(this.tick).unsignedInteger(this.cells.size);
        for (const [key, cell] of this.cells)
            hash.number(key).number(cell.x).number(cell.y).number(cell.z)
                .string(cell.kind).number(cell.sourceSerial).number(cell.ownerSeatIndex)
                .number(cell.remainingTicks).number(cell.spreadBudget).number(cell.damagePerSecond)
                .number(cell.nextIgnitionTick).number(cell.igniteAtTick).byte(cell.isAtRest ? 1 : 0)
                .number(cell.random.seed).number(cell.random.currentState);

        hash.unsignedInteger(this.burnRemainders.size);
        for (const [seatIndex, remainders] of this.burnRemainders) {
            hash.number(seatIndex).unsignedInteger(remainders.size);
            for (const [sourceSerial, remainder] of remainders)
                hash.number(sourceSerial).number(remainder.numerator).number(remainder.ownerSeatIndex);
        }
    }
}
