import { readFileSync } from 'fs';
import { randomBytes } from 'crypto';
import Game from '../game.js';
import type Client from '../client.js';
import { orderedCommands, MAX_COMMANDS, type Command } from '../../client/datacenter_defense/js/sim/commands.js';
import { Lockstep, type Handshake, type TickBundle } from '../../client/datacenter_defense/js/sim/lockstep.js';
import { TICK_HZ } from '../../client/datacenter_defense/js/sim/fixed.js';
import { INPUT_TIMEOUT_MS, LOBBY_LIMIT, PAUSE_COOLDOWN_MS, PLAYER_COLORS,
    type Battlefield, type LobbyState } from '../../client/datacenter_defense/js/shared/protocol.js';

export default class DatacenterDefense extends Game {
    private phase: LobbyState['phase'] = 'LOBBY';
    private hostClient?: Client;
    private ended = false;
    private desynced = false;
    private selectionTimes = new Map<Client, number>();
    private maps: Array<Battlefield> = [];
    private selected = '';
    private colors = new Map<Client, number>();
    private loaded = new Set<Client>();
    private handshake?: Handshake;
    private layoutHash?: number;
    private attribution: Array<number> = [];
    private queue: Array<Command> = [];
    private sequences = Array(8).fill(0) as Array<number>;
    private acknowledgements = new Set<Client>();
    private hashes = new Map<number, Map<Client, number>>();
    private tick = 0;
    private tickStarted = 0;
    private lastBundle = 0;
    private paused = false;
    private pauseBy?: string;
    private cooldownStart = 0;
    private interval?: ReturnType<typeof setInterval>;
    private loadingTimer?: ReturnType<typeof setTimeout>;
    constructor() {
        super({ syncAfterMove: false, maxLobbies: 100 });
    }
    onRoomCreate() {
        try {
            const manifest: unknown = JSON.parse(readFileSync('client/datacenter_defense/maps/index.json', 'utf8'));
            if (!Array.isArray(manifest)) throw Error('Invalid battlefield manifest');
            this.maps = manifest.filter((map: Battlefield) => /^[a-z0-9_-]+$/.test(map.id) && map.playable);
        } catch (error) {
            console.error('Could not load battlefield manifest', error);
            this.maps = [];
        }
        this.selected = this.maps[0]?.id ?? '';
        this.interval = setInterval(() => this.pulse(), 10);
    }
    private host() {
        return this.hostClient ? this.players.indexOf(this.hostClient) : -1;
    }
    globalStateSync(): LobbyState {
        return { type: 'LOBBY', host: this.host(), map: this.selected, phase: this.phase,
            players: this.players.flatMap((client, slot) => client ? [{ slot, name: client.username,
                color: this.colors.get(client) ?? 0, ready: slot === this.host() || client.ready }] : []) };
    }
    private sync() {
        this.broadcast(this.globalStateSync());
    }
    private send(client: Client, message: Record<string, unknown>) {
        client.connection.sendUTF(JSON.stringify(message));
    }
    private error(client: Client, message: string) {
        this.send(client, { type: 'ERROR', message });
    }
    onJoin(client: Client) {
        if (this.ended || this.phase !== 'LOBBY' || this.playerCount >= LOBBY_LIMIT) return false;
        if (!super.onJoin(client)) return false;
        this.hostClient ??= client;
        const used = new Set(this.colors.values());
        this.colors.set(client, PLAYER_COLORS.findIndex((_, index) => !used.has(index)) === -1
            ? this.players.indexOf(client) % 8 : PLAYER_COLORS.findIndex((_, index) => !used.has(index)));
        this.sync();
        return true;
    }
    onDisconnect(client: Client) {
        const slot = this.players.indexOf(client);
        super.onDisconnect(client);
        this.colors.delete(client); this.loaded.delete(client); this.acknowledgements.delete(client);
        this.selectionTimes.delete(client);
        if (this.hostClient === client) this.hostClient = this.players.find(player => player !== null) ?? undefined;
        this.broadcast({ type: 'SELECTION', slot, ids: [] });
        if (this.phase === 'LOADING') this.abort('A player disconnected while loading');
        else this.sync();
    }
    onUsernameChange() {
        this.sync();
    }
    onReady() {
        if (this.phase === 'LOBBY') this.sync();
    }
    onMove() {/* Commands use the relay protocol. */}
    onRemove() {
        clearInterval(this.interval); clearTimeout(this.loadingTimer);
    }
    private abort(message: string) {
        clearTimeout(this.loadingTimer);
        this.phase = 'LOBBY'; this.paused = false; this.pauseBy = undefined;
        this.queue = []; this.loaded.clear(); this.acknowledgements.clear(); this.hashes.clear();
        this.players.forEach(player => {
            if (player) player.ready = false;
        });
        this.broadcast({ type: 'ABORT', message }); this.sync();
    }
    private start(client: Client) {
        if (this.ended || this.phase !== 'LOBBY' || this.players.indexOf(client) !== this.host()) return;
        const map = this.maps.find(candidate => candidate.id === this.selected);
        if (!map || this.players.some((player, i) => player && i !== this.host() && !player.ready))
            return this.error(client, 'Select a map and wait for every player to be ready');
        this.phase = 'LOADING'; this.tick = 0; this.queue = []; this.hashes.clear();
        this.sequences.fill(0); this.loaded.clear(); this.acknowledgements.clear();
        this.paused = false; this.desynced = false; this.pauseBy = undefined; this.cooldownStart = 0;
        this.handshake = Lockstep.handshake(map.mapHash);
        this.layoutHash = undefined;
        this.attribution = [...new Set(this.players.flatMap((player, i) => player ? [i % 8] : []))];
        this.broadcast({ type: 'START', map: map.id, seed: randomBytes(4).readUInt32LE(0),
            slots: this.attribution, players: this.globalStateSync().players, handshake: this.handshake });
        this.loadingTimer = setTimeout(() => this.abort('Loading timed out'), 120000);
    }
    onMessage(client: Client, message: Record<string, unknown>) {
        if (!this.players.includes(client)) return;
        try {
            switch (message.type) {
                case 'CHANGE_COLOR': {
                    if (this.phase !== 'LOBBY') return;
                    const color = message.color;
                    if (typeof color !== 'number' || !Number.isInteger(color) || color < 0 || color >= 8)
                        throw Error('Invalid player color');
                    const used = new Set([...this.colors].filter(([player]) => player !== client)
                        .map(([, value]) => value));
                    if (used.size < 8 && used.has(color)) throw Error('That color is already taken');
                    this.colors.set(client, color); this.sync(); break;
                }
                case 'SELECT_MAP':
                    if (this.phase !== 'LOBBY' || this.players.indexOf(client) !== this.host()) return;
                    if (!this.maps.some(map => map.id === message.map)) throw Error('Invalid battlefield');
                    this.selected = message.map as string;
                    this.players.forEach(player => {
                        if (player) player.ready = false;
                    });
                    this.sync(); break;
                case 'START_GAME': this.start(client); break;
                case 'LOAD_FAILED':
                    if (this.phase === 'LOADING') this.abort('A player could not load the battlefield');
                    break;
                case 'LOADED': {
                    if (this.phase !== 'LOADING' || !this.handshake) return;
                    if (!message.handshake || typeof message.handshake !== 'object') throw Error('Missing simulation handshake');
                    try {
                        Lockstep.compare(this.handshake, message.handshake as Handshake);
                        if (typeof message.layoutHash !== 'number' || !Number.isInteger(message.layoutHash) ||
                            message.layoutHash < 0 || message.layoutHash > 0xffffffff)
                            throw Error('Invalid simulation layout hash');
                        this.layoutHash ??= message.layoutHash;
                        if (this.layoutHash !== message.layoutHash) throw Error('Simulation layout mismatch');
                    } catch {
                        this.abort('Simulation handshake mismatch'); return;
                    }
                    this.loaded.add(client);
                    if (this.players.every(player => !player || this.loaded.has(player))) {
                        clearTimeout(this.loadingTimer);
                        this.phase = 'PLAYING'; this.tickStarted = Date.now(); this.lastBundle = 0;
                        this.broadcast({ type: 'BEGIN' });
                    }
                    break;
                }
                case 'INPUT':
                    if (this.phase === 'PLAYING' && message.tick === this.tick) this.acknowledgements.add(client);
                    break;
                case 'COMMAND': {
                    if (this.phase !== 'PLAYING') return;
                    if (this.queue.length >= 4096) throw Error('Command queue is full; try again after the simulation advances');
                    const raw = message.command as Command;
                    if (!raw || !Array.isArray(raw.payload) || raw.blob !== undefined && !Array.isArray(raw.blob))
                        throw Error('Invalid simulation command');
                    if (!Number.isInteger(raw.targetTick) || raw.targetTick < this.tick - 1024 ||
                        raw.targetTick > this.tick + 32)
                        throw Error('Invalid command tick');
                    const player = this.players.indexOf(client) % 8;
                    const command: Command = { type: raw.type, payload: raw.payload, blob: raw.blob,
                        player, source: this.players.indexOf(client), seq: 0,
                        targetTick: Math.max(this.tick, raw.targetTick) };
                    this.queue.push(orderedCommands([command], command.targetTick)[0]);
                    break;
                }
                case 'SELECTION': {
                    if (this.phase !== 'PLAYING') return;
                    const ids = message.ids;
                    if (!Array.isArray(ids) || ids.length > 1024 ||
                        ids.some(id => !Number.isInteger(id) || id < 0 || id >= 1024))
                        throw Error('Invalid selection');
                    const now = Date.now();
                    if (now - (this.selectionTimes.get(client) ?? 0) < 100) return;
                    this.selectionTimes.set(client, now);
                    this.broadcast({ type: 'SELECTION', slot: this.players.indexOf(client), ids: [...new Set(ids)] });
                    break;
                }
                case 'HASH': this.recordHash(client, message); break;
                case 'PAUSE': {
                    if (this.phase !== 'PLAYING' || this.desynced) return;
                    const remainingMs = Math.max(0, PAUSE_COOLDOWN_MS - (Date.now() - this.cooldownStart));
                    if (this.paused || this.pauseBy || remainingMs) {
                        this.send(client, { type: 'PAUSE_DENIED', remainingMs }); return;
                    }
                    this.pauseBy = client.username; break;
                }
                case 'RESUME':
                    if (this.phase !== 'PLAYING' || this.desynced || !this.paused) return;
                    this.paused = false; this.cooldownStart = Date.now(); this.tickStarted = Date.now();
                    this.broadcast({ type: 'RESUMED', tick: this.tick });
                    this.broadcast({ type: 'PAUSE_STATE', paused: false, by: client.username,
                        cooldownRemainingMs: PAUSE_COOLDOWN_MS });
                    break;
                case 'GAME_END':
                    if (this.phase === 'PLAYING' && Number.isInteger(message.tick) &&
                        typeof message.tick === 'number' && message.tick > 0 && message.tick <= this.tick &&
                        (message.outcome === 'victory' || message.outcome === 'defeat')) {
                        if (message.outcome === 'victory' && message.tick <
                            (this.maps.find(map => map.id === this.selected)?.winTime ?? Infinity) * TICK_HZ) return;
                        this.ended = true; this.phase = 'LOBBY';
                        this.broadcast({ type: 'GAME_OVER', outcome: message.outcome, tick: message.tick });
                    }
                    break;
            }
        } catch (error) {
            this.error(client, error instanceof Error ? error.message : 'Invalid game message');
        }
    }
    private recordHash(client: Client, message: Record<string, unknown>) {
        if (this.phase !== 'PLAYING' || typeof message.tick !== 'number' || !Number.isInteger(message.tick) ||
            message.tick < 1 || message.tick > this.tick || typeof message.hash !== 'number' ||
            !Number.isInteger(message.hash) || message.hash < 0 || message.hash > 0xffffffff) return;
        const hashes = this.hashes.get(message.tick) ?? new Map<Client, number>();
        if (hashes.has(client)) return;
        hashes.set(client, message.hash); this.hashes.set(message.tick, hashes);
        if (new Set(hashes.values()).size > 1) {
            const values = [...hashes.values()];
            this.broadcast({ type: 'DESYNC', tick: message.tick, expected: values[0],
                actual: values.find(hash => hash !== values[0]) });
            this.paused = true; this.desynced = true;
        }
        while (this.hashes.size > 256) this.hashes.delete(this.hashes.keys().next().value);
    }
    private pulse() {
        if (this.phase !== 'PLAYING' || this.paused) return;
        const now = Date.now();
        if (now - this.lastBundle < 1000 / TICK_HZ || now - this.tickStarted < INPUT_TIMEOUT_MS &&
            this.players.some(player => player && !this.acknowledgements.has(player))) return;
        const commands: Array<Command> = [], pending: Array<Command> = [];
        for (const command of this.queue)
            if (command.targetTick <= this.tick && commands.length < MAX_COMMANDS) commands.push({ ...command,
                targetTick: this.tick, seq: this.sequences[command.player]++ });
            else pending.push(command);

        this.queue = pending;
        const bundle: TickBundle = { tick: this.tick, commands: orderedCommands(commands, this.tick),
            acknowledgements: this.attribution };
        if (this.pauseBy) bundle.control = 'pause';
        this.broadcast({ type: 'BUNDLE', bundle });
        this.tick++; this.lastBundle = now; this.tickStarted = now; this.acknowledgements.clear();
        if (this.pauseBy) {
            this.paused = true;
            this.broadcast({ type: 'PAUSE_STATE', paused: true, by: this.pauseBy, cooldownRemainingMs: 0 });
            this.pauseBy = undefined;
        }
    }
}
