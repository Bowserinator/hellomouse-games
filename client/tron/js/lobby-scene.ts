/** Decorative lobby background of computer-driven cycles that restarts periodically. */
import { Arena, DX, DY } from './arena.js';
import type { Racer } from './arena.js';
import { COLORS } from './config.js';
import { CELL_PX } from './render.js';
import type { Camera } from './render.js';

const CYCLE_COUNT = 4;
const RESET_MS = 5000;
const STEP_MS = 110;
const LOOKAHEAD = 12;
const TURN_CHANCE = 0.05;
const SPAWN_MARGIN = 4;

export class LobbyScene {
    readonly arena = new Arena();
    readonly camera: Camera = { x: 0, y: 0 };
    colors: Array<string> = [];
    private startedAt = 0;

    update(now: number) {
        if (now - this.startedAt >= RESET_MS) this.reset(now);

        const due = Math.floor((now - this.startedAt) / STEP_MS);
        this.arena.racers.forEach((racer, seat) => {
            while (racer.alive && racer.tick < due) this.step(racer, seat);
        });
    }

    private reset(now: number) {
        const cells = Math.ceil(Math.max(window.innerWidth, window.innerHeight) / CELL_PX) + 2;
        const size = Math.min(400, Math.max(32, cells));
        const range = size - 2 * SPAWN_MARGIN;
        const spawns = Array.from({ length: CYCLE_COUNT }, () => ({
            x: SPAWN_MARGIN + Math.floor(Math.random() * range),
            y: SPAWN_MARGIN + Math.floor(Math.random() * range),
            dir: Math.floor(Math.random() * 4)
        }));

        this.startedAt = now;
        this.arena.reset(size, spawns, -1, STEP_MS, now);
        this.camera.x = size / 2;
        this.camera.y = size / 2;
        this.colors = [...COLORS].sort(() => Math.random() - 0.5).slice(0, CYCLE_COUNT);
    }

    /** Number of free cells in a straight line, up to the lookahead */
    private clearance(x: number, y: number, dir: number): number {
        const { size, owner } = this.arena;
        for (let i = 1; i <= LOOKAHEAD; i++) {
            const nx = x + DX[dir] * i;
            const ny = y + DY[dir] * i;
            if (nx < 0 || ny < 0 || nx >= size || ny >= size || owner[ny * size + nx]) return i - 1;
        }
        return LOOKAHEAD;
    }

    private step(racer: Racer, seat: number) {
        const straight = this.clearance(racer.x, racer.y, racer.dir);
        const turns = [(racer.dir + 1) % 4, (racer.dir + 3) % 4]
            .map(dir => ({ dir, room: this.clearance(racer.x, racer.y, dir) }))
            .filter(turn => turn.room > 0);

        if (turns.length && (straight < 3 || Math.random() < TURN_CHANCE))
            racer.dir = turns.sort((a, b) => b.room - a.room + Math.random() - 0.5)[0].dir;
        else if (!straight && !turns.length) {
            racer.alive = false;
            return;
        }

        racer.tick++;
        racer.prevX = racer.x;
        racer.prevY = racer.y;
        racer.moveAt = this.startedAt + racer.tick * STEP_MS;
        racer.x += DX[racer.dir];
        racer.y += DY[racer.dir];
        this.arena.owner[racer.y * this.arena.size + racer.x] = seat + 1;
    }
}
