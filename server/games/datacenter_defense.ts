import { readFileSync } from 'fs';
import { randomBytes } from 'crypto';
import Game from '../game.js';
import { removeGame } from '../games.js';
import type Client from '../client.js';
import { orderedCommands, MAX_COMMANDS, CommandType, type Command } from '../../client/datacenter_defense/js/sim/commands.js';
import { Lockstep, type Handshake, type TickBundle } from '../../client/datacenter_defense/js/sim/lockstep.js';
import { decodeMap } from '../../client/datacenter_defense/js/mapx.js';
import { bakeNav } from '../../client/datacenter_defense/js/sim/nav-bake.js';
import { TICK_HZ } from '../../client/datacenter_defense/js/sim/fixed.js';
import { BUILD_TIMES, type BuildTime, INPUT_TIMEOUT_MS, LOBBY_LIMIT, PAUSE_COOLDOWN_MS, PLAYER_COLORS,
    RECONNECT_MS, MARKER_LENGTH, MARKER_LIMIT, PING_KINDS, type Battlefield, type ConnectionStats, type LobbyState, type MapAnnotation } from '../../client/datacenter_defense/js/shared/protocol.js';

export default class DatacenterDefense extends Game {
    private phase: LobbyState['phase'] = 'LOBBY';
    private hostClient?: Client;
    private ended = false;
    private desynced = false;
    private selectionTimes = new Map<Client, number>();
    private annotationTimes = new Map<Client, number>();
    private markers = new Set<number>();
    private nextMarker = 1;
    private maps: Array<Battlefield> = [];
    private selected = '';
    private buildTime: BuildTime = null;
    private winTick = Infinity;
    private colors = new Map<Client, number>();
    private loaded = new Set<Client>();
    private handshake?: Handshake;
    private layoutHash?: number;
    private attribution: Array<number> = [];
    private tokens = new Map<number, string>();
    private disconnected = new Map<number, { client: Client; deadline: number }>();
    private departed = new Set<number>();
    private bundles: Array<TickBundle> = [];
    private lastResume = 0;
    private pendingInheritance = 0;
    private queue: Array<Command> = [];
    private sequences = Array(8).fill(0) as Array<number>;
    private acknowledgements = new Set<Client>();
    private playerTicks = new Map<Client, number>();
    private tickSamples = new Map<Client, { tick: number; time: number; tps?: number }>();
    private playerPings = new Map<Client, number>();
    private lastConnectionUpdate = 0;
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
        return { type: 'LOBBY', host: this.host(), map: this.selected, buildTime: this.buildTime, phase: this.phase,
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
    onJoin(client: Client, message?: MessageData) {
        if (this.phase === 'PLAYING') return this.reconnect(client, message);
        if (this.ended || this.phase !== 'LOBBY' || this.playerCount >= LOBBY_LIMIT) return false;
        if (!super.onJoin(client)) return false;
        this.hostClient ??= client;
        const used = new Set(this.colors.values());
        this.colors.set(client, PLAYER_COLORS.findIndex((_, index) => !used.has(index)) === -1
            ? this.players.indexOf(client) % 8 : PLAYER_COLORS.findIndex((_, index) => !used.has(index)));
        this.sync();
        return true;
    }
    private reconnect(client: Client, message?: MessageData) {
        const next = message?.nextTick;
        if (typeof message?.resumeToken !== 'string' || typeof next !== 'number' || !Number.isInteger(next) ||
            next < (this.bundles[0]?.tick ?? this.tick) || next > this.tick) return false;
        const slot = [...this.disconnected.keys()].find(id => this.tokens.get(id) === message.resumeToken);
        if (slot === undefined) return false;
        const seat = this.disconnected.get(slot)!;
        if (seat.deadline <= Date.now()) return false;
        this.disconnected.delete(slot);
        client.gameID = this.uuid; client.username = seat.client.username; client.ready = seat.client.ready;
        this.colors.set(client, this.colors.get(seat.client) ?? slot);
        this.colors.delete(seat.client);
        this.players[slot] = client; this.playerCount++;
        this.hostClient ??= client;
        this.broadcastWhoYouAre();
        if (this.lastResume) this.send(client, { type: 'RESUMED', tick: this.lastResume });
        for (const bundle of this.bundles) if (bundle.tick >= next) this.send(client, { type: 'BUNDLE', bundle });
        this.send(client, { type: 'RECONNECTED' });
        this.connectionUpdate(Date.now());
        return true;
    }
    onDisconnect(client: Client) {
        const slot = this.players.indexOf(client);
        super.onDisconnect(client);
        if (slot >= 0 && this.phase === 'PLAYING') {
            this.disconnected.set(slot, { client, deadline: Date.now() + RECONNECT_MS });
            this.config.holdEmptySeats = true;
        } else this.colors.delete(client);
        this.loaded.delete(client); this.acknowledgements.delete(client);
        this.playerTicks.delete(client); this.tickSamples.delete(client); this.playerPings.delete(client);
        this.selectionTimes.delete(client); this.annotationTimes.delete(client);
        if (this.hostClient === client) this.hostClient = this.players.find(player => player !== null) ?? undefined;
        this.broadcast({ type: 'SELECTION', slot, ids: [] });
        if (this.phase === 'LOADING') this.abort('A player disconnected while loading');
        else if (this.phase === 'PLAYING') this.connectionUpdate(Date.now());
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
        const nav = this.buildTime === null ? undefined : bakeNav(
            decodeMap(new Uint8Array(readFileSync(`client/datacenter_defense/maps/${map.file}`))), this.buildTime);
        this.winTick = nav?.winTick ?? map.winTime * TICK_HZ;
        this.phase = 'LOADING'; this.tick = 0; this.queue = []; this.hashes.clear();
        this.markers.clear(); this.annotationTimes.clear(); this.nextMarker = 1;
        this.sequences.fill(0); this.loaded.clear(); this.acknowledgements.clear(); this.playerTicks.clear();
        this.tickSamples.clear();
        this.paused = false; this.desynced = false; this.pauseBy = undefined; this.cooldownStart = 0;
        this.handshake = Lockstep.handshake(nav?.hash ?? map.mapHash);
        this.layoutHash = undefined;
        this.attribution = [...new Set(this.players.flatMap((player, i) => player ? [i % 8] : []))];
        this.broadcast({ type: 'START', map: map.id, buildTime: this.buildTime, seed: randomBytes(4).readUInt32LE(0),
            slots: this.attribution, players: this.globalStateSync().players, handshake: this.handshake });
        this.loadingTimer = setTimeout(() => this.abort('Loading timed out'), 120000);
    }
    private annotate(client: Client, message: Record<string, unknown>) {
        if (this.phase !== 'PLAYING') return;
        const now = Date.now();
        if (now - (this.annotationTimes.get(client) ?? 0) < 100) return;
        this.annotationTimes.set(client, now);
        const { op, x, z, id } = message;
        let annotation: MapAnnotation;
        if (op === 'remove' && typeof id === 'number' && this.markers.delete(id)) annotation = { op, id };
        else {
            if (typeof x !== 'number' || typeof z !== 'number' || !Number.isFinite(x) || !Number.isFinite(z) ||
                x < 0 || x > 20000 || z < 0 || z > 20000) return;
            if (op === 'ping') {
                const kind = PING_KINDS.find(candidate => candidate === message.kind);
                if (!kind) return;
                annotation = { op, kind, x, z, author: client.username };
            } else if (op === 'add' && typeof message.text === 'string' && this.markers.size < MARKER_LIMIT) {
                const text = message.text.trim();
                if (!text || text.length > MARKER_LENGTH) return;
                const markerId = this.nextMarker++;
                this.markers.add(markerId);
                const color = this.colors.get(client) ?? 0;
                annotation = { op, id: markerId, text, x, z, author: client.username, color };
            } else if (op === 'move' && typeof id === 'number' && this.markers.has(id)) annotation = { op, id, x, z };
            else return;
        }
        this.broadcast({ type: 'ANNOTATION', annotation });
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
                case 'BUILD_TIME': {
                    if (this.phase !== 'LOBBY' || this.players.indexOf(client) !== this.host()) return;
                    const choice = BUILD_TIMES.find(([seconds]) => seconds === message.buildTime);
                    if (!choice) throw Error('Invalid build time');
                    this.buildTime = choice[0];
                    this.players.forEach(player => {
                        if (player) player.ready = false;
                    });
                    this.sync(); break;
                }
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
                        this.players.forEach((player, slot) => {
                            if (!player) return;
                            const token = randomBytes(24).toString('hex');
                            this.tokens.set(slot, token);
                            this.send(player, { type: 'BEGIN', token });
                        });
                    }
                    break;
                }
                case 'INPUT':
                    if (this.phase !== 'PLAYING' || typeof message.tick !== 'number' ||
                        !Number.isInteger(message.tick) || message.tick < 0 || message.tick > this.tick) break;
                    this.playerTicks.set(client, Math.max(this.playerTicks.get(client) ?? 0, message.tick));
                    if (message.tick === this.tick) this.acknowledgements.add(client);
                    break;
                case 'CONNECTION_PING':
                    if (typeof message.ping === 'number' && Number.isInteger(message.ping) &&
                        message.ping >= 0 && message.ping <= 60000) this.playerPings.set(client, message.ping);
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
                    const clientSeq = Number.isInteger(raw.seq) && raw.seq >= 0 && raw.seq <= 0xffffffff
                        ? raw.seq : undefined;
                    const command: Command = { type: raw.type, payload: raw.payload, blob: raw.blob,
                        player, source: this.players.indexOf(client), seq: 0,
                        clientSeq,
                        targetTick: Math.max(this.tick, raw.targetTick) };
                    const [validated] = orderedCommands([command], command.targetTick);
                    if (validated.type === CommandType.Inherit) throw Error('Inheritance is server-controlled');
                    if (validated.type === CommandType.Gift && !this.players[validated.payload[2]])
                        throw Error('Gift recipient is not connected');
                    this.queue.push(validated);
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
                case 'ANNOTATION': this.annotate(client, message); break;
                case 'HASH': this.recordHash(client, message); break;
                case 'PAUSE': {
                    if (this.phase !== 'PLAYING' || this.desynced) return;
                    const remainingMs = this.attribution.length > 1
                        ? Math.max(0, PAUSE_COOLDOWN_MS - (Date.now() - this.cooldownStart)) : 0;
                    if (this.paused || this.pauseBy || remainingMs) {
                        this.send(client, { type: 'PAUSE_DENIED', remainingMs }); return;
                    }
                    this.pauseBy = client.username; break;
                }
                case 'RESUME':
                    if (this.phase !== 'PLAYING' || this.desynced || !this.paused) return;
                    this.paused = false; this.cooldownStart = Date.now(); this.tickStarted = Date.now();
                    this.lastResume = this.tick;
                    this.broadcast({ type: 'RESUMED', tick: this.tick });
                    this.broadcast({ type: 'PAUSE_STATE', paused: false, by: client.username,
                        cooldownRemainingMs: this.attribution.length > 1 ? PAUSE_COOLDOWN_MS : 0 });
                    break;
                case 'GAME_END':
                    if (this.phase === 'PLAYING' && Number.isInteger(message.tick) &&
                        typeof message.tick === 'number' && message.tick > 0 && message.tick <= this.tick &&
                        (message.outcome === 'victory' || message.outcome === 'defeat')) {
                        if (message.outcome === 'victory' && message.tick < this.winTick) return;
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
    private connectionUpdate(now: number) {
        this.lastConnectionUpdate = now;
        const players: Array<ConnectionStats> = [];
        this.players.forEach((client, slot) => {
            const deadline = this.disconnected.get(slot)?.deadline;
            if (client) {
                const tick = this.playerTicks.get(client);
                let sample = this.tickSamples.get(client);
                if (tick !== undefined && (!sample || now - sample.time >= 1000)) {
                    const tps = sample && (tick - sample.tick) * 1000 / (now - sample.time);
                    sample = { tick, time: now, tps };
                    this.tickSamples.set(client, sample);
                }
                players.push({ slot, ping: this.playerPings.get(client), tick, tps: sample?.tps });
            } else if (deadline) players.push({ slot, reconnectMs: Math.max(0, deadline - now) });
            else if (this.departed.has(slot)) players.push({ slot, departed: true });
        });
        this.broadcast({ type: 'CONNECTION_STATS', players });
    }
    private pulse() {
        const now = Date.now();
        for (const [slot, seat] of this.disconnected) {
            if (now < seat.deadline) continue;
            this.disconnected.delete(slot); this.tokens.delete(slot); this.colors.delete(seat.client);
            this.departed.add(slot);
            this.pendingInheritance |= 1 << slot;
            this.queue = this.queue.filter(command => command.type !== CommandType.Gift || command.payload[2] !== slot);
            this.lastConnectionUpdate = 0;
        }
        this.config.holdEmptySeats = this.disconnected.size > 0;
        if (!this.playerCount) {
            if (!this.config.holdEmptySeats) removeGame(this.uuid);
            return;
        }
        if (this.phase !== 'PLAYING') return;
        if (now - this.lastConnectionUpdate >= 1000) this.connectionUpdate(now);
        if (this.paused) return;
        if (now - this.lastBundle < 1000 / TICK_HZ || now - this.tickStarted < INPUT_TIMEOUT_MS &&
            this.players.some(player => player && !this.acknowledgements.has(player))) return;
        const commands: Array<Command> = [], pending: Array<Command> = [];
        if (this.pendingInheritance) {
            const eligible = this.players.reduce((mask, client, slot) => client ? mask | (1 << slot) : mask, 0);
            const player = this.players.findIndex(client => client !== null);
            commands.push({ type: CommandType.Inherit, player, source: player, seq: this.sequences[player]++,
                targetTick: this.tick, payload: [this.pendingInheritance, eligible] });
            this.pendingInheritance = 0;
        }
        for (const command of this.queue)
            if (command.targetTick <= this.tick && commands.length < MAX_COMMANDS) commands.push({ ...command,
                targetTick: this.tick, seq: this.sequences[command.player]++ });
            else pending.push(command);

        this.queue = pending;
        const bundle: TickBundle = { tick: this.tick, commands: orderedCommands(commands, this.tick),
            acknowledgements: this.attribution };
        if (this.pauseBy) bundle.control = 'pause';
        this.bundles.push(bundle);
        if (this.bundles.length > 1024) this.bundles.shift();
        this.broadcast({ type: 'BUNDLE', bundle });
        this.tick++; this.lastBundle = now; this.tickStarted = now; this.acknowledgements.clear();
        if (this.pauseBy) {
            this.paused = true;
            this.broadcast({ type: 'PAUSE_STATE', paused: true, by: this.pauseBy, cooldownRemainingMs: 0 });
            this.pauseBy = undefined;
        }
    }
}
