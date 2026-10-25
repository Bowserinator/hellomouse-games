import Game from '../game.js';
import Client from '../client.js';
import { Engine } from '../../client/unstable_unicorns/js/engine/engine.js';
import type { ViewModel } from '../../client/unstable_unicorns/js/engine/view.js';
import type { LoggedEvent } from '../../client/unstable_unicorns/js/engine/events.js';
import { buildRegistry } from '../../client/unstable_unicorns/js/engine/registry.js';
import { catalogFor, DEFAULT_PACK, packNames } from '../../client/unstable_unicorns/js/catalog/index.js';
import { BASE_CUSTOMS, BASE_DEFS } from '../../client/unstable_unicorns/js/engine/cards/index.js';
import { MAX_PLAYERS, MIN_PLAYERS } from '../../client/unstable_unicorns/js/vars.js';

interface UnicornsMessage {
    action?: string;
    iid?: unknown;
    target?: unknown;
    targetEntryId?: unknown;
    promptId?: unknown;
    selection?: unknown;
    iids?: unknown;
    packs?: unknown;
}

interface SeatSync {
    username: string | null;
    ready: boolean;
    connected: boolean;
}

interface LobbySync {
    type: 'SYNC';
    started: false;
    youAre: number;
    isHost: boolean;
    seats: Array<SeatSync>;
    packs: Array<string>;
    packNames: Array<string>;
    minPlayers: number;
    maxPlayers: number;
}

interface TableSync {
    type: 'SYNC';
    started: true;
    youAre: number;
    isHost: boolean;
    seats: Array<SeatSync>;
    view: ViewModel;
    events: Array<LoggedEvent>;
}

interface HeldSeat {
    username: string;
    ready: boolean;
    id: string;
}

const ENGINE_ACTIONS = [
    'PICK_BABY', 'BEGIN_TURN', 'PLAY_CARD', 'DRAW_ACTION',
    'END_TURN', 'DISCARD', 'RESPOND', 'NEIGH'
];

class UnstableUnicornsGame extends Game {
    started: boolean;
    engine: Engine | null;
    packs: Array<string>;
    seen: Record<string, number>;
    vacant: Record<number, HeldSeat>;

    constructor() {
        super({ syncAfterMove: false });
        this.started = false;
        this.engine = null;
        this.packs = [DEFAULT_PACK];
        this.seen = {};
        this.vacant = {};
    }

    onRoomCreate() {
        this.syncAll();
    }

    onJoin(client: Client): boolean {
        if (this.started) {
            const seat = this.players.findIndex(player => player === null);
            if (seat === -1) return false;
            return this.takeSeat(client, seat);
        }
        if (this.playerCount >= MAX_PLAYERS) return false;

        if (!super.onJoin(client)) return false;
        this.syncAll();
        return true;
    }

    private takeSeat(client: Client, seat: number): boolean {
        const held = this.players[seat] ?? this.vacant[seat];
        if (!held) return false;

        client.username = held.username;
        client.ready = held.ready;
        client.id = held.id;
        delete this.vacant[seat];

        client.gameID = this.uuid;
        this.players[seat] = client;
        this.playerCount++;
        this.broadcastWhoYouAre();
        this.syncAll();
        return true;
    }

    onDisconnect(client: Client) {
        const seat = this.players.indexOf(client);
        if (seat !== -1 && this.started)
            this.vacant[seat] = { username: client.username, ready: client.ready, id: client.id };

        super.onDisconnect(client);
        if (!this.started) {
            this.players = this.players.filter(player => player !== null);
            this.playerCount = this.players.length;
        }
        this.syncAll();
    }

    onUsernameChange() {
        this.syncAll();
    }

    onReady() {
        this.syncAll();
    }

    onMessage() {
        this.syncAll();
    }

    onRemove() {
        this.engine = null;
        this.seen = {};
        this.vacant = {};
    }

    private isHost(client: Client): boolean {
        return this.players.length > 0 && this.players[0] === client;
    }

    onMove(client: Client, message: UnicornsMessage) {
        const seat = this.players.indexOf(client);
        if (seat === -1) return;

        if (!this.started) {
            if (message.action === 'START_GAME') this.handleStartGame(client);
            else if (message.action === 'SET_PACKS') this.handleSetPacks(client, message.packs);
            this.syncAll();
            return;
        }

        if (typeof message.action !== 'string' || !ENGINE_ACTIONS.includes(message.action)) {
            this.sendError(client, 'Unknown move');
            this.syncAll();
            return;
        }

        const result = this.engine as Engine;
        const outcome = result.dispatch(seat, {
            type: message.action,
            iid: message.iid,
            target: message.target,
            targetEntryId: message.targetEntryId,
            promptId: message.promptId,
            selection: message.selection,
            iids: message.iids
        });
        if (!outcome.ok) this.sendError(client, outcome.error);
        this.syncAll();
    }

    private handleSetPacks(client: Client, packs: unknown) {
        if (!this.isHost(client)) return this.sendError(client, 'Only the host picks the packs');
        if (!Array.isArray(packs) || !packs.length) return this.sendError(client, 'Pick at least one pack');
        for (const pack of packs)
            if (typeof pack !== 'string' || !packNames().includes(pack))
                return this.sendError(client, `Unknown pack ${String(pack)}`);
        this.packs = [DEFAULT_PACK, ...packs.filter(pack => pack !== DEFAULT_PACK) as Array<string>];
    }

    private handleStartGame(client: Client) {
        if (!this.isHost(client)) return this.sendError(client, 'Only the host starts the game');
        if (this.playerCount < MIN_PLAYERS) return this.sendError(client, 'Not enough players');
        if (!this.everyoneReady()) return this.sendError(client, 'Not everyone is ready');

        const registry = buildRegistry(catalogFor(this.packs), BASE_DEFS, BASE_CUSTOMS);
        this.engine = new Engine({
            registry,
            playerCount: this.players.length,
            seed: `${this.uuid}:${Date.now()}`
        });
        this.started = true;
        this.seen = {};
    }

    private sendError(client: Client, message: string) {
        try {
            client.connection.sendUTF(JSON.stringify({ type: 'ERROR', error: message, code: 'MOVE' }));
        } catch (e) {
            console.error('Failed to send a move error', e);
        }
    }

    private seats(): Array<SeatSync> {
        return this.players.map(player => ({
            username: player ? player.username : null,
            ready: player ? player.ready : false,
            connected: player !== null
        }));
    }

    globalStateSync(player: Client): LobbySync | TableSync {
        const youAre = this.players.indexOf(player);
        const isHost = this.isHost(player);

        if (!this.started || !this.engine)
            return {
                type: 'SYNC',
                started: false,
                youAre,
                isHost,
                seats: this.seats(),
                packs: this.packs,
                packNames: packNames(),
                minPlayers: MIN_PLAYERS,
                maxPlayers: MAX_PLAYERS
            };

        const seen = this.seen[player.id] ?? 0;
        const events = this.engine.eventsSince(seen);
        if (events.length) this.seen[player.id] = events[events.length - 1].seq;

        return {
            type: 'SYNC',
            started: true,
            youAre,
            isHost,
            seats: this.seats(),
            view: this.engine.view(youAre),
            events
        };
    }

    syncAll() {
        for (const player of this.players) {
            if (!player) continue;
            try {
                player.connection.sendUTF(JSON.stringify(this.globalStateSync(player)));
            } catch (e) {
                continue;
            }
        }
    }
}

export default UnstableUnicornsGame;
