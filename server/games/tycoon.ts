import crypto from 'node:crypto';
import Game from '../game.js';
import Client from '../client.js';
import { Engine } from '../../client/tycoon/js/engine.js';
import { decide } from '../../client/tycoon/js/ai.js';
import { eventDuration } from '../../client/tycoon/js/ui/timing.js';
import type { Move, Sync } from '../../client/tycoon/js/types.js';

export default class TycoonGame extends Game {
    engine: Engine | null = null;
    settings = { rounds: 3, jokers: true };
    private held = new Map<number, { username: string; ready: boolean }>();
    private tokens: Array<string> = [];
    private observers = new Set<Client>();
    private seen = new Map<Client, number>();
    private humanSeats = 0;
    private timers = new Set<ReturnType<typeof setTimeout>>();
    private continued = new Set<number>();
    private animationUntil = 0;

    constructor() {
        super({ syncAfterMove: false, allowChat: false });
    }
    onRoomCreate(): void {
        this.syncAll();
    }
    onJoin(client: Client): boolean {
        if (this.engine) {
            if (this.observers.size >= 8 || this.players.includes(client) || this.observers.has(client)) return false;
            client.gameID = this.uuid; this.observers.add(client);
            this.seen.set(client, this.engine.events.at(-1)?.seq ?? 0);
        } else if (this.playerCount >= 4 || !super.onJoin(client)) return false;
        this.syncAll(); return true;
    }
    onDisconnect(client: Client): void {
        const seat = this.players.indexOf(client);
        if (this.engine && seat !== -1) this.held.set(seat, { username: client.username, ready: client.ready });
        super.onDisconnect(client); this.observers.delete(client); this.seen.delete(client);
        if (!this.engine) this.players = this.players.filter(p => p !== null);
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
    onMove(client: Client, move: Move & { token?: unknown; rounds?: unknown; jokers?: unknown }): void {
        if (!move || typeof move.action !== 'string') return this.error(client, 'Invalid move');
        let seat = this.players.indexOf(client);
        if (move.action === 'RESUME' && this.engine) {
            const index = typeof move.token === 'string' ? this.tokens.indexOf(move.token) : -1;
            const held = this.held.get(index);
            if (seat !== -1 || !held || !this.observers.has(client)) return this.error(client, 'Seat cannot be resumed');
            client.username = held.username; client.ready = held.ready;
            this.players[index] = client; this.playerCount++; this.held.delete(index); this.observers.delete(client);
            this.seen.set(client, this.engine.events.at(-1)?.seq ?? 0);
            this.broadcastWhoYouAre(); this.syncAll(); return;
        }
        seat = this.players.indexOf(client);
        if (seat === -1) return this.error(client, 'You are watching. Resume your seat or create a new game.');
        if (move.action === 'RETURN_TO_LOBBY') {
            if (this.engine?.phase !== 'gameEnd') return this.error(client, 'The game has not ended');
            this.clearTimers(); this.engine = null; this.config.holdEmptySeats = false;
            this.players = this.players.filter(p => p !== null); this.playerCount = this.players.length;
            for (const p of this.players) if (p) p.ready = false;
            this.tokens = []; this.held.clear(); this.continued.clear(); this.seen.clear();
            this.broadcastWhoYouAre(); this.syncAll(); return;
        }
        if (move.action === 'SET_OPTIONS' || move.action === 'START_GAME') {
            if (this.engine) return this.error(client, 'Settings are locked after starting');
            if (this.players.find(p => p !== null) !== client) return this.error(client, 'Only the host can do that');
            if (move.action === 'SET_OPTIONS') {
                if (typeof move.jokers !== 'boolean' || typeof move.rounds !== 'number' ||
                    !Number.isInteger(move.rounds) || move.rounds < 1 || move.rounds > 20)
                    return this.error(client, 'Choose 1–20 integer rounds and a joker toggle');
                this.settings = { rounds: move.rounds, jokers: move.jokers };
            } else {
                if (!this.playerCount || !this.everyoneReady()) return this.error(client, 'Every human must be ready');
                this.humanSeats = this.players.length;
                this.tokens = this.players.map(() => crypto.randomBytes(24).toString('hex'));
                this.engine = new Engine(this.settings); this.continued.clear();
                this.config.holdEmptySeats = true;
                for (const p of this.players) if (p) this.seen.set(p, 0);
                this.animationUntil = Date.now() + eventDuration(this.engine.events);
            }
        } else {
            if (!this.engine) return this.error(client, 'Start the game first');
            if (move.action === 'CONTINUE' && this.engine.phase === 'roundEnd') {
                this.continued.add(seat);
                if (this.players.some((p, i) => p && !this.continued.has(i))) {
                    this.syncAll(); return;
                }
            }
            const error = this.act(seat, move);
            if (error) this.error(client, error);
        }
        this.syncAll();
    }
    private act(seat: number, move: Move): string | null {
        if (!this.engine) return 'No active game';
        const since = this.engine.events.length;
        const error = this.engine.dispatch(seat, move);
        if (!error) {
            this.clearTimers();
            this.animationUntil = Math.max(Date.now(), this.animationUntil) +
                eventDuration(this.engine.events.slice(since));
            if (move.action === 'CONTINUE') this.continued.clear();
        }
        return error;
    }
    globalStateSync(client: Client): Sync {
        const seat = this.players.indexOf(client);
        const view = this.engine?.view(seat, this.seen.get(client) ?? this.engine.events.at(-1)?.seq ?? 0);
        if (this.engine) this.seen.set(client, this.engine.events.at(-1)?.seq ?? 0);
        return {
            type: 'SYNC', started: !!this.engine, youAre: seat,
            isHost: this.players.find(p => p !== null) === client, settings: { ...this.settings },
            seats: Array.from({ length: 4 }, (_, i) => {
                const ai = i >= (this.engine ? this.humanSeats : this.players.length);
                return {
                    username: ai ? `CPU ${i - (this.engine ? this.humanSeats : this.players.length) + 1}`
                        : this.players[i]?.username ?? this.held.get(i)?.username ?? `Player ${i + 1}`,
                    ai, ready: ai || (this.players[i]?.ready ?? false), connected: ai || !!this.players[i]
                };
            }),
            ...(seat !== -1 && this.engine ? { token: this.tokens[seat] } : {}), ...(view ? { view } : {})
        };
    }
    private syncAll(): void {
        for (const c of [...this.players, ...this.observers]) if (c)
            try {
                c.connection.sendUTF(JSON.stringify(this.globalStateSync(c)));
            } catch {/* The connection lifecycle handles disconnects. */}

        this.schedule();
    }
    private clearTimers(): void {
        for (const timer of this.timers) clearTimeout(timer);
        this.timers.clear();
    }
    private schedule(): void {
        if (!this.engine || !this.players.some(p => p !== null)) {
            this.clearTimers(); return;
        }
        if (this.timers.size || this.engine.phase === 'gameEnd') return;
        const engine = this.engine;
        const autoPass = engine.phase === 'play' && engine.table !== null && !engine.legalPlays(engine.turn).length;
        const actor = engine.phase === 'exchange'
            ? [...engine.pendingExchange.keys()].find(i => i >= this.humanSeats && engine.view(i, Infinity).exchange)
            : engine.phase === 'play' && (autoPass || engine.turn >= this.humanSeats) ? engine.turn : undefined;
        if (engine.phase !== 'roundEnd' && actor === undefined) return;
        const thinkTime = autoPass ? 2500 : 700 + Math.floor(Math.random() * 601);
        const delay = Math.max(0, this.animationUntil - Date.now()) +
            (engine.phase === 'roundEnd' ? 8000 : thinkTime);
        const timer = setTimeout(() => {
            this.timers.delete(timer);
            if (this.engine !== engine || !this.players.some(p => p !== null)) return;
            if (autoPass && actor !== undefined) {
                if (engine.phase !== 'play' || engine.turn !== actor || !engine.table || engine.legalPlays(actor).length) {
                    this.syncAll(); return;
                }
                if (!this.act(actor, { action: 'PASS' }))
                    try {
                        this.players[actor]?.connection.sendUTF(JSON.stringify({ type: 'NOTICE', text: 'Auto-passed.' }));
                    } catch {/* The connection lifecycle handles disconnects. */}
            } else if (engine.phase === 'roundEnd') this.act(0, { action: 'CONTINUE' });
            else if (actor !== undefined) {
                const error = this.act(actor, decide(engine.view(actor, Infinity)));
                if (error) {
                    console.warn(`Tycoon AI: ${error}`);
                    const exchange = engine.view(actor, Infinity).exchange;
                    const ids = engine.legalPlays(actor)[0];
                    this.act(actor, exchange
                        ? { action: 'EXCHANGE', iids: engine.hands[actor].slice(0, exchange.count).map(c => c.iid) }
                        : ids ? { action: 'PLAY', iids: ids } : { action: 'PASS' });
                }
            }
            this.syncAll();
        }, delay);
        this.timers.add(timer);
    }
    onRemove(): void {
        this.clearTimers(); this.engine = null; this.held.clear(); this.observers.clear();
        this.seen.clear(); this.tokens = []; this.continued.clear();
    }
}
