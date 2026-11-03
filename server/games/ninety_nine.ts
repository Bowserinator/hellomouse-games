import crypto from 'node:crypto';
import Game from '../game.js';
import Client from '../client.js';
import { Engine } from '../../client/ninety_nine/js/engine.js';
import { decide } from '../../client/ninety_nine/js/ai.js';
import { VARIANTS, getVariant } from '../../client/ninety_nine/js/variants/index.js';
import { eventDuration } from '../../client/ninety_nine/js/ui/timing.js';
import type { Move, Sync, Settings } from '../../client/ninety_nine/js/types.js';

export default class NinetyNineGame extends Game {
    engine: Engine | null = null;
    settings: Settings = { variantId: 'standard', seats: 4, tokens: 3 };
    private held = new Map<number, { username: string; ready: boolean }>();
    private tokens: Array<string> = [];
    private observers = new Set<Client>();
    private seen = new Map<Client, number>();
    private humanSeats = 0;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private continued = new Set<number>();
    private animationUntil = 0;

    constructor() {
        super({ syncAfterMove: false, allowChat: false });
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
    onMove(client: Client,
        move: Move & { token?: unknown; variantId?: unknown; seats?: unknown; tokens?: unknown }): void {
        if (!move || typeof move.action !== 'string') return this.error(client, 'Invalid move');
        let seat = this.players.indexOf(client);
        if (move.action === 'RESUME' && this.engine) {
            const index = typeof move.token === 'string' ? this.tokens.indexOf(move.token) : -1;
            const held = this.held.get(index);
            if (seat !== -1 || !held || !this.observers.has(client)) return this.error(client, 'Seat cannot be resumed');
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
        seat = this.players.indexOf(client);
        if (seat === -1) return this.error(client, 'You are watching. Resume your seat or create a new game.');
        if (move.action === 'RETURN_TO_LOBBY') {
            if (this.engine?.phase !== 'gameEnd') return this.error(client, 'The game has not ended');
            this.clearTimer();
            this.engine = null;
            this.config.holdEmptySeats = false;
            this.animationUntil = 0;
            this.players = this.players.filter(p => p !== null);
            this.playerCount = this.players.length;
            for (const p of this.players) if (p) p.ready = false;
            this.tokens = [];
            this.held.clear();
            this.continued.clear();
            this.seen.clear();
            this.broadcastWhoYouAre();
            this.syncAll();
            return;
        }
        if (move.action === 'SET_OPTIONS' || move.action === 'START_GAME') {
            if (this.engine) return this.error(client, 'Settings are locked after starting');
            if (this.players.find(p => p !== null) !== client) return this.error(client, 'Only the host can do that');
            if (move.action === 'SET_OPTIONS') {
                if (typeof move.variantId !== 'string' || !getVariant(move.variantId) ||
                    typeof move.seats !== 'number' || !Number.isInteger(move.seats) || move.seats < 2 || move.seats > 8 ||
                    typeof move.tokens !== 'number' || !Number.isInteger(move.tokens) || move.tokens < 1 || move.tokens > 10)
                    return this.error(client, 'Choose a listed variant, 2–8 seats, and 1–10 tokens');
                this.settings = { variantId: move.variantId,
                    seats: Math.max(this.playerCount, move.seats), tokens: move.tokens };
            } else {
                if (!this.playerCount || !this.everyoneReady()) return this.error(client, 'Every human must be ready');
                this.humanSeats = this.players.length;
                this.tokens = this.players.map(() => crypto.randomBytes(24).toString('hex'));
                this.engine = new Engine({ variant: getVariant(this.settings.variantId)!, ...this.settings });
                this.continued.clear();
                this.config.holdEmptySeats = true;
                for (const p of this.players) if (p) this.seen.set(p, 0);
                this.animationUntil = Date.now() + eventDuration(this.engine.events);
            }
        } else {
            if (!this.engine) return this.error(client, 'Start the game first');
            if (move.action === 'CONTINUE' && this.engine.phase === 'bust') {
                this.continued.add(seat);
                if (this.players.some((p, i) => p && !this.continued.has(i))) {
                    this.syncAll();
                    return;
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
            this.clearTimer();
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
        const humans = this.engine ? this.humanSeats : this.players.length;
        return {
            type: 'SYNC', started: !!this.engine, youAre: seat,
            isHost: this.players.find(p => p !== null) === client, settings: { ...this.settings },
            ...(!this.engine ? { variants: VARIANTS } : {}),
            seats: Array.from({ length: this.settings.seats }, (_, i) => {
                const ai = i >= humans;
                return {
                    username: ai ? `CPU ${i - humans + 1}` : this.players[i]?.username ??
                        this.held.get(i)?.username ?? `Player ${i + 1}`,
                    ai, ready: ai || (this.players[i]?.ready ?? false), connected: ai || !!this.players[i],
                    eliminated: this.engine?.eliminated[i] ?? false
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
    private clearTimer(): void {
        if (this.timer !== null) clearTimeout(this.timer);
        this.timer = null;
    }
    private schedule(): void {
        if (!this.engine || !this.players.some(p => p !== null)) {
            this.clearTimer(); return;
        }
        if (this.timer !== null || this.engine.phase === 'gameEnd') return;
        const engine = this.engine;
        const actor = engine.pending?.seat ?? engine.turn;
        if (engine.phase !== 'bust' && actor < this.humanSeats) return;
        const delay = Math.max(0, this.animationUntil - Date.now()) +
            (engine.phase === 'bust' ? 4000 : 800 + Math.floor(Math.random() * 701));
        this.timer = setTimeout(() => {
            this.timer = null;
            if (this.engine !== engine || !this.players.some(p => p !== null)) return;
            if (engine.phase === 'bust') this.act(0, { action: 'CONTINUE' });
            else {
                const view = engine.view(actor, Infinity);
                const error = this.act(actor, decide(view));
                if (error) {
                    console.warn(`Ninety-Nine AI: ${error}`);
                    this.act(actor, view.prompt ? { action: 'CHOOSE', promptId: view.prompt.id, value: view.prompt.options[0] }
                        : view.legal.length ? { action: 'PLAY', ...view.legal[0] }
                            : { action: 'COMBINE', iids: view.combinations[0] });
                }
            }
            this.syncAll();
        }, delay);
    }
    onRemove(): void {
        this.clearTimer();
        this.engine = null;
        this.held.clear();
        this.observers.clear();
        this.seen.clear();
        this.tokens = [];
        this.continued.clear();
    }
}
