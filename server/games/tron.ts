import Game from '../game.js';
import Client from '../client.js';
import {
    COLORS, DEATH_GRACE_MS, DEFAULT_SETTINGS, DELAY_AFTER_ROUND, MAP_SIZES, MAX_PLAYERS,
    PRE_ROUND_DELAY, ROUND_OPTIONS, SPAWN_MARGIN, SPEED_MULTIPLIERS, stepInterval
} from '../../client/tron/js/config.js';
import type { Move, Phase, Settings, Spawn, SyncMessage } from '../../client/tron/js/types.js';

interface Seat {
    client: Client | null;
    username: string;
    color: number;
    score: number;
    alive: boolean;
    deathTick: number;
}

function spawnPoints(size: number, count: number): Array<Spawn> {
    const side = size - 1 - 2 * SPAWN_MARGIN;
    const perimeter = 4 * side;
    const spawns: Array<Spawn> = [];
    for (let i = 0; i < count; i++) {
        const p = Math.round(i * perimeter / count);
        const edge = Math.floor(p / side) % 4;
        const o = p % side;
        const m = SPAWN_MARGIN;
        if (edge === 0) spawns.push({ x: m + o, y: m, dir: 2 });
        else if (edge === 1) spawns.push({ x: m + side, y: m + o, dir: 3 });
        else if (edge === 2) spawns.push({ x: m + side - o, y: m + side, dir: 0 });
        else spawns.push({ x: m, y: m + side - o, dir: 1 });
    }
    return spawns;
}

function shuffle<T>(items: Array<T>): Array<T> {
    for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
}

class TronGame extends Game {
    private seats: Array<Seat> = [];
    private settings: Settings = { ...DEFAULT_SETTINGS };
    private phase: Phase = 'lobby';
    private round = 0;
    private roundStartAt = 0;
    private endTimer: ReturnType<typeof setTimeout> | null = null;
    private nextTimer: ReturnType<typeof setTimeout> | null = null;

    constructor() {
        super({ syncAfterMove: false, allowChat: false, maxLobbies: 20 });
    }

    onRoomCreate() {
        // Nothing to prepare until players join
    }

    onJoin(client: Client): boolean {
        if (this.phase !== 'lobby' || this.seats.length >= MAX_PLAYERS) return false;
        if (!super.onJoin(client)) return false;

        client.ready = false;
        const taken = this.seats.map(seat => seat.color);
        this.seats.push({
            client,
            username: client.username,
            color: COLORS.findIndex((_, index) => !taken.includes(index)),
            score: 0,
            alive: false,
            deathTick: 0
        });
        return true;
    }

    onDisconnect(client: Client) {
        const index = this.seatOf(client);
        super.onDisconnect(client);
        if (index === -1) return;

        const seat = this.seats[index];
        seat.username = client.username;
        seat.client = null;
        if (this.phase === 'lobby') this.seats.splice(index, 1);
        else this.kill(index, this.currentTick());
    }

    onRemove() {
        this.clearTimers();
    }

    onUsernameChange() {
        this.syncAll();
    }

    onReady() {
        this.syncAll();
    }

    globalStateSync(client: Client): SyncMessage {
        return {
            type: 'SYNC',
            phase: this.phase,
            youAre: this.seatOf(client),
            settings: { ...this.settings },
            seats: this.seats.map((seat, index) => ({
                username: seat.client?.username ?? seat.username,
                color: seat.color,
                ready: index === 0 || (seat.client?.ready ?? false),
                connected: seat.client !== null,
                score: seat.score
            }))
        };
    }

    onMove(client: Client, move: Move) {
        const index = this.seatOf(client);
        if (index === -1 || !move) return;

        switch (move.action) {
            case 'COLOR':
                if (this.phase !== 'lobby' || !Number.isInteger(move.color)) return;
                if (!COLORS[move.color as number] || this.seats.some(seat => seat.color === move.color)) return;
                this.seats[index].color = move.color as number;
                this.syncAll();
                break;
            case 'SETTINGS':
                if (this.phase !== 'lobby' || index !== 0) return;
                this.applySetting('size', move.size, MAP_SIZES.length);
                this.applySetting('speed', move.speed, SPEED_MULTIPLIERS.length);
                this.applySetting('rounds', move.rounds, ROUND_OPTIONS.length);
                this.syncAll();
                break;
            case 'START':
                if (this.phase === 'lobby' && index === 0 && this.canStart()) this.startGame();
                break;
            case 'TURN':
                this.relayTurn(index, move);
                break;
            case 'DEAD':
                if (this.phase === 'playing' && Number.isInteger(move.t)) this.kill(index, move.t as number);
                break;
        }
    }

    private seatOf(client: Client): number {
        return this.seats.findIndex(seat => seat.client === client);
    }

    private applySetting(key: keyof Settings, value: number | undefined, count: number) {
        if (Number.isInteger(value) && (value as number) >= 0 && (value as number) < count)
            this.settings[key] = value as number;
    }

    private canStart(): boolean {
        return this.seats.length >= 2 && this.seats.every((seat, index) => index === 0 || seat.client?.ready);
    }

    private connectedCount(): number {
        return this.seats.filter(seat => seat.client !== null).length;
    }

    private currentTick(): number {
        const elapsed = Date.now() - this.roundStartAt;
        return Math.max(0, Math.floor(elapsed / stepInterval(this.settings.speed)));
    }

    private startGame() {
        this.seats.forEach(seat => seat.score = 0);
        this.round = 0;
        this.syncAll();
        this.startRound();
    }

    private startRound() {
        this.round++;
        this.phase = 'playing';
        this.roundStartAt = Date.now() + PRE_ROUND_DELAY;

        const size = MAP_SIZES[this.settings.size];
        const active = this.seats.map((seat, index) => seat.client ? index : -1).filter(index => index !== -1);
        const points = shuffle(spawnPoints(size, active.length));
        const spawns: Array<Spawn | null> = this.seats.map(() => null);
        active.forEach((seatIndex, i) => spawns[seatIndex] = points[i]);

        this.seats.forEach((seat, index) => {
            seat.alive = spawns[index] !== null;
            seat.deathTick = seat.alive ? Infinity : -1;
        });
        this.syncAll();
        this.broadcast({
            type: 'ROUND',
            round: this.round,
            total: ROUND_OPTIONS[this.settings.rounds],
            size,
            stepMs: stepInterval(this.settings.speed),
            startAt: this.roundStartAt,
            spawns
        });
    }

    private relayTurn(index: number, move: Move) {
        const { t, cell, dir } = move;
        const limit = MAP_SIZES[this.settings.size] ** 2;
        if (this.phase !== 'playing' || !this.seats[index].alive) return;
        if (!Number.isInteger(t) || !Number.isInteger(cell) || !Number.isInteger(dir)) return;
        if ((t as number) < 0 || (cell as number) < 0 || (cell as number) >= limit || (dir as number) < 0 || (dir as number) > 3)
            return;

        const message = JSON.stringify({ type: 'TURN', seat: index, t, cell, dir });
        for (const seat of this.seats)
            if (seat.client && seat.client !== this.seats[index].client)
                seat.client.connection.sendUTF(message);
    }

    private kill(index: number, tick: number) {
        const seat = this.seats[index];
        if (this.phase !== 'playing' || !seat.alive) return;
        seat.alive = false;
        seat.deathTick = tick;
        this.broadcast({ type: 'DEAD', seat: index, t: tick });

        const alive = this.seats.filter(other => other.alive).length;
        if (alive <= 1 && this.endTimer === null)
            this.endTimer = setTimeout(() => this.finishRound(), DEATH_GRACE_MS);
    }

    private finishRound() {
        this.endTimer = null;
        this.phase = 'between';

        // Whoever outlived everyone else wins, simultaneous deaths tie
        const best = Math.max(...this.seats.map(seat => seat.deathTick));
        const leaders = this.seats.filter(seat => seat.deathTick === best);
        const winner = leaders.length === 1 ? this.seats.indexOf(leaders[0]) : -1;
        if (winner !== -1) this.seats[winner].score++;

        this.syncAll();
        this.broadcast({ type: 'ROUND_END', winner });
        this.nextTimer = setTimeout(() => {
            this.nextTimer = null;
            if (this.round >= ROUND_OPTIONS[this.settings.rounds] || this.connectedCount() < 2)
                this.endGame();
            else this.startRound();
        }, DELAY_AFTER_ROUND);
    }

    private endGame() {
        this.broadcast({
            type: 'GAME_OVER',
            results: this.seats.map(seat => ({
                username: seat.client?.username ?? seat.username,
                color: seat.color,
                score: seat.score
            }))
        });
        this.phase = 'lobby';
        this.seats = this.seats.filter(seat => seat.client !== null);
        this.seats.forEach(seat => {
            seat.score = 0;
            (seat.client as Client).ready = false;
        });
        this.syncAll();
    }

    private clearTimers() {
        if (this.endTimer !== null) clearTimeout(this.endTimer);
        if (this.nextTimer !== null) clearTimeout(this.nextTimer);
        this.endTimer = this.nextTimer = null;
    }

    private syncAll() {
        for (const seat of this.seats)
            if (seat.client)
                seat.client.connection.sendUTF(JSON.stringify(this.globalStateSync(seat.client)));
    }
}

export default TronGame;
