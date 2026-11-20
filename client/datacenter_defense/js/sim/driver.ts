import type { World } from '../mapx.js';
import { COMMAND_DELAY_TICKS, MAX_COMMANDS, orderedCommands, type Command } from './commands.js';
import { SimCore, type RenderSnapshot, type SimOptions } from './core.js';
import { TICK_HZ } from './fixed.js';
import type { TickBundle } from './lockstep.js';
import { PAUSE_COOLDOWN_MS, type LobbyPlayer } from '../shared/protocol.js';

export interface DriverOptions extends SimOptions {
    local?: boolean; player?: number; slot?: number; roster?: ReadonlyArray<LobbyPlayer>;
}

export class SimDriver {
    tickMilliseconds?: number;
    slot = 0;
    roster: ReadonlyArray<LobbyPlayer> = [];
    readonly selections = new Map<number, Array<number>>();
    onSelection?: (ids: Array<number>) => void;
    result?: { outcome: 'victory' | 'defeat'; tick: number };
    onGameEnd?: (result: { outcome: 'victory' | 'defeat'; tick: number }) => void;
    onSnapshot?: (snapshot: RenderSnapshot) => void;
    onStall?: (stalled: boolean) => void;
    onDesync?: (tick: number) => void;
    onCommand?: (command: Command) => void;
    onError?: (error: Error) => void;
    onPauseChange?: (paused: boolean) => void;
    onPauseRequest?: (paused: boolean) => void;
    onTick?: (tick: number) => void;
    onHash?: (tick: number, hash: number) => void;
    private cooldownUntil = 0;
    private resumedTick = 0;
    private pending = new Map<number, Array<Command>>();
    private sequence = 0;
    private sent = new Map<number, number>();
    private accumulator = 0;
    private last = 0;
    private timer?: ReturnType<typeof setTimeout>;
    private running = false;
    private paused = false;
    private busy = false;
    private stalled = false;
    private stopped = false;
    constructor(readonly core: SimCore, readonly local = true, readonly player = 0) {
        if (!core.lockstep.players.includes(player)) throw Error('Unknown driver player');
        this.slot = player;
    }
    static async create(gpu: GPU, world: World, options: DriverOptions = {}): Promise<SimDriver> {
        let driver: SimDriver | undefined;
        const core = await SimCore.create(gpu, world, {
            ...options,
            hashInterval: world.rules ? 1 : options.hashInterval,
            onHash: (tick, hash, hp, blocked) => {
                options.onHash?.(tick, hash, hp, blocked);
                driver?.onHash?.(tick, hash);
                if (driver && !driver.result && world.rules && (hp === 0 || tick >= world.rules.winTime * TICK_HZ)) {
                    driver.result = { outcome: hp === 0 ? 'defeat' : 'victory', tick };
                    driver.pause();
                    driver.onGameEnd?.(driver.result);
                }
            },
            onSnapshot: snapshot => {
                options.onSnapshot?.(snapshot); driver?.onSnapshot?.(snapshot);
            },
            onError: error => {
                options.onError?.(error); driver?.onError?.(error);
            }
        });
        driver = new SimDriver(core, options.local ?? (options.players?.length ?? 1) === 1,
            options.player ?? options.players?.[0] ?? 0);
        driver.slot = options.slot ?? driver.player;
        driver.roster = options.roster ?? [];
        return driver;
    }
    get commandCapacity() {
        return MAX_COMMANDS - (this.sent.get(this.core.tick + COMMAND_DELAY_TICKS) ?? 0);
    }
    submit(input: Omit<Command, 'player' | 'seq' | 'targetTick'>): Command {
        if (!this.commandCapacity) throw Error('Command tick is full');
        if (this.stopped || this.core.lockstep.frozen) throw Error('Simulation is not accepting commands');
        const targetTick = this.core.tick + COMMAND_DELAY_TICKS;
        const command = { ...input, payload: input.payload.slice(), player: this.player, source: this.slot,
            seq: this.sequence, targetTick };
        const pending = this.pending.get(targetTick) ?? [];
        const ordered = orderedCommands([...pending, command], targetTick);
        this.sequence++;
        this.sent.set(targetTick, (this.sent.get(targetTick) ?? 0) + 1);
        for (const tick of this.sent.keys()) if (tick < this.core.tick) this.sent.delete(tick);
        if (this.local) this.pending.set(targetTick, ordered);
        this.onCommand?.(command);
        return command;
    }
    receive(bundle: TickBundle) {
        this.core.lockstep.submit(bundle);
    }
    start(now = performance.now()) {
        if (this.stopped) throw Error('Simulation stopped');
        if (this.running) return;
        this.running = true; this.last = now;
        const pulse = () => {
            if (!this.running) return;
            this.advance(performance.now());
            if (this.running) this.timer = setTimeout(pulse, 10);
        };
        this.timer = setTimeout(pulse, 10);
    }
    get isPaused() {
        return this.paused;
    }
    get pauseCooldownRemaining() {
        return Math.max(0, this.cooldownUntil - performance.now());
    }
    setPauseCooldown(milliseconds: number) {
        this.cooldownUntil = performance.now() + Math.max(0, milliseconds);
    }
    requestPause(paused = !this.isPaused) {
        if (this.result || this.core.lockstep.frozen || paused === this.isPaused ||
            paused && this.pauseCooldownRemaining) return;
        if (!this.local) {
            this.onPauseRequest?.(paused); return;
        }
        if (!paused) this.setPauseCooldown(PAUSE_COOLDOWN_MS);
        this.pause(paused);
    }
    resumeAt(tick: number) {
        if (this.result || this.core.lockstep.frozen) return;
        this.resumedTick = Math.max(this.resumedTick, tick);
        this.pause(false);
    }
    pause(paused = true) {
        if (this.paused === paused) return;
        this.paused = paused; this.last = performance.now();
        this.onPauseChange?.(paused);
    }
    advance(now: number) {
        if (this.stopped || this.paused || this.result) {
            this.last = now; return;
        }
        const duration = 1000 / TICK_HZ;
        this.accumulator += Math.max(0, now - this.last); this.last = now;
        if (this.busy || this.accumulator < duration) return;
        try {
            const mismatch = this.core.lockstep.frozen;
            if (mismatch) {
                this.onDesync?.(mismatch.tick);
                throw Error(`Desync at tick ${mismatch.tick}; restore a host snapshot`);
            }
            const started = performance.now();
            let completed = 0;
            const steps = Math.min(this.core.nav.winTick === undefined ? 4 : 1,
                Math.floor(this.accumulator / duration));
            for (let i = 0; i < steps; i++) {
                const tick = this.core.tick;
                if (this.local) this.receive({ tick, commands: this.pending.get(tick) ?? [],
                    acknowledgements: [...this.core.lockstep.players] });
                if (!this.core.step(false)) {
                    this.accumulator = duration;
                    if (!this.stalled) this.onStall?.(true);
                    this.stalled = true; break;
                }
                const control = this.core.commandLog[this.core.commandLog.length - 1]?.control;
                if (control === 'pause' && this.resumedTick < this.core.tick) this.pause();
                this.pending.delete(tick);
                if (this.stalled) this.onStall?.(false);
                this.stalled = false; this.accumulator -= duration; completed++;
                if (this.paused) break;
            }
            if (!completed) return;
            this.busy = true;
            const settled = this.core.nav.winTick === undefined
                ? this.core.device.queue.onSubmittedWorkDone() : this.core.idle();
            void settled.then(() => {
                this.busy = false;
                if (!this.stopped) {
                    this.tickMilliseconds = (performance.now() - started) / completed;
                    this.onTick?.(this.core.tick);
                }
            }).catch(error => this.fail(error));
        } catch (error) {
            this.fail(error);
        }
    }
    get renderTick() {
        return this.core.tick - 1 + Math.min(1, this.accumulator * TICK_HZ / 1000);
    }
    private fail(error: unknown) {
        if (this.stopped) return;
        this.running = false;
        if (this.timer !== undefined) clearTimeout(this.timer);
        this.onError?.(error instanceof Error ? error : Error(String(error)));
    }
    stop() {
        if (this.stopped) return;
        this.stopped = true; this.running = false;
        if (this.timer !== undefined) clearTimeout(this.timer);
        this.pending.clear(); this.core.destroy();
    }
}
