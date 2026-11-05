import Game from '../game.js';
import Client from '../client.js';
import { Action, GalaxySync, TankState } from '../../client/galaxy_tanks/js/types.js';
import { MAX_PLAYERS, ROUND_ARRAY, TANK_COLORS, TANK_SPEED, UPDATE_EVERY_N_MS } from '../../client/galaxy_tanks/js/vars.js';
import { GameState } from '../../client/galaxy_tanks/js/sim/gamestate.js';
import { generateMap } from '../../client/galaxy_tanks/js/sim/mapgen/index.js';
import { Tank } from '../../client/galaxy_tanks/js/sim/tank.js';
import { copy, finiteTuple, fromTuple, length, normalize, tangentProject, vec } from '../../client/galaxy_tanks/js/sim/math/vec3.js';

import { angDist } from '../../client/galaxy_tanks/js/sim/math/sphere.js';

interface Intent {
    p?: unknown; d?: unknown; h?: unknown; turn?: unknown;
    action?: Action; type?: GalaxySync; direction?: unknown; aim?: unknown; color?: number; round?: number;
}
export default class GalaxyTankGame extends Game {
    state = new GameState();
    seats = new Map<string, Tank>();
    interval: ReturnType<typeof setInterval> | null = null;
    private lastTick = 0;
    private ticks = 0;
    private lastPosition = new Map<number, number>();
    constructor() {
        super({ syncAfterMove: false, maxLobbies: 6 });
    }
    onRoomCreate(): void {
        this.state.setMap(generateMap(Math.floor(Math.random() * 0xffffffff)));
        this.lastTick = Date.now();
        this.interval = setInterval(() => this.tick(Date.now()), UPDATE_EVERY_N_MS);
    }
    globalStateSync(): MessageData {
        return { type: 'GALAXY_CONNECTED' };
    }
    private send(client: Client, message: Record<string, unknown>): void {
        client.connection.sendUTF(JSON.stringify(message));
    }
    private host(): Tank | undefined {
        return this.state.tanks.find(t => !t.missingPlayer);
    }
    private addSeat(client: Client): Tank | undefined {
        let tank = this.state.tanks.find(t => t.missingPlayer);
        if (!tank && this.state.inLobby && this.state.tanks.length < MAX_PLAYERS) {
            tank = new Tank(this.state.tanks.length);
            tank.color = TANK_COLORS.findIndex((_, i) => !this.state.tanks.some(t => t.color === i));
            this.state.tanks.push(tank);
        }
        if (!tank) return;
        tank.username = client.username;
        tank.missingPlayer = false;
        tank.ready = tank === this.host();
        client.ready = tank.ready;
        this.seats.set(client.id, tank);
        return tank;
    }
    onJoin(client: Client): boolean {
        if (!super.onJoin(client)) return false;
        this.addSeat(client);
        this.snapshot(client);
        this.recreate();
        return true;
    }
    snapshot(client: Client): void {
        const tank = this.seats.get(client.id);
        this.send(client, { type: GalaxySync.MAP_DESC, map: this.state.world.desc });
        this.send(client, { type: GalaxySync.CREATE_ALL_TANKS,
            data: this.state.tanks.map(t => t.sync(false)), id: tank?.id ?? -1 });
        this.send(client, { type: GalaxySync.STATE_SYNC, data: this.state.sync() });
        this.send(client, { type: GalaxySync.SYNC_ALL_BULLETS, bullets: this.state.bullets });
        this.send(client, { type: GalaxySync.ADD_POWERUP_ITEM, items: this.state.powerupItems });
        this.send(client, { type: GalaxySync.CHANGE_ROUNDS, round: ROUND_ARRAY.indexOf(this.state.totalRounds) });
        for (const t of this.state.tanks)
            if (t.state === TankState.FLYING)
                this.send(client, { type: GalaxySync.FLIGHT_START, id: t.id, star: t.flightStar, t0: t.flightStart });
        if (!tank) this.send(client, { type: GalaxySync.YOUARE_SPECTATOR });
    }
    private recreate(): void {
        for (const client of this.players)
            if (client) this.send(client, { type: GalaxySync.CREATE_ALL_TANKS,
                data: this.state.tanks.map(t => t.sync(false)), id: this.seats.get(client.id)?.id ?? -1 });
        this.broadcast({ type: GalaxySync.SPECTATOR_COUNT, count: this.playerCount - this.seats.size });
    }
    onDisconnect(client: Client): void {
        const tank = this.seats.get(client.id);
        this.seats.delete(client.id);
        super.onDisconnect(client);
        if (tank) {
            tank.missingPlayer = true;
            tank.firing = false;
            tank.ready = false;
            tank.turn = 0;
            copy(tank.move, vec());
        }
        if (this.state.inLobby) this.resetLobby();
        this.recreate();
    }
    private resetLobby(): void {
        this.state.tanks = this.state.tanks.filter(t => !t.missingPlayer);
        this.state.tanks.forEach((t, i) => {
            t.id = i;
            t.ready = false;
            t.firing = false;
        });
        for (const c of this.players)
            if (c) c.ready = false;
        const host = this.host();
        if (host) host.ready = true;
        for (const c of this.players)
            if (c) c.ready = this.seats.get(c.id)?.ready ?? false;
    }
    onReady(client: Client): void {
        const tank = this.seats.get(client.id);
        if (!tank || !this.state.inLobby) {
            client.ready = false;
            return;
        }
        if (tank === this.host()) {
            tank.ready = true;
            client.ready = true;
            const players = this.state.tanks.filter(t => !t.missingPlayer);
            if (players.length >= 2 && players.every(t => t.ready)) {
                this.state.startGame(Date.now());
                this.broadcast({ type: GalaxySync.MAP_DESC, map: this.state.world.desc });
                this.recreate();
                this.broadcast({ type: GalaxySync.STATE_SYNC, data: this.state.sync() });
            }
        } else tank.ready = client.ready;
        this.recreate();
    }
    onUsernameChange(client: Client): void {
        const t = this.seats.get(client.id);
        if (t && /^[a-zA-Z0-9_]{1,16}$/.test(client.username)) t.username = client.username;
        this.recreate();
    }
    onMessage(client: Client, msg: Intent): void {
        if (msg.type === GalaxySync.JOIN_PLAYER && this.state.inLobby && !this.seats.has(client.id)) {
            if (this.addSeat(client)) {
                this.snapshot(client);
                this.recreate();
            }
            return;
        }
        const t = this.seats.get(client.id);
        if (!t || !this.state.inLobby ||
            (msg.type !== GalaxySync.CHANGE_COLOR && msg.type !== GalaxySync.CHANGE_ROUNDS)) return;
        if (msg.type === GalaxySync.CHANGE_COLOR && Number.isInteger(msg.color) &&
            msg.color! >= 0 && msg.color! < TANK_COLORS.length &&
            !this.state.tanks.some(other => other !== t && other.color === msg.color)) t.color = msg.color!;
        if (msg.type === GalaxySync.CHANGE_ROUNDS && t === this.host() && Number.isInteger(msg.round) &&
            ROUND_ARRAY[msg.round!] !== undefined) this.state.totalRounds = ROUND_ARRAY[msg.round!];
        this.broadcast({ type: GalaxySync.CHANGE_ROUNDS, round: ROUND_ARRAY.indexOf(this.state.totalRounds) });
        this.recreate();
    }
    onMove(client: Client, msg: Intent): void {
        const tank = this.seats.get(client.id);
        if (!tank || this.state.inLobby || this.state.roundEnd || this.state.now < this.state.roundStart ||
            tank.isDead || tank.state === TankState.FLYING || tank.state === TankState.FALLING) return;
        if (msg.action === Action.MOVE_INTENT && finiteTuple(msg.direction)) {
            const move = fromTuple(msg.direction), turn = msg.turn ?? 0;
            if (length(move) > 1.01 || typeof turn !== 'number' || !Number.isInteger(turn) || Math.abs(turn) > 1) return;
            tank.turn = turn;
            tangentProject(tank.move, move, tank.dir);
            if (length(tank.move) > 1) normalize(tank.move, tank.move);
            tank.lastInput = Date.now();
        }
        if ((msg.action === Action.UPDATE_AIM || msg.action === Action.FIRE) && finiteTuple(msg.aim)) {
            const aim = fromTuple(msg.aim), len = length(aim);
            if (len < 0.9 || len > 1.1) return;
            tangentProject(aim, aim, tank.dir);
            if (length(aim) < 0.1) return;
            normalize(tank.aim, aim);
        }
        if (msg.action === Action.LEAP) tank.leap();
        if (msg.action === Action.POUND) tank.pound();
        if (msg.action === Action.FIRE && tank.iFrames <= 0) tank.firing = true;
        if (msg.action === Action.STOP_FIRE) tank.firing = false;
        if (msg.action === Action.UPDATE_STATE) {
            const now = Date.now();
            const elapsed = Math.min(0.2, (now - (this.lastPosition.get(tank.id) ?? now - 30)) / 1000);
            let valid = false;
            if (msg.p === tank.planet && finiteTuple(msg.d) && typeof msg.h === 'number' && Number.isFinite(msg.h)) {
                const dir = fromTuple(msg.d), len = length(dir);
                if (Math.abs(len - 1) < 0.003) {
                    normalize(dir, dir);
                    const radius = this.state.world.desc.planets[tank.planet].radius;
                    const support = this.state.world.colliders.supportHeight(tank.planet, dir, 1.1, msg.h);
                    const probe = { planet: tank.planet, dir: { ...dir }, vel: { ...tank.vel }, h: msg.h };
                    this.state.world.colliders.resolve(probe);
                    valid = angDist(tank.dir, dir) * radius <= TANK_SPEED * elapsed * 1.5 + 0.6 &&
                        msg.h >= support - 0.05 && msg.h <= support + 4.5 &&
                        Math.abs(msg.h - tank.h) <= 0.5 + (Math.abs(tank.vy) + 14) * elapsed &&
                        angDist(dir, probe.dir) * radius < 0.02;
                    if (valid) {
                        copy(tank.dir, dir);
                        tank.h = Math.max(support, msg.h);
                    }
                }
            }
            this.lastPosition.set(tank.id, now);
            if (!valid) this.send(client, { type: GalaxySync.CORRECT_POSITION, data: tank.sync(false) });
        }
    }
    tick(now: number): void {
        const dt = Math.min(0.06, Math.max(0, (now - this.lastTick) / 1000));
        this.lastTick = now;
        for (const t of this.state.tanks)
            if (now - t.lastInput > 600) {
                copy(t.move, vec());
                t.turn = 0;
                t.firing = false;
            }
        const wasLobby = this.state.inLobby;
        // Bound collision integration even after an event-loop stall.
        const steps = Math.max(1, Math.ceil(dt / 0.02));
        for (let i = 0; i < steps; i++) this.state.update(dt / steps, now - (steps - 1 - i) * dt * 1000 / steps);
        for (const event of this.state.events)
            if (event.type === GalaxySync.CREATE_ALL_TANKS) this.recreate();
            else this.broadcast(event);
        this.state.events.length = 0;
        if (!wasLobby && this.state.inLobby) {
            this.resetLobby();
            this.state.tanks.forEach(t => {
                t.score = 0;
            });
            this.recreate();
        }
        this.broadcast({ type: GalaxySync.GENERIC_TANK_SYNC, data: this.state.tanks.map(t => t.sync()), time: now });
        this.broadcast({ type: GalaxySync.STATE_SYNC, data: this.state.sync() });
        if (++this.ticks % 5 === 0)
            this.broadcast({ type: GalaxySync.SYNC_ALL_BULLETS, bullets: this.state.bullets });
    }
    onRemove(): void {
        if (this.interval) clearInterval(this.interval);
        this.interval = null;
    }
}
