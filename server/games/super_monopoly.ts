import crypto from 'node:crypto';
import Game from '../game.js';
import type Client from '../client.js';
import type { Property } from '../../client/super_monopoly/js/boards/index.js';
import { MonopolyEngine } from '../../client/super_monopoly/js/engine/engine.js';
import { available, shortfall } from '../../client/super_monopoly/js/engine/banking.js';
import { interest, management } from '../../client/super_monopoly/js/engine/propertyManagement.js';
import { calculateRent } from '../../client/super_monopoly/js/engine/rent.js';
import { mortgageFee } from '../../client/super_monopoly/js/engine/trades.js';
import { defaults, settingBounds, tokens } from '../../client/super_monopoly/js/types.js';
import type { Command, Pose, Profile, Settings } from '../../client/super_monopoly/js/types.js';
import type { Sync } from '../../client/super_monopoly/js/protocol.js';

const cpuName = (index: number): string => `CPU${index}`;
const roundBid = (amount: number): number => Math.max(10, Math.floor(amount / 10) * 10);
const SET_COMPLETE = 2;

function cpuBuffer(engine: MonopolyEngine, seat: number): number {
    const worst = engine.properties.reduce((most, property) => Math.max(most,
        calculateRent(property, engine.group(property), engine.deeds, seat, 7)), 0);
    return 100 + Math.min(400, worst / 2);
}

function cpuFactor(engine: MonopolyEngine, seat: number, property: Property): number {
    const owners = engine.group(property).filter(item => item.id !== property.id)
        .map(item => engine.deeds[item.id].owner);
    const mine = owners.filter(owner => owner === seat).length;
    if (mine === owners.length) return SET_COMPLETE;
    if (mine) return 1.3;
    if (owners.every(owner => owner !== null && owner === owners[0])) return 1.4;
    return property.type === 'street' ? 1 : property.type === 'railroad' ? 1.1 : 0.8;
}

function cpuBid(engine: MonopolyEngine, seat: number, property: Property, current: number): number | null {
    const { price } = property.deed;
    const factor = cpuFactor(engine, seat, property);
    const room = available(engine.players[seat]) - (factor === SET_COMPLETE ? 0 : cpuBuffer(engine, seat) / 2);
    const limit = Math.floor(Math.min(price * factor, room) / 10) * 10;
    const next = current ? Math.min(current + roundBid(price * 0.08), limit) : roundBid(price * 0.2);
    return next > current && next <= limit ? next : null;
}

function cpuDebt(engine: MonopolyEngine, seat: number): Command {
    const cash = available(engine.players[seat]);
    const rank = (property: Property) => [
        engine.group(property).every(item => engine.deeds[item.id].owner === seat) ? 1 : 0, property.deed.price
    ];
    for (const action of ['MORTGAGE', 'SELL', 'LIQUIDATE']) {
        const [choice] = engine.properties.filter(property => management(property, engine.group(property),
            engine.deeds, seat, cash, engine.houses, engine.hotels, true).includes(action))
            .sort((a, b) => rank(a)[0] - rank(b)[0] || rank(a)[1] - rank(b)[1]);
        if (choice) return { action, property: choice.id };
    }
    return { action: 'UNABLE' };
}

function cpuImprove(engine: MonopolyEngine, seat: number, spare: number): Command | null {
    const cash = available(engine.players[seat]);
    const options = engine.properties.flatMap(property => management(property, engine.group(property),
        engine.deeds, seat, cash, engine.houses, engine.hotels, false).flatMap(action => {
        const { buildingCost, mortgageValue, rent } = property.deed;
        const { level } = engine.deeds[property.id];
        if (action === 'UNMORTGAGE')
            return mortgageValue + interest(mortgageValue) <= spare ? [{ action, property, score: 1e9 }] : [];
        return action === 'BUILD' && buildingCost <= spare
            ? [{ action, property, score: (rent[level + 1] - rent[level]) / buildingCost }] : [];
    }));
    const [best] = options.sort((a, b) => b.score - a.score);
    return best ? { action: best.action, property: best.property.id } : null;
}

/** Chooses the next command for a CPU seat, or null if it has nothing to do. */
function cpuMove(engine: MonopolyEngine, seat: number): Command | null {
    const { phase } = engine;
    const me = engine.players[seat];
    if (me.eliminated || phase.kind === 'over') return null;
    const cash = available(me);
    const buffer = cpuBuffer(engine, seat);
    if (phase.kind === 'auction') {
        const property = engine.property(phase.property) as Property;
        if (phase.leader === seat || phase.abstained.includes(seat)) return null;
        const bid = cpuBid(engine, seat, property, phase.bid);
        return bid ? { action: 'BID', amount: bid } : { action: 'ABSTAIN' };
    }
    if (phase.kind === 'rescue')
        return phase.debt.payer === seat || phase.declined.includes(seat) ? null : { action: 'OPT_OUT' };
    if (engine.trade?.to === seat && ['roll', 'extra', 'end', 'purchase', 'debt'].includes(phase.kind))
        return { action: 'CANCEL_TRADE', id: engine.trade.id };
    if (engine.actor() !== seat) return null;
    switch (phase.kind) {
        case 'roll':
            if (me.bail !== null && me.cards.length) return { action: 'ESCAPE', card: me.cards[0], target: seat };
            return me.bail !== null && cash >= me.bail + buffer ? { action: 'BAIL' } : { action: 'ROLL' };
        case 'extra': return { action: 'ROLL' };
        case 'draw': return { action: 'DRAW' };
        case 'arson': return { action: 'DECLINE' };
        case 'purchase': {
            const property = engine.property(phase.property) as Property;
            const reserve = cpuFactor(engine, seat, property) === SET_COMPLETE ? 0 : buffer;
            return cash - property.deed.price >= reserve ? { action: 'BUY' } : { action: 'DECLINE' };
        }
        case 'select': {
            const [choice] = phase.properties.map(id => engine.property(id) as Property).sort((a, b) =>
                cpuFactor(engine, seat, b) * b.deed.price - cpuFactor(engine, seat, a) * a.deed.price);
            return { action: 'SELECT', property: choice.id };
        }
        case 'mortgageTransfer':
            return { action: cash - mortgageFee(engine.property(phase.property) as Property, true) >= buffer
                ? 'RELEASE_MORTGAGE' : 'KEEP_MORTGAGE' };
        case 'debt': return shortfall(engine.players, phase.debt) ? cpuDebt(engine, seat) : null;
        case 'end': return cpuImprove(engine, seat, cash - buffer) ?? { action: 'END' };
        default: return null;
    }
}

function cpuDelay(move: Command): [number, number] {
    if (move.action === 'BID' || move.action === 'ABSTAIN') return [1200, 2800];
    if (move.action === 'OPT_OUT') return [1000, 2200];
    if (['BUILD', 'UNMORTGAGE', 'MORTGAGE', 'SELL', 'LIQUIDATE'].includes(move.action)) return [450, 800];
    return [900, 1600];
}

export default class SuperMonopolyGame extends Game {
    engine: MonopolyEngine | null = null;
    settings: Settings = { ...defaults };
    private profiles = new Map<Client, Profile>();
    private observers = new Set<Client>();
    private seatTokens: Array<string> = [];
    private seen = new Map<Client, number>();
    private actions = new Map<Client | number, Set<string>>();
    private limits = new Map<Client, { time: number; moves: number; preview: number }>();
    private previews = new Set<Client>();
    private bots: Array<Profile> = [];
    private botTimer?: ReturnType<typeof setTimeout>;
    private scanned?: unknown;
    private timer?: ReturnType<typeof setTimeout>;
    private idle?: ReturnType<typeof setTimeout>;
    private generation = 0;

    constructor() {
        super({ syncAfterMove: false, holdEmptySeats: false, maxLobbies: 100 });
    }

    onRoomCreate(): void { }

    onJoin(client: Client, message?: MessageData): boolean {
        if (this.players.includes(client) || this.observers.has(client)) return false;
        if (this.engine) {
            const nextTick = message?.nextTick;
            const seq = typeof nextTick === 'number' && Number.isSafeInteger(nextTick) && nextTick >= 0 ? nextTick : 0;
            if (!this.resume(client, message?.resumeToken, seq)) {
                if (this.observers.size >= 8) return false;
                client.gameID = this.uuid;
                this.observers.add(client);
                this.seen.set(client, this.engine.seq);
            }
        } else {
            if (this.playerCount + this.bots.length >= this.settings.playerLimit || !super.onJoin(client)) return false;
            const token = this.freeToken();
            this.profiles.set(client, { token, skin: token + 1 });
            this.generation++;
        }
        this.syncAll();
        return true;
    }

    onDisconnect(client: Client): void {
        const lobbySeatChanged = !this.engine && this.players.includes(client);
        super.onDisconnect(client);
        this.observers.delete(client);
        this.profiles.delete(client);
        this.seen.delete(client);
        this.actions.delete(client);
        this.limits.delete(client);
        this.previews.delete(client);
        if (lobbySeatChanged) {
            this.players = this.players.filter(p => p !== null);
            this.generation++;
            this.broadcastWhoYouAre();
        }
        this.syncAll();
    }

    onUsernameChange(): void {
        this.syncAll();
    }
    onReady(): void {
        this.syncAll();
    }

    private send(client: Client, message: Record<string, unknown> | Sync): void {
        try {
            client.connection.sendUTF(JSON.stringify(message));
        } catch {/* Disconnect cleanup handles closed sockets. */}
    }

    broadcast(message: Record<string, unknown>): void {
        for (const client of [...this.players, ...this.observers]) if (client) this.send(client, message);
    }

    private error(client: Client, error: string): void {
        this.send(client, { type: 'ERROR', code: 'MOVE', error });
    }

    private freeToken(): number {
        const used = new Set([...this.profiles.values(), ...this.bots].map(profile => profile.token));
        return tokens.findIndex((_, i) => !used.has(i));
    }

    private host(): Client | undefined {
        return this.players.find((client): client is Client => client !== null);
    }

    private resume(client: Client, token: unknown, seq: number): boolean {
        if (!this.engine || typeof token !== 'string' || token.length !== 48) return false;
        const seat = this.seatTokens.indexOf(token);
        if (seat < 0 || this.players[seat] !== null) return false;
        client.gameID = this.uuid;
        client.username = this.engine.players[seat].name;
        this.players[seat] = client;
        this.playerCount++;
        this.observers.delete(client);
        this.seen.set(client, Math.min(seq, this.engine.seq));
        this.broadcastWhoYouAre();
        return true;
    }

    private options(value: unknown): boolean {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
        const next = { ...this.settings };
        for (const [key, val] of Object.entries(value)) {
            if (!Object.prototype.hasOwnProperty.call(defaults, key)) return false;
            const field = key as keyof Settings;
            if (typeof defaults[field] === 'boolean') {
                if (typeof val !== 'boolean') return false;
                next[field as Exclude<keyof Settings, keyof typeof settingBounds>] = val;
            } else {
                const numeric = field as keyof typeof settingBounds;
                const [min, max] = settingBounds[numeric];
                if (typeof val !== 'number' || !Number.isInteger(val) || val < min || val > max) return false;
                next[numeric] = val;
            }
        }
        if (next.playerLimit < this.playerCount + this.bots.length) return false;
        this.settings = next;
        return true;
    }

    private lobby(client: Client, move: Command): boolean {
        if (move.action === 'PROFILE') {
            const { token, skin } = move;
            if (typeof token !== 'number' || !Number.isInteger(token) || token < 0 || token >= tokens.length ||
                typeof skin !== 'number' || !Number.isInteger(skin) || skin < 1 || skin > 10 ||
                [...this.profiles].some(([p, profile]) => p !== client && profile.token === token) ||
                this.bots.some(bot => bot.token === token)) return false;
            this.profiles.set(client, { token, skin });
            return true;
        }
        if (this.host() !== client) return false;
        if (move.action === 'SET_OPTIONS') return this.options(move.settings);
        if (move.action === 'KICK') {
            const target = typeof move.target === 'number' ? this.players[move.target] : null;
            if (!target || target === client) return false;
            target.gameID = '';
            target.ready = false;
            this.send(target, { type: 'KICKED' });
            this.onDisconnect(target);
            return true;
        }
        if (move.action === 'ADD_BOT') {
            if (this.playerCount + this.bots.length >= this.settings.playerLimit) return false;
            const token = this.freeToken();
            this.bots.push({ token, skin: token + 1 });
            return true;
        }
        if (move.action === 'REMOVE_BOT') {
            const index = typeof move.target === 'number' ? move.target - this.players.length : -1;
            if (!Number.isInteger(index) || index < 0 || index >= this.bots.length) return false;
            this.bots.splice(index, 1);
            this.generation++;
            return true;
        }
        if (move.action !== 'START_GAME' || this.playerCount + this.bots.length < 2 ||
            !this.everyoneReady()) return false;
        const profiles = [
            ...this.players.flatMap(p => p ? [{ ...this.profiles.get(p) as Profile, name: p.username }] : []),
            ...this.bots.map((bot, i) => ({ ...bot, name: cpuName(i) }))
        ];
        this.engine = new MonopolyEngine(profiles, this.settings, crypto.randomBytes(4).readUInt32LE(), Date.now());
        this.seatTokens = profiles.map(() => crypto.randomBytes(24).toString('hex'));
        this.config.holdEmptySeats = true;
        this.generation++;
        this.seen.clear();
        return true;
    }

    private rematch(): void {
        const seats = this.engine?.players ?? [];
        this.players.forEach((client, i) => {
            if (!client) return;
            client.ready = false;
            this.profiles.set(client, { token: seats[i].token, skin: seats[i].skin });
        });
        this.players = this.players.filter(p => p !== null);
        for (const client of this.observers) {
            if (this.playerCount + this.bots.length >= this.settings.playerLimit) break;
            this.observers.delete(client);
            client.ready = false;
            this.players.push(client);
            this.playerCount++;
            const token = this.freeToken();
            this.profiles.set(client, { token, skin: token + 1 });
        }
        clearTimeout(this.botTimer);
        this.botTimer = undefined;
        this.engine = null;
        this.generation++;
        this.seatTokens = [];
        this.config.holdEmptySeats = this.observers.size > 0;
        this.seen.clear();
        this.actions.clear();
        this.previews.clear();
        this.broadcastWhoYouAre();
    }

    onMove(client: Client, move: Command): void {
        const seat = this.players.indexOf(client);
        if (move?.action === 'PREVIEW_END') {
            if (move.generation !== this.generation) return;
            const pose = this.engine?.players[seat]?.pose;
            if (pose && this.previews.delete(client)) this.broadcast({ type: 'PREVIEW', seat, pose });
            return;
        }
        const now = Date.now();
        let rate = this.limits.get(client);
        if (!rate || now - rate.time >= 1000) {
            rate = { time: now, moves: 0, preview: rate?.preview ?? 0 };
            this.limits.set(client, rate);
        }
        if (++rate.moves > 30) return;
        if (!move || typeof move.action !== 'string' || typeof move.actionId !== 'string' ||
            !move.actionId || move.actionId.length > 80 || typeof move.seq !== 'number' ||
            !Number.isSafeInteger(move.seq) || move.seq < 0) return this.error(client, 'Invalid move');
        if (move.action === 'RESUME') {
            if (!this.observers.has(client) || !this.resume(client, move.token, move.seq))
                return this.error(client, 'Seat unavailable');
            return this.syncAll();
        }
        if (seat < 0) return this.error(client, 'Watching only');
        if (move.generation !== this.generation) {
            this.error(client, 'Room changed. Try again.');
            return this.send(client, this.globalStateSync(client));
        }
        if (move.action === 'PREVIEW') {
            if (!this.engine || this.engine.players[seat].eliminated || now - rate.preview < 66) return;
            const pose = move.pose as Partial<Pose> | undefined;
            if (!pose || typeof pose.x !== 'number' || typeof pose.y !== 'number' || typeof pose.angle !== 'number' ||
                ![pose.x, pose.y, pose.angle].every(v => Number.isFinite(v) && Math.abs(v) <= 2000)) return;
            rate.preview = now;
            this.previews.add(client);
            for (const other of [...this.players, ...this.observers]) if (other && other !== client)
                this.send(other, { type: 'PREVIEW', seat, pose: { x: pose.x, y: pose.y, angle: pose.angle } });

            return;
        }
        const key = this.engine ? seat : client;
        const ids = this.actions.get(key) ?? new Set<string>();
        if (ids.has(move.actionId)) {
            console.warn('Super Monopoly: duplicate move');
            return this.send(client, this.globalStateSync(client));
        }
        if (move.seq !== (this.engine?.seq ?? 0) &&
            !(['BID', 'ABSTAIN'].includes(move.action) && this.engine?.isCurrentAuctionSnapshot(move.seq))) {
            this.error(client, 'State changed. Try again.');
            return this.send(client, this.globalStateSync(client));
        }
        if (move.action === 'RETURN_TO_LOBBY' && this.engine?.phase.kind === 'over' && this.host() === client) {
            this.rematch();
            return this.syncAll();
        }
        const accepted = this.engine ? this.engine.command(seat, move, now) : this.lobby(client, move);
        if (!accepted) {
            console.warn('Super Monopoly: rejected move');
            return this.error(client, 'Move not available');
        }
        ids.add(move.actionId);
        this.actions.set(key, ids);
        this.syncAll();
    }

    globalStateSync(client: Client): Sync {
        const youAre = this.players.indexOf(client);
        const engine = this.engine;
        const view = engine?.view(youAre) ?? null;
        const events = engine?.eventsSince(this.seen.get(client) ?? 0, youAre) ?? [];
        if (engine) this.seen.set(client, engine.seq);
        return {
            type: 'SYNC', started: !!engine, youAre, isHost: this.host() === client,
            generation: this.generation, settings: this.settings, view, events,
            ...(engine && youAre >= 0 ? { resumeToken: this.seatTokens[youAre] } : {}),
            seats: [
                ...this.players.map((p, i) => {
                    const profile = engine?.players[i] ?? (p ? this.profiles.get(p) : undefined);
                    return {
                        token: profile?.token ?? i, skin: profile?.skin ?? i + 1,
                        username: engine?.players[i].name ?? p?.username ?? `Player ${i + 1}`,
                        ready: p?.ready ?? false, connected: p !== null
                    };
                }),
                ...this.bots.map((bot, i) => {
                    const profile = engine?.players[this.players.length + i] ?? bot;
                    return { token: profile.token, skin: profile.skin, username: cpuName(i),
                        ready: true, connected: true, bot: true };
                })
            ]
        };
    }

    private syncAll(): void {
        for (const client of [...this.players, ...this.observers]) if (client)
            this.send(client, this.globalStateSync(client));

        clearTimeout(this.timer);
        if (this.engine && this.engine.deadline !== null) {
            this.timer = setTimeout(() => {
                if (!this.playerCount && !this.observers.size) return this.close();
                this.engine?.timeout(Date.now());
                this.syncAll();
            }, Math.max(0, this.engine.deadline - Date.now()));
            this.timer.unref();
        }
        if (this.playerCount || this.observers.size) {
            clearTimeout(this.idle);
            this.idle = undefined;
        } else if (this.config.holdEmptySeats && !this.idle) {
            this.idle = setTimeout(() => {
                if (!this.playerCount && !this.observers.size) this.close();
            }, 15 * 60_000);
            this.idle.unref();
        }
        this.scheduleBots();
    }

    private close(): void {
        void import('../games.js').then(({ removeGame }) => removeGame(this.uuid));
    }

    private nextBotMove(): { seat: number; move: Command } | null {
        const engine = this.engine;
        if (!engine) return null;
        const moves = this.bots.flatMap((_, i) => {
            const seat = this.players.length + i;
            const move = cpuMove(engine, seat);
            if (!move) return [];
            return [{ seat, move: move.action === 'BUY' && this.scanned !== engine.phase ? { action: 'SCAN' } : move }];
        });
        return moves.length ? moves[Math.floor(Math.random() * moves.length)] : null;
    }

    private armBots(wait: number): void {
        this.botTimer = setTimeout(() => {
            this.botTimer = undefined;
            this.runBots();
        }, wait);
        this.botTimer.unref();
    }

    private scheduleBots(): void {
        const engine = this.engine;
        if (this.botTimer || !engine || (!this.playerCount && !this.observers.size)) return;
        const next = this.nextBotMove();
        if (!next) return;
        const [min, max] = cpuDelay(next.move);
        const wait = Math.max(0, engine.readyAt - Date.now()) + min + Math.random() * (max - min);
        this.armBots(engine.deadline === null ? wait : Math.min(wait, Math.max(0, engine.deadline - Date.now() - 300)));
    }

    private runBots(): void {
        const engine = this.engine;
        const next = this.nextBotMove();
        if (!engine || !next) return;
        const wait = engine.readyAt - Date.now();
        if (wait > 0 && (engine.deadline === null || Date.now() + wait < engine.deadline - 300))
            return this.armBots(wait + 100);
        if (next.move.action === 'SCAN') this.scanned = engine.phase;
        if (engine.command(next.seat, next.move, Date.now())) this.syncAll();
    }

    onRemove(): void {
        clearTimeout(this.timer);
        clearTimeout(this.botTimer);
        clearTimeout(this.idle);
        for (const client of this.observers) client.gameID = '';
        this.observers.clear();
        this.engine = null;
    }
}
