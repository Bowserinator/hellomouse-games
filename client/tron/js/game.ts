/** Page logic for Tron: connection, round flow, input and the render loop. */
import { connectToGame } from '../../shared/ts/game-connection.js';
import type { GameConnection } from '../../shared/ts/game-connection.js';
import type { NativeDialog } from '../../shared/ts/dom.js';
import { Arena } from './arena.js';
import { COLORS, PRE_ROUND_DELAY, SPECTATE_DELAY } from './config.js';
import { Lobby } from './lobby.js';
import { LobbyScene } from './lobby-scene.js';
import { drawArena } from './render.js';
import type { Camera } from './render.js';
import type {
    DeadMessage, GameOverMessage, RoundEndMessage, RoundMessage, SyncMessage, TurnMessage
} from './types.js';

const el = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const KEY_DIRECTIONS: Record<string, number> = {
    w: 0, arrowup: 0, d: 1, arrowright: 1, s: 2, arrowdown: 2, a: 3, arrowleft: 3
};

const canvas = el<HTMLCanvasElement>('board');
const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
const arena = new Arena();
const camera: Camera = { x: 0, y: 0 };
const scene = new LobbyScene();

let connection: GameConnection;
let sync: SyncMessage | null = null;
let colors: Array<string> = [];
let round = 0;
let totalRounds = 0;
let startLocal = 0;
let deathSentAt = 0;
let deathSent = false;
let spectateIndex = 0;
let stepTimer: ReturnType<typeof setTimeout> | undefined;
let spectateText = '';
let clockOffset: number | null = null;
let bestPing = Infinity;

function send(message: Record<string, unknown>) {
    connection.send(message);
}

const lobby = new Lobby(send);

function seatName(seat: number): string {
    return sync?.seats[seat]?.username ?? '';
}

function renderHud() {
    el('round').textContent = `ROUND ${round} / ${totalRounds}`;
    el('scores').replaceChildren(...(sync?.seats ?? []).map((seat, index) => {
        const item = document.createElement('li');
        item.style.setProperty('--player-color', colors[index]);
        item.classList.toggle('dead', !arena.racers[index]?.alive);
        item.classList.toggle('you', index === sync?.youAre);
        const name = document.createElement('span');
        name.textContent = seat.username;
        const score = document.createElement('b');
        score.textContent = String(seat.score);
        item.append(name, score);
        return item;
    }));
}

function showBanner(text: string, color = '') {
    el('banner').textContent = text;
    el('banner').style.color = color;
    el('banner').hidden = !text;
}

function handleSync(message: SyncMessage) {
    sync = message;
    colors = message.seats.map(seat => COLORS[seat.color]);
    const inLobby = message.phase === 'lobby';
    el('lobby').hidden = !inLobby;
    el('hud').hidden = inLobby;
    if (inLobby) {
        arena.frozen = true;
        showBanner('');
        el('spectate').hidden = true;
        lobby.render(message);
    } else renderHud();
}

function handleRound(message: RoundMessage) {
    const now = Date.now();
    const start = clockOffset === null ? now + PRE_ROUND_DELAY : message.startAt - clockOffset;
    startLocal = Math.min(start, now + 2 * PRE_ROUND_DELAY);
    round = message.round;
    totalRounds = message.total;
    deathSent = false;
    spectateIndex = 0;

    arena.reset(message.size, message.spawns, sync?.youAre ?? -1, message.stepMs, startLocal);
    const spawn = message.spawns[arena.me];
    if (spawn) {
        camera.x = spawn.x + 0.5;
        camera.y = spawn.y + 0.5;
    }
    showBanner(`ROUND ${round}`);
    renderHud();

    const current = round;
    setTimeout(() => {
        if (round === current && !arena.frozen) showBanner('');
    }, Math.max(0, startLocal - now));
    runSteps();
}

function handleRoundEnd(message: RoundEndMessage) {
    arena.frozen = true;
    clearTimeout(stepTimer);
    if (message.winner === -1) showBanner('TIE');
    else showBanner(`${seatName(message.winner)} WINS`, colors[message.winner]);
}

function handleGameOver(message: GameOverMessage) {
    const sorted = [...message.results].sort((a, b) => b.score - a.score);
    el('result-list').replaceChildren(...sorted.map(result => {
        const item = document.createElement('li');
        item.style.setProperty('--player-color', COLORS[result.color]);
        item.textContent = `${result.username} · ${result.score}`;
        return item;
    }));
    el<NativeDialog>('results').showModal();
}

function handleTurn(message: TurnMessage) {
    arena.applyTurn(message.seat, message.t, message.cell, message.dir);
    flush();
}

function handleDead(message: DeadMessage) {
    arena.applyDeath(message.seat, message.t);
    renderHud();
}

function handlePing(message: Record<string, unknown>) {
    const now = Date.now();
    const rtt = now - (message.ping as number);
    if (rtt <= bestPing) {
        bestPing = rtt;
        clockOffset = (message.serverTime as number) - (now - rtt / 2);
    }
}

connection = connectToGame({
    gameType: 'tron',
    pingIntervalInMilliseconds: 2000,
    pingLabel: el('ping'),
    disconnectBanner: el('disconnect-banner'),
    onOpen: () => send({ type: 'PING', ping: Date.now() }),
    onMessage: message => {
        switch (message.type) {
            case 'SYNC': return handleSync(message as unknown as SyncMessage);
            case 'ROUND': return handleRound(message as unknown as RoundMessage);
            case 'TURN': return handleTurn(message as unknown as TurnMessage);
            case 'DEAD': return handleDead(message as unknown as DeadMessage);
            case 'ROUND_END': return handleRoundEnd(message as unknown as RoundEndMessage);
            case 'GAME_OVER': return handleGameOver(message as unknown as GameOverMessage);
            case 'PING': return handlePing(message);
            case 'UUID': return void (el<HTMLInputElement>('invite').value = location.href);
            case 'ERROR': return void alert(String(message.error));
        }
    }
});

/** Send direction changes of the local racer, then its death notice */
function flush() {
    arena.pendingTurns.forEach(turn => send({ type: 'MOVE', action: 'TURN', ...turn }));
    arena.pendingTurns = [];

    if (arena.selfDeathTick !== null && !deathSent) {
        deathSent = true;
        deathSentAt = Date.now();
        send({ type: 'MOVE', action: 'DEAD', t: arena.selfDeathTick });
        renderHud();
    }
}

/** Step the local racer exactly when each step is due, sending it right away */
function runSteps() {
    clearTimeout(stepTimer);
    arena.update(Date.now());
    flush();

    const racer = arena.racers[arena.me];
    if (arena.frozen || !racer || !racer.alive) return;
    const nextAt = startLocal + (racer.tick + 1) * arena.stepMs;
    stepTimer = setTimeout(runSteps, Math.max(0, nextAt - Date.now()));
}

window.addEventListener('keydown', event => {
    const key = event.key.toLowerCase();
    if (event.target instanceof HTMLInputElement || !(key in KEY_DIRECTIONS)) return;
    event.preventDefault();

    const racer = arena.racers[arena.me];
    if (racer && !racer.alive) {
        if (key === 'a' || key === 'arrowleft') spectateIndex++;
        else if (key === 'd' || key === 'arrowright') spectateIndex--;
    } else arena.turn(KEY_DIRECTIONS[key]);
});

el('results-close').onclick = () => el<NativeDialog>('results').close();

function cameraTarget(): { seat: number; spectating: boolean } {
    const racer = arena.racers[arena.me];
    if (!racer || racer.alive || !deathSent || Date.now() - deathSentAt < SPECTATE_DELAY)
        return { seat: arena.me, spectating: false };
    const alive = arena.aliveSeats();
    if (!alive.length) return { seat: arena.me, spectating: false };
    const seat = alive[((spectateIndex % alive.length) + alive.length) % alive.length];
    return { seat, spectating: true };
}

let lastFrame = performance.now();
function draw(time: number) {
    const dt = Math.min(0.1, (time - lastFrame) / 1000);
    lastFrame = time;

    const now = Date.now();
    if (!sync || sync.phase === 'lobby') {
        scene.update(now);
        drawArena(ctx, scene.arena, scene.camera, scene.colors, now);
        requestAnimationFrame(draw);
        return;
    }

    arena.update(now);
    flush();
    const target = cameraTarget();
    const racer = arena.racers[target.seat];
    if (racer) {
        const head = arena.visualPosition(racer, now);
        const blend = 1 - Math.exp(-dt * 12);
        camera.x += (head.x + 0.5 - camera.x) * blend;
        camera.y += (head.y + 0.5 - camera.y) * blend;
    }
    drawArena(ctx, arena, camera, colors, now);

    const text = target.spectating ? `SPECTATING ${seatName(target.seat)} · A / D` : '';
    if (text !== spectateText) {
        spectateText = text;
        el('spectate').textContent = text;
        el('spectate').hidden = !text;
    }
    requestAnimationFrame(draw);
}
requestAnimationFrame(draw);

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();
