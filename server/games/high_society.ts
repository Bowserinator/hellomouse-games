import crypto from 'node:crypto';
import Game from '../game.js';
import Client from '../client.js';
import { Engine, isForcedPass } from '../../client/high_society/js/engine.js';
import { decide } from '../../client/high_society/js/ai.js';
import type { Move, Sync, Settings } from '../../client/high_society/js/types.js';

export const AUTO_PASS_MS = 3000;

export default class HighSocietyGame extends Game {
    engine: Engine | null = null;
    settings: Settings = { seats: 4 };
    private held = new Map<number, { username: string; ready: boolean }>();
    private tokens: Array<string> = [];
    private observers = new Set<Client>();
    private seen = new Map<Client, number>();
    private humanSeats = 0;
    private replaced = new Set<number>();
    private timer: ReturnType<typeof setTimeout> | null = null;
    private animationUntil = 0;
    private autoPassTimer: ReturnType<typeof setTimeout> | null = null;
    private autoPass: { engine: Engine; seat: number; seq: number; deadline: number } | null = null;
    private autoPassMs: number;

    constructor({ autoPassMs = AUTO_PASS_MS }: { autoPassMs?: number } = {}) {
        super({ syncAfterMove: false, allowChat: false });
        this.autoPassMs = autoPassMs;
    }
    onRoomCreate(): void {
        this.syncAll();
    }
    onJoin(client: Client): boolean {
        if (this.players.includes(client) || this.observers.has(client)) return false;
        if (this.engine) {
            if (this.observers.size >= 8) return false;
            client.gameID = this.uuid;
            this.observers.add(client);
            this.seen.set(client, this.engine.events.at(-1)?.seq ?? 0);
        } else if (this.playerCount >= this.settings.seats || !super.onJoin(client)) return false;
        this.syncAll();
        return true;
    }
    onDisconnect(client: Client): void {
        const seat = this.players.indexOf(client);
        if (this.engine && seat !== -1) this.held.set(seat, { username: client.username, ready: client.ready });
        super.onDisconnect(client);
        this.observers.delete(client);
        this.seen.delete(client);
        if (!this.engine) this.players = this.players.filter(p => p !== null);
        this.broadcastWhoYouAre();
        this.syncAll();
    }
    onUsernameChange(): void {
        this.syncAll();
    }
    onReady(): void {
        this.syncAll();
    }
    private error(client: Client, error: string): void {
        client.connection.sendUTF(JSON.stringify({ type: 'ERROR', code: 'MOVE', error }));
    }
    onMove(client: Client, move: Move): void {
        if (!move || typeof move.action !== 'string') return this.error(client, 'Invalid move');
        const seat = this.players.indexOf(client);
        const host = this.players.find(p => p !== null) === client;
        if (move.action === 'RESUME' && this.engine) {
            const index = typeof move.token === 'string' ? this.tokens.indexOf(move.token) : -1;
            const held = this.held.get(index);
            if (seat !== -1 || !held || !this.observers.has(client))
                return this.error(client, 'Your seat cannot be resumed. It may have been taken over by a CPU.');
            client.username = held.username;
            client.ready = held.ready;
            this.players[index] = client;
            this.playerCount++;
            this.held.delete(index);
            this.observers.delete(client);
            this.seen.set(client, this.engine.events.at(-1)?.seq ?? 0);
            this.broadcastWhoYouAre();
            this.syncAll();
            return;
        }
        if (seat === -1) return this.error(client, 'You are watching. Resume your seat or create a new room.');
        if (move.action === 'RETURN_TO_LOBBY') {
            if (this.engine?.phase !== 'gameEnd') return this.error(client, 'The game has not ended');
            this.clearTimer();
            this.clearAutoPass();
            this.engine = null;
            this.config.holdEmptySeats = false;
            this.animationUntil = 0;
            this.players = this.players.filter(p => p !== null);
            this.playerCount = this.players.length;
            for (const p of this.players) if (p) p.ready = false;
            this.tokens = [];
            this.held.clear();
            this.replaced.clear();
            this.seen.clear();
            this.broadcastWhoYouAre();
        } else if (move.action === 'REPLACE_WITH_CPU') {
            if (!host) return this.error(client, 'Only the host can replace a player');
            if (!this.engine || !Number.isInteger(move.seat) || !this.held.has(move.seat!))
                return this.error(client, 'Only an offline human seat can be replaced');
            this.replaced.add(move.seat!);
            this.held.delete(move.seat!);
            this.tokens[move.seat!] = '';
        } else if (move.action === 'SET_OPTIONS' || move.action === 'START_GAME') {
            if (this.engine) return this.error(client, 'Settings are locked after starting');
            if (!host) return this.error(client, 'Only the host can do that');
            if (move.action === 'SET_OPTIONS') {
                if (typeof move.seats !== 'number' || !Number.isInteger(move.seats) ||
                    move.seats < 3 || move.seats > 5 || move.seats < this.playerCount)
                    return this.error(client, 'Choose 3–5 seats, with room for every human');
                this.settings = { seats: move.seats };
            } else {
                if (!this.playerCount || !this.everyoneReady()) return this.error(client, 'Every human must be ready');
                this.humanSeats = this.players.length;
                this.tokens = this.players.map(() => crypto.randomBytes(24).toString('hex'));
                this.engine = new Engine(this.settings);
                this.config.holdEmptySeats = true;
                for (const p of this.players) if (p) this.seen.set(p, 0);
                this.animationUntil = Date.now() + 700;
            }
        } else {
            if (!this.engine) return this.error(client, 'Start the game first');
            const error = this.act(seat, move);
            if (error) return this.error(client, error);
        }
        this.syncAll();
    }
    private act(seat: number, move: Move, auto = false): string | null {
        if (!this.engine) return 'No active game';
        const since = this.engine.events.length;
        const error = this.engine.dispatch(seat, move, auto);
        if (!error) {
            this.clearTimer();
            this.clearAutoPass();
            const revealed = this.engine.events.slice(since).some(e => e.type === 'reveal');
            this.animationUntil = Date.now() + (revealed ? 1200 : 450);
        }
        return error;
    }
    private isCPU(seat: number): boolean {
        return seat >= this.humanSeats || this.replaced.has(seat);
    }
    globalStateSync(client: Client): Sync {
        const seat = this.players.indexOf(client);
        const view = this.engine?.view(seat, this.seen.get(client) ?? this.engine.events.at(-1)?.seq ?? 0);
        if (view && this.autoPass) view.autoPass = {
            seat: this.autoPass.seat, remainingMs: Math.max(0, this.autoPass.deadline - Date.now())
        };
        if (this.engine) this.seen.set(client, this.engine.events.at(-1)?.seq ?? 0);
        const humans = this.engine ? this.humanSeats : this.players.length;
        return {
            type: 'SYNC', started: !!this.engine, youAre: seat,
            isHost: this.players.find(p => p !== null) === client, settings: { ...this.settings },
            seats: Array.from({ length: this.settings.seats }, (_, i) => {
                const ai = i >= humans || this.replaced.has(i);
                return {
                    username: ai ? `CPU ${i + 1}` : this.players[i]?.username ??
                        this.held.get(i)?.username ?? `Player ${i + 1}`,
                    ai, ready: ai || (this.players[i]?.ready ?? false), connected: ai || !!this.players[i]
                };
            }),
            ...(seat !== -1 && this.engine ? { token: this.tokens[seat] } : {}), ...(view ? { view } : {})
        };
    }
    private syncAll(): void {
        this.scheduleAutoPass();
        for (const c of [...this.players, ...this.observers]) if (c)
            try {
                c.connection.sendUTF(JSON.stringify(this.globalStateSync(c)));
            } catch {/* The connection lifecycle handles disconnects. */}
        this.schedule();
    }
    private clearTimer(): void {
        if (this.timer !== null) clearTimeout(this.timer);
        this.timer = null;
    }
    private clearAutoPass(): void {
        if (this.autoPassTimer !== null) clearTimeout(this.autoPassTimer);
        this.autoPassTimer = null;
        this.autoPass = null;
    }
    private scheduleAutoPass(): void {
        const engine = this.engine;
        if (!engine || this.isCPU(engine.turn) || !isForcedPass(engine, engine.turn)) {
            this.clearAutoPass();
            return;
        }
        const seat = engine.turn, seq = engine.events.length;
        if (this.autoPass?.engine === engine && this.autoPass.seat === seat && this.autoPass.seq === seq) return;
        this.clearAutoPass();
        const deadline = Math.max(Date.now(), this.animationUntil) + this.autoPassMs;
        const pending = { engine, seat, seq, deadline };
        this.autoPass = pending;
        this.autoPassTimer = setTimeout(() => {
            if (this.autoPass !== pending) return;
            this.clearAutoPass();
            if (this.engine !== engine || engine.events.length !== seq || engine.turn !== seat ||
                this.isCPU(seat) || !isForcedPass(engine, seat)) return;
            this.act(seat, { action: 'PASS' }, true);
            this.syncAll();
        }, deadline - Date.now());
    }
    private schedule(): void {
        if (!this.engine || !this.players.some(p => p !== null)) {
            this.clearTimer();
            return;
        }
        const engine = this.engine;
        const actor = engine.turn;
        if (this.timer !== null || engine.phase === 'gameEnd' || !this.isCPU(actor)) return;
        this.timer = setTimeout(() => {
            this.timer = null;
            if (this.engine !== engine || !this.players.some(p => p !== null)) return;
            const error = this.act(actor, decide(engine.view(actor, Infinity)));
            if (error) {
                console.warn(`High Society AI: ${error}`);
                this.act(actor, engine.phase === 'fauxPas' ? { action: 'CHOOSE_DISCARD',
                    id: engine.status[actor].find(c => c.kind === 'luxury')!.id } : { action: 'PASS' });
            }
            this.syncAll();
        }, Math.max(0, this.animationUntil - Date.now()) + 900);
    }
    onRemove(): void {
        this.clearTimer();
        this.clearAutoPass();
        this.engine = null;
        this.held.clear();
        this.observers.clear();
        this.seen.clear();
        this.tokens = [];
        this.replaced.clear();
    }
}
