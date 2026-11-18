/**
 * Round state and collision rules. Every racer moves one cell per tick in a straight line
 * until it turns, so any client can work out where a racer is at a given tick. Each client
 * decides the fate of its own racer and corrects the others when turn or death reports arrive.
 */
import type { Spawn } from './types.js';

export const DX = [0, 1, 0, -1];
export const DY = [-1, 0, 1, 0];

export interface Racer {
    x: number;
    y: number;
    prevX: number;
    prevY: number;
    moveAt: number;
    dir: number;
    alive: boolean;
    active: boolean;
    halted: boolean;
    tick: number;
    path: Array<number>;
}

export interface Turn {
    t: number;
    cell: number;
    dir: number;
}

const MAX_QUEUED_TURNS = 3;

export class Arena {
    size = 0;
    me = -1;
    racers: Array<Racer> = [];
    owner = new Int8Array(0);
    stepMs = 1;
    frozen = true;
    selfDeathTick: number | null = null;
    pendingTurns: Array<Turn> = [];
    private stamp = new Int32Array(0);
    private queue: Array<number> = [];
    private startAt = 0;

    reset(size: number, spawns: Array<Spawn | null>, me: number, stepMs: number, startAt: number) {
        this.size = size;
        this.me = me;
        this.stepMs = stepMs;
        this.startAt = startAt;
        this.owner = new Int8Array(size * size);
        this.stamp = new Int32Array(size * size);
        this.queue = [];
        this.pendingTurns = [];
        this.selfDeathTick = null;
        this.frozen = false;
        this.racers = spawns.map((spawn, seat) => {
            if (!spawn) {
                return {
                    x: 0, y: 0, prevX: 0, prevY: 0, moveAt: 0, dir: 0,
                    alive: false, active: false, halted: false, tick: 0, path: []
                };
            }
            const cell = spawn.y * size + spawn.x;
            this.owner[cell] = seat + 1;
            return {
                x: spawn.x, y: spawn.y, prevX: spawn.x, prevY: spawn.y, moveAt: 0, dir: spawn.dir,
                alive: true, active: true, halted: false, tick: 0, path: [cell]
            };
        });
    }

    turn(dir: number) {
        const racer = this.racers[this.me];
        if (this.frozen || !racer || !racer.alive) return;
        const last = this.queue.length ? this.queue[this.queue.length - 1] : racer.dir;
        if (dir === last || dir === (last + 2) % 4) return;
        if (this.queue.length < MAX_QUEUED_TURNS) this.queue.push(dir);
    }

    /** Move every racer forward to the tick due at the given time */
    update(now: number) {
        if (this.frozen) return;
        const due = Math.floor((now - this.startAt) / this.stepMs);
        const moving = this.racers.filter(racer => racer.active && racer.alive && !racer.halted);
        if (!moving.length) return;

        for (let tick = Math.min(...moving.map(racer => racer.tick)) + 1; tick <= due; tick++)
            this.racers.forEach((racer, seat) => {
                if (racer.active && racer.alive && !racer.halted && racer.tick === tick - 1)
                    this.stepRacer(racer, seat, tick);
            });
    }

    private stepRacer(racer: Racer, seat: number, tick: number) {
        const isMe = seat === this.me;
        if (isMe) {
            const next = this.queue.shift();
            if (next !== undefined) {
                racer.dir = next;
                this.pendingTurns.push({ t: racer.tick, cell: racer.path[racer.tick], dir: next });
            }
        }

        const x = racer.x + DX[racer.dir];
        const y = racer.y + DY[racer.dir];
        const cell = y * this.size + x;
        const outside = x < 0 || y < 0 || x >= this.size || y >= this.size;
        const occupant = outside ? 0 : this.owner[cell];

        if (outside || (occupant !== 0 && !this.canEnter(seat, tick, cell, occupant))) {
            // Meeting head-on counts as reaching the cell, so both racers die on the same tick
            const headOn = !outside && this.stamp[cell] === tick;
            if (isMe) this.killSelf(headOn ? tick : racer.tick);
            else racer.halted = true;
            return;
        }
        this.place(racer, seat, tick, cell);
    }

    /** Whether the racer may take a cell that is already marked, deciding collisions with the local racer */
    private canEnter(seat: number, tick: number, cell: number, occupant: number): boolean {
        if (occupant === seat + 1) return false;
        if (seat === this.me) return this.stamp[cell] > tick;

        const me = this.racers[this.me];
        if (occupant === this.me + 1 && me?.alive && this.stamp[cell] >= tick) this.killSelf(this.stamp[cell]);
        return false;
    }

    private place(racer: Racer, seat: number, tick: number, cell: number) {
        racer.prevX = racer.x;
        racer.prevY = racer.y;
        racer.moveAt = this.startAt + tick * this.stepMs;
        racer.tick = tick;
        racer.x = cell % this.size;
        racer.y = Math.floor(cell / this.size);
        racer.path[tick] = cell;
        this.owner[cell] = seat + 1;
        this.stamp[cell] = tick;
    }

    private killSelf(finalTick: number) {
        this.racers[this.me].alive = false;
        this.selfDeathTick = finalTick;
        this.truncate(this.me, finalTick);
    }

    /** Forget a racer's cells after the given tick */
    private truncate(seat: number, finalTick: number) {
        const racer = this.racers[seat];
        for (let tick = racer.path.length - 1; tick > finalTick; tick--) {
            const cell = racer.path[tick];
            if (cell !== undefined && this.owner[cell] === seat + 1 && this.stamp[cell] === tick) {
                this.owner[cell] = 0;
                this.stamp[cell] = 0;
            }
        }
        if (racer.path.length > finalTick + 1) racer.path.length = finalTick + 1;
        if (racer.tick > finalTick) racer.tick = finalTick;
        this.syncPosition(racer);
    }

    private syncPosition(racer: Racer) {
        const cell = racer.path[racer.tick];
        const previous = racer.path[racer.tick - 1] ?? cell;
        racer.x = cell % this.size;
        racer.y = Math.floor(cell / this.size);
        racer.prevX = previous % this.size;
        racer.prevY = Math.floor(previous / this.size);
        racer.moveAt = this.startAt + racer.tick * this.stepMs;
    }

    /** Another racer reports being at a cell on a tick and heading a new direction from there */
    applyTurn(seat: number, t: number, cell: number, dir: number) {
        const racer = this.racers[seat];
        if (!racer || !racer.active || !racer.alive || seat === this.me || cell < 0 || cell >= this.owner.length)
            return;

        while (racer.tick < t && !racer.halted && racer.alive) this.stepRacer(racer, seat, racer.tick + 1);
        if (racer.path[t] !== cell || racer.tick !== t) {
            this.truncate(seat, Math.min(racer.tick, t - 1));
            racer.halted = false;
            racer.tick = t;
            this.place(racer, seat, t, cell);
        } else this.truncate(seat, t);

        racer.dir = dir;
        racer.halted = false;
    }

    /** Another racer died after last occupying a cell on the given tick */
    applyDeath(seat: number, t: number) {
        const racer = this.racers[seat];
        if (!racer || !racer.active || seat === this.me) return;
        racer.alive = false;
        if (racer.path.length) this.truncate(seat, Math.min(racer.tick, Math.max(0, t)));
    }

    /** Head position in fractional cells, eased from the previous cell */
    visualPosition(racer: Racer, now: number): { x: number; y: number } {
        const progress = racer.alive ? Math.min(1, Math.max(0, (now - racer.moveAt) / this.stepMs)) : 1;
        return {
            x: racer.prevX + (racer.x - racer.prevX) * progress,
            y: racer.prevY + (racer.y - racer.prevY) * progress
        };
    }

    aliveSeats(): Array<number> {
        return this.racers.flatMap((racer, seat) => racer.alive ? [seat] : []);
    }
}
