import crypto from 'node:crypto';
import Game from '../game.js';
import Client from '../client.js';
import { Engine } from '../../client/fuck_you/js/engine.js';
import type { Move, View } from '../../client/fuck_you/js/engine.js';

export interface Sync {
    type: 'SYNC';
    started: boolean;
    youAre: number;
    isHost: boolean;
    seats: Array<{ username: string; ready: boolean; connected: boolean }>;
    token?: string;
    view?: View;
}
interface HeldSeat {
    username: string; ready: boolean;
}

export default class FuckYouGame extends Game {
    engine: Engine | null = null;
    private held = new Map<number, HeldSeat>();
    private tokens: Array<string> = [];
    private observers = new Set<Client>();
    private seen = new Map<Client, number>();

    constructor() {
        super({ syncAfterMove: false, allowChat: false });
    }
    onRoomCreate(): void {
        this.syncAll();
    }
    onJoin(client: Client): boolean {
        if (this.engine) {
            if (this.observers.size >= 8) return false;
            client.gameID = this.uuid;
            this.observers.add(client);
            this.syncAll();
            return true;
        }
        if (this.playerCount >= 8 || !super.onJoin(client)) return false;
        this.syncAll();
        return true;
    }
    onDisconnect(client: Client): void {
        const seat = this.players.indexOf(client);
        if (this.engine && seat !== -1) this.held.set(seat, { username: client.username, ready: client.ready });
        super.onDisconnect(client);
        this.observers.delete(client);
        this.seen.delete(client);
        if (!this.engine) this.players = this.players.filter(player => player !== null);
        this.syncAll();
    }
    onUsernameChange(): void {
        this.syncAll();
    }
    onReady(): void {
        this.syncAll();
    }
    private error(client: Client, error: string): void {
        client.connection.sendUTF(JSON.stringify({ type: 'ERROR', error, code: 'MOVE' }));
    }
    onMove(client: Client, move: Move & { token?: unknown }): void {
        let seat = this.players.indexOf(client);
        if (this.engine && move.action === 'RESUME') {
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
        if (!this.engine) {
            if (move.action !== 'START_GAME') return this.error(client, 'Start the game first');
            if (this.players.find(player => player !== null) !== client) return this.error(client, 'Only the host can start');
            if (this.playerCount < 2 || !this.everyoneReady()) return this.error(client, 'Need 2 to 8 ready players');
            this.tokens = this.players.map(() => crypto.randomBytes(24).toString('hex'));
            this.engine = new Engine(this.players.length);
            for (const player of this.players) if (player) this.seen.set(player, this.engine.events.at(-1)?.seq ?? 0);
        } else {
            const error = this.engine.dispatch(seat, move);
            if (error) this.error(client, error);
        }
        this.syncAll();
    }
    globalStateSync(client: Client): Sync {
        const seat = this.players.indexOf(client);
        const view = this.engine?.view(seat, this.seen.get(client) ?? this.engine.events.at(-1)?.seq ?? 0);
        if (this.engine) this.seen.set(client, this.engine.events.at(-1)?.seq ?? 0);
        return {
            type: 'SYNC', started: this.engine !== null, youAre: seat,
            isHost: this.players.find(player => player !== null) === client,
            seats: this.players.map((player, i) => ({
                username: player?.username ?? this.held.get(i)?.username ?? `Player ${i + 1}`,
                ready: player?.ready ?? false, connected: player !== null
            })),
            ...(seat !== -1 && this.engine ? { token: this.tokens[seat] } : {}),
            ...(view ? { view } : {})
        };
    }
    private syncAll(): void {
        for (const client of [...this.players, ...this.observers]) if (client)
            try {
                client.connection.sendUTF(JSON.stringify(this.globalStateSync(client)));
            } catch {/* A disconnect is handled by the connection lifecycle. */}
    }
    onRemove(): void {
        this.engine = null;
        this.held.clear();
        this.observers.clear();
        this.seen.clear();
        this.tokens = [];
    }
}
