import { Action, BulletType, GalaxySync, Powerup, TankState } from './types.js';
import { Tank } from './sim/tank.js';
import { MovementInput } from './movement-input.js';
import { World } from './sim/world/planet.js';
import { MapDesc } from './sim/mapgen/map-desc.js';
import { Bullet, PowerupItem } from './sim/bullet.js';
import { StateSync } from './sim/gamestate.js';
import { copy, length, tangentProject, tuple, V3 } from './sim/math/vec3.js';
import { GameView } from './render/game-view.js';
import { makePalette } from './render/tank/tank-rig.js';
import { DEFAULT_TANK_STYLE } from './render/tank/tank-style.js';
import { Lobby, el } from './lobby.js';
import { bulletTimeScale, timeScaleAt } from './sim/chrono.js';
import { POWERUPS } from './sim/powerups.js';
import { DASH_COOLDOWN, MAGNET_ARM_TIME, TANK_COLORS, TANK_TURN_RATE } from './vars.js';
import { sound, setGlobalVolume, unlockLoops } from './audio/sound.js';
import { Soundscape } from './audio/soundscape.js';

// Shared site connection factory.
declare function createConnection(): WebSocket;
declare function beep(): void;
const connection = createConnection(), canvas = el('board') as HTMLCanvasElement;
let view: GameView;
try {
    view = new GameView(canvas);
} catch (error) {
    el('disconnect-banner').textContent = `WebGL could not start: ${String(error)}`;
    el('disconnect-banner').style.top = '0';
    throw error;
}
let world: World | undefined, tanks: Array<Tank> = [], bullets: Array<Bullet> = [], items: Array<PowerupItem> = [];
let pendingWorld: World | undefined, pendingMap = false;
let own = -1, target = -1, spectatorCount = 0, clockOffset = 0, deadSince = 0;
let state: StateSync = { inLobby: true, round: 0, totalRounds: 20, roundStart: 0, roundEnd: 0, serverTime: 0 };
const send = (data: Record<string, unknown>): void => {
    if (connection.readyState === WebSocket.OPEN) connection.send(JSON.stringify(data.type === 'MOVE'
        ? { ...data, seed: world?.desc.seed, round: state.round } : data));
};
const lobby = new Lobby(send), keys = new Set<string>(), mouse = new THREE.Vector2();
const ray = new THREE.Raycaster(), plane = new THREE.Plane(), hit = new THREE.Vector3();
const aimPosition = new THREE.Vector3();
const movement = new MovementInput(), movementKeys = ['w', 'a', 's', 'd'];
const soundscape = new Soundscape();
window.addEventListener('pointerdown', unlockLoops, { passive: true });
window.addEventListener('keydown', unlockLoops);
window.addEventListener('pagehide', () => soundscape.reset());
document.addEventListener('visibilitychange', () => {
    if (document.hidden) soundscape.reset();
});
const screenRight = new THREE.Vector3();
const screenForward = new THREE.Vector3();
const movementUp = new THREE.Vector3();
let usernameInitialized = false;
let automaticUsername: string | undefined;
function restoreUsername(random = false): void {
    const input = el('username') as HTMLInputElement;
    if (random || tanks.some(t => t.id !== own && t.username === input.value)) {
        do input.value = `User${Math.floor(Math.random() * 1000000)}`;
        while (tanks.some(t => t.username === input.value));
        input.dispatchEvent(new Event('input'));
    }
    automaticUsername = input.value;
    localStorage.setItem('username', input.value);
    send({ type: 'USERNAME', username: input.value });
}
let lastAmmo = '', lastLabels = 0, labelTick = 0, wipeRound = 0, wipeCovered = false;
const labels = new Map<number, HTMLSpanElement>(), mineBeeps = new Map<number, number>();
const occluded = new Map<number, boolean>();
const spectatorCountLabel = el('spectator-count'), spectatingLabel = el('spectating');
const dashBar = el('dash-bar'), dashFill = dashBar.firstElementChild as HTMLElement;
const countdownLabel = el('countdown'), debugLabel = el('debug'), nameplates = el('nameplates');
const showDebug = el('show-debug') as HTMLInputElement;
const setText = (node: HTMLElement, text: string): void => {
    if (node.textContent !== text) node.textContent = text;
};
const labelPoint = new THREE.Vector3(), beepColor = new THREE.Color(0xff1717);
let firing = false, dragging = false, lastX = 0, lastY = 0, lastIntent = 0, lastPosition = 0, previousFrame = 0;
let fps = 60, emptyFire = false, pingMs = 0;
let jumpSequence = 0, localJump = 0, jumpElapsed = 0, landingSentAt = 0;
let teleportSync = false;
let volume = Number(localStorage.getItem('galaxy-volume') ?? 50) / 100;
setGlobalVolume(volume);
const volumeInput = el('volume') as HTMLInputElement;
volumeInput.value = String(volume * 100);
volumeInput.oninput = () => {
    volume = Number(volumeInput.value) / 100;
    setGlobalVolume(volume);
    localStorage.setItem('galaxy-volume', volumeInput.value);
};
const quality = el('quality') as HTMLSelectElement;
quality.value = view.quality;
quality.onchange = () => {
    localStorage.setItem('galaxy-quality', quality.value);
    view.dispose();
    view = new GameView(canvas);
    if (world) view.setWorld(world);
};
window.addEventListener('resize', () => view.resize());
const uuid = location.search.slice(1).split('=')[0];
el('link').textContent = location.href;
connection.onopen = () => send(uuid ? { type: 'JOIN', gameID: uuid } : { type: 'CREATE', gameType: 'galaxy_tanks' });
connection.onclose = () => {
    const banner = el('disconnect-banner');
    banner.dataset.kind = 'connection';
    banner.hidden = false;
    banner.textContent = 'Disconnected from server';
    banner.style.top = '0';
    release();
    localJump = 0;
    teleportSync = false;
    soundscape.reset();
    lobby.update(tanks, own, state.inLobby, state.round, state.totalRounds, false);
    revealWipe();
};
interface Message {
    type: string | GalaxySync; uuid?: string; error?: string; code?: string; ping?: number;
    map?: MapDesc; data?: Array<string> | StateSync | string; id?: number; time?: number;
    bullets?: Array<Bullet>; bullet?: Bullet; items?: Array<PowerupItem>; item?: PowerupItem;
    ids?: Array<number>; scores?: Array<[string, number]>; count?: number;
    planet?: number; dir?: V3; velocity?: V3; h?: number; color?: number; fall?: boolean; startTime?: number;
    star?: number; t0?: number; points?: Array<V3>; powerup?: Powerup;
    radius?: number; shield?: number; a?: number; b?: number;
    seed?: number; round?: number; jump?: number; force?: boolean;
}
function restoreBullet(raw: Bullet): Bullet {
    return Object.assign(new Bullet(raw.id, raw.owner, raw.planet, raw.dir, raw.vel,
        raw.altitude, raw.type, raw.color), raw);
}
function syncTank(tank: Tank, data: string): void {
    const predicted = tank.id === own && !teleportSync ? {
        dir: { ...tank.dir }, vel: { ...tank.vel }, aim: { ...tank.aim },
        fwd: { ...tank.fwd }, h: tank.h, vy: tank.vy, state: tank.state, planet: tank.planet,
        pounding: tank.pounding, fallTime: tank.fallTime, dashCd: tank.dashCd, dashTime: tank.dashTime,
        dashDirection: { ...tank.dashDirection } } : undefined;
    if (tank.id === own) teleportSync = false;
    tank.applySync(data);
    const planet = world?.desc.planets[tank.planet];
    if (!predicted || !planet || predicted.planet !== tank.planet || tank.isDead || tank.state === TankState.FLYING) {
        if (tank.id === own) localJump = 0;
        return;
    }
    if (!state.inLobby && predicted.state !== TankState.FLYING) {
        copy(tank.dir, predicted.dir);
        copy(tank.vel, predicted.vel);
        copy(tank.aim, predicted.aim);
        copy(tank.fwd, predicted.fwd);
        tank.h = predicted.h;
        tank.vy = predicted.vy;
        tank.dashCd = predicted.dashCd;
        tank.dashTime = predicted.dashTime;
        copy(tank.dashDirection, predicted.dashDirection);
        tank.state = predicted.state;
        tank.pounding = predicted.pounding;
        tank.fallTime = predicted.fallTime;
    }
}
connection.onmessage = event => {
    let m: Message;
    try {
        m = JSON.parse(event.data);
    } catch {
        return;
    }
    if (m.type === 'UUID') {
        const url = `${location.origin}${location.pathname}?${m.uuid}`;
        history.replaceState({}, '', url);
        el('link').textContent = url;
    } else if (m.type === 'ERROR') {
        if (m.code === 'ALREADY_TAKEN_USERNAME' && automaticUsername &&
            automaticUsername === (el('username') as HTMLInputElement).value) {
            restoreUsername(true);
            return;
        }
        if (m.code === 'NO_GAME') {
            location.replace(location.pathname);
            return;
        }
        const banner = el('disconnect-banner');
        banner.dataset.kind = m.code === 'ALREADY_TAKEN_USERNAME' || m.code === 'BAD_USERNAME' ? 'username' : 'connection';
        banner.dataset.username = (el('username') as HTMLInputElement).value;
        banner.hidden = banner.dataset.kind === 'username' && !state.inLobby;
        banner.textContent = m.error ?? 'Connection error';
        banner.style.top = '0';
    } else if (m.type === 'PING') {
        pingMs = Math.max(0, Date.now() - m.ping!);
        el('ping').textContent = `Ping: ${pingMs} ms`;
    } else if (m.type === GalaxySync.MAP_DESC && m.map) {
        pendingMap = true;
        if (!world || world.desc.seed !== m.map.seed || world.desc.planets.length !== m.map.planets.length)
            pendingWorld = new World(m.map);
    } else if (m.type === GalaxySync.CREATE_ALL_TANKS && Array.isArray(m.data)) {
        const occupied = new Set(tanks.filter(tank => !tank.missingPlayer).map(tank => tank.id));
        const previous = pendingMap ? [] : tanks;
        if (pendingMap) {
            localJump = 0;
            teleportSync = false;
            soundscape.reset();
            if (pendingWorld) {
                world = pendingWorld;
                pendingWorld = undefined;
                view.setWorld(world);
            }
            bullets = [];
            items = [];
            pendingMap = false;
        }
        own = m.id ?? -1;
        tanks = m.data.map((s, i) => {
            const tank = previous.find(t => t.id === i);
            if (tank) {
                syncTank(tank, s);
                return tank;
            }
            const created = new Tank(i);
            created.applySync(s);
            return created;
        });
        if (tanks.some(tank => !tank.missingPlayer && !occupied.has(tank.id))) beep();
        const username = (el('username') as HTMLInputElement).value;
        if (!usernameInitialized && own >= 0) {
            usernameInitialized = true;
            if (username && tanks.find(t => t.id === own)?.username !== username) restoreUsername();
        }
    } else if (m.type === GalaxySync.GENERIC_TANK_SYNC && Array.isArray(m.data))
        m.data.forEach((s, i) => {
            const tank = tanks[i];
            if (tank) syncTank(tank, s);
        });
    else if (m.type === GalaxySync.CORRECT_POSITION && typeof m.data === 'string') {
        if (m.seed !== undefined && m.seed !== world?.desc.seed ||
            m.round !== undefined && m.round !== state.round || m.jump !== undefined && m.jump !== localJump) return;
        if (localJump && m.jump === undefined && !m.force) return;
        if (m.jump !== undefined && !m.force) {
            if (landingSentAt) pingMs = Math.max(pingMs, performance.now() - landingSentAt);
            localJump = 0;
            lastPosition = 0;
        } else {
            localJump = 0;
            const self = tanks.find(t => t.id === own);
            if (self) syncTank(self, m.data);
        }
    } else if (m.type === GalaxySync.STATE_SYNC && typeof m.data === 'object' && !Array.isArray(m.data)) {
        state = m.data!;
        if (state.serverTime > 0) clockOffset = state.serverTime - Date.now();
    } else if (m.type === GalaxySync.SYNC_ALL_BULLETS) bullets = (m.bullets ?? []).map(restoreBullet);
    else if (m.type === GalaxySync.ADD_BULLET && m.bullet) {
        if (!bullets.some(b => b.id === m.bullet!.id)) bullets.push(restoreBullet(m.bullet));
    } else if (m.type === GalaxySync.REMOVE_BULLETS) bullets = bullets.filter(b => !m.ids?.includes(b.id));
    else if (m.type === GalaxySync.ADD_POWERUP_ITEM) {
        if (m.items) items = m.items;
        if (m.item && !items.some(i => i.id === m.item!.id)) items.push(m.item);
    } else if (m.type === GalaxySync.DELETE_POWERUP_ITEM) items = items.filter(i => i.id !== m.id);
    else if (m.type === GalaxySync.FLIGHT_START) {
        if (m.id === own) localJump = 0;
        tanks.find(t => t.id === m.id)?.beginFlight(m.star!, m.t0!);
    } else if (m.type === GalaxySync.KNOCKBACK && m.velocity &&
        m.seed === world?.desc.seed && m.round === state.round) {
        const tank = tanks.find(t => t.id === m.id);
        if (tank && (tank.state === TankState.GROUNDED || tank.state === TankState.AIRBORNE))
            tangentProject(tank.vel, m.velocity, tank.dir);
    } else if (m.type === GalaxySync.TANK_KILLED && world) {
        const killed = tanks.find(t => t.id === m.id);
        if (killed) killed.state = TankState.DEAD;
        if (m.id === own) {
            localJump = 0;
            deadSince = Date.now();
        }
        if (!m.fall && m.dir) {
            view.effects.death(world.position(m.planet!, m.dir, m.h! + 0.7), m.dir,
                makePalette(m.color!)[0], m.startTime ?? Date.now() + clockOffset);
            view.camera.shake(0.35, world.position(m.planet!, m.dir, m.h!));
            sound('explode1.mp3', world.position(m.planet!, m.dir, m.h!), view.camera.camera.position);
        } else if (m.dir) view.effects.sparks(world.position(m.planet!, m.dir, -.1), m.dir,
            makePalette(m.color!)[0], m.startTime ?? Date.now() + clockOffset, 12, .8);
    } else if (m.type === GalaxySync.ADD_EXPLOSIONS && world && m.dir) {
        const now = Date.now() + clockOffset, pos = world.position(m.planet!, m.dir, m.h!);
        const tint = makePalette(m.color ?? 0)[0];
        if ((m.radius ?? 0) > 0) {
            view.effects.death(pos, m.dir, tint, now, { radius: m.radius, durationMs: 650, chunks: 24 });
            sound('explode2.mp3', pos, view.camera.camera.position);
            view.camera.shake(.18, pos);
        } else view.effects.sparks(pos, m.dir, tint, now, 10, .8);
        if (m.shield !== undefined) {
            view.rigs.get(m.shield)?.hitShield(now);
            if (!document.hidden) soundscape.shieldHit(m.shield, pos, view.camera.camera.position, now);
        }
    } else if (m.type === GalaxySync.LASER_BEAM && world && m.points)
        view.beam(m.points.map(d => {
            const p = world!.position(m.planet!, d, m.h!);
            return new THREE.Vector3(p.x, p.y, p.z);
        }), Date.now() + clockOffset);
    else if (m.type === GalaxySync.ANNOUNCE_WINNER) lobby.winner(m.scores ?? []);
    else if (m.type === GalaxySync.SPECTATOR_COUNT) spectatorCount = m.count ?? 0;
    else if (m.type === GalaxySync.TANK_FIRED) {
        const tank = tanks.find(t => t.id === m.id);
        const artillery = m.powerup === Powerup.ROCKET || m.powerup === Powerup.METEOR_RAIN;
        const name = m.powerup === Powerup.SHOTGUN ? 'tank_shotgun.mp3' : m.powerup === Powerup.FAST
            ? 'railgun.mp3' : m.powerup === Powerup.LASER ? 'laser.ogg' : artillery
                ? 'radio.ogg' : m.powerup === Powerup.TELEPORT ? 'teleport.mp3' : m.powerup === Powerup.LANDMINE
                    ? 'beep.mp3' : m.powerup === Powerup.SEISMIC_SHOCKWAVE ? 'explode3.mp3' : 'tank_fire_normal.mp3';
        sound(name, tank && world?.position(tank.planet, tank.dir, tank.h), view.camera.camera.position);
        if (tank && world) {
            const pos = world.position(tank.planet, tank.dir, tank.h + 1.1);
            pos.x += tank.aim.x * 1.9;
            pos.y += tank.aim.y * 1.9;
            pos.z += tank.aim.z * 1.9;
            view.effects.sparks(pos, tank.aim, makePalette(tank.color)[0], Date.now() + clockOffset, 10, .7);
        }
    } else if (m.type === GalaxySync.TELEPORT_SWAP && world)
        for (const id of [m.a, m.b]) {
            if (id === own) {
                localJump = 0;
                teleportSync = true;
            }
            const tank = tanks.find(t => t.id === id);
            if (tank) tank.dashTime = 0;
            if (tank) view.effects.sparks(world.position(tank.planet, tank.dir, tank.h + 1), tank.dir,
                new THREE.Color(0x88eeff), Date.now() + clockOffset, 36, 2);
        }
    else if (m.type === GalaxySync.GIVE_POWERUP) {
        const tank = tanks.find(t => t.id === m.id);
        if (tank && world && (m.powerup === Powerup.SHIELD || m.powerup === Powerup.CHRONO_DAMPENER))
            sound('shield.mp3', world.position(tank.planet, tank.dir, tank.h), view.camera.camera.position);
        if (tank && world) view.effects.sparks(world.position(tank.planet, tank.dir, tank.h + 1), tank.dir,
            makePalette(tank.color)[0], Date.now() + clockOffset, 24, 1.2);
    }
    if (tanks.find(t => t.id === own)?.username === automaticUsername) automaticUsername = undefined;
    lobby.update(tanks, own, state.inLobby, state.round, state.totalRounds,
        connection.readyState === WebSocket.OPEN);
};
function sweepWipe(from: number, to: number, duration: number): void {
    Array.from(el('round-wipe').children).forEach((stripe, i) => {
        stripe.getAnimations().forEach(a => a.cancel());
        stripe.animate([{ transform: `scaleX(${from})` }, { transform: `scaleX(${to})` }],
            { duration, delay: i * 40, easing: 'ease-in-out', fill: 'both' });
    });
}
function coverWipe(): void {
    wipeCovered = true;
    sweepWipe(0, 1, 280);
}
function revealWipe(): void {
    if (!wipeCovered) return;
    wipeCovered = false;
    sweepWipe(1, 0, 360);
}
function spectating(): boolean {
    return own < 0 || !!tanks.find(t => t.id === own)?.isDead;
}
function cycle(delta: number): void {
    const alive = tanks.filter(t => !t.isDead && !t.missingPlayer), index = alive.findIndex(t => t.id === target);
    target = alive[(index + delta + alive.length) % alive.length]?.id ?? -1;
}
function blocked(): boolean {
    return document.activeElement instanceof HTMLInputElement ||
        Array.from(document.querySelectorAll<HTMLElement>('.modal-darken')).some(m => m.style.display !== 'none');
}
window.addEventListener('keydown', e => {
    const key = e.key.toLowerCase();
    if (blocked() || e.ctrlKey) return;
    if (['shift', ' ', 'tab', 'arrowleft', 'arrowright'].includes(key)) e.preventDefault();
    if (e.repeat) return;
    keys.add(key);
    if (spectating()) {
        if (key === 'a' || key === 'arrowleft') cycle(-1);
        if (key === 'd' || key === 'arrowright') cycle(1);
        if (key === 'tab') view.camera.overview = !view.camera.overview;
    } else if (!state.inLobby && !state.roundEnd && Date.now() + clockOffset >= state.roundStart) {
        const self = tanks.find(t => t.id === own);
        if (key === 'shift' && self && self.dash(length(self.vel) > .05 ? self.vel : self.move))
            send({ type: 'MOVE', action: Action.DASH, direction: tuple(self.dashDirection) });
        if (key === ' ' && self?.state === TankState.GROUNDED && world) {
            localJump = ++jumpSequence;
            jumpElapsed = 0;
            landingSentAt = 0;
            send({ type: 'MOVE', action: Action.LEAP, jump: localJump,
                p: self.planet, d: tuple(self.dir), h: self.h });
            self.leap();
        }
    }
});
window.addEventListener('keyup', e => {
    const key = e.key.toLowerCase();
    keys.delete(key);
    movement.release(key);
});
function release(): void {
    keys.clear();
    movement.reset();
    firing = false;
    emptyFire = false;
    dragging = false;
    const self = tanks.find(t => t.id === own);
    if (self) self.turn = 0;
    send({ type: 'MOVE', action: Action.STOP_FIRE });
    send({ type: 'MOVE', action: Action.MOVE_INTENT, direction: [0, 0, 0], turn: 0 });
}
window.addEventListener('blur', release);
canvas.addEventListener('pointerdown', e => {
    if (e.button === 2) {
        e.preventDefault();
        const self = tanks.find(t => t.id === own);
        if (!blocked() && !state.inLobby && !state.roundEnd &&
            Date.now() + clockOffset >= state.roundStart && self?.state === TankState.AIRBORNE) {
            send({ type: 'MOVE', action: Action.POUND });
            self.pound();
        }
        return;
    }
    if (e.button !== 0) return;
    dragging = view.camera.overview && spectating();
    firing = !dragging && !spectating();
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
});
window.addEventListener('pointerup', e => {
    if (e.button !== 0) return;
    firing = false;
    emptyFire = false;
    dragging = false;
    send({ type: 'MOVE', action: Action.STOP_FIRE });
});
canvas.addEventListener('pointermove', e => {
    const rect = canvas.getBoundingClientRect();
    mouse.set((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1);
    if (dragging) {
        view.camera.yaw -= (e.clientX - lastX) * 0.006;
        view.camera.pitch = THREE.MathUtils.clamp(view.camera.pitch + (e.clientY - lastY) * 0.006, -1.4, 1.4);
        lastX = e.clientX;
        lastY = e.clientY;
    }
});
canvas.addEventListener('wheel', e => {
    e.preventDefault();
    view.camera.zoom(e.deltaY);
}, { passive: false });
function draw(time: number): void {
    const frameSeconds = (time - previousFrame) / 1000 || 0.016;
    fps += (1 / frameSeconds - fps) * .05;
    const dt = Math.min(0.05, frameSeconds);
    previousFrame = time;
    const now = Date.now() + clockOffset, self = tanks.find(t => t.id === own);
    if (world) {
        if (self && !self.isDead) {
            deadSince = 0;
            target = own;
            view.camera.overview = false;
            if (!state.inLobby && now >= state.roundStart && !state.roundEnd) {
                movementUp.set(self.dir.x, self.dir.y, self.dir.z);
                screenRight.setFromMatrixColumn(view.camera.camera.matrixWorld, 0)
                    .projectOnPlane(movementUp).normalize();
                screenForward.crossVectors(movementUp, screenRight).normalize();
                movement.reset();
                for (const key of movementKeys)
                    if (keys.has(key)) movement.capture(key, screenRight, screenForward, self.dir);
                movement.direction(self.dir, self.move);
                self.turn = Number(keys.has('q')) - Number(keys.has('e'));
                if (self.state === TankState.GROUNDED || self.state === TankState.AIRBORNE)
                    view.camera.rotate(self.turn * TANK_TURN_RATE * dt);
                world.position(self.planet, self.dir, self.h, aimPosition);
                plane.setFromNormalAndCoplanarPoint(movementUp, aimPosition);
                ray.setFromCamera(mouse, view.camera.camera);
                if (ray.ray.intersectPlane(plane, hit)) {
                    hit.sub(aimPosition);
                    hit.addScaledVector(movementUp, -hit.dot(movementUp));
                    if (hit.lengthSq() > 0.01) copy(self.aim, hit.normalize());
                }
                if (time - lastIntent >= 80) {
                    const available = self.bulletPowerup === Powerup.NONE ? self.normalAmmo : self.ammo;
                    if (firing && available <= 0 && self.iFrames <= 0 &&
                        (self.state === TankState.GROUNDED || self.state === TankState.AIRBORNE)) {
                        if (!emptyFire) soundscape.empty(self.id, own, now);
                        emptyFire = true;
                    } else emptyFire = false;
                    send({ type: 'MOVE', action: Action.MOVE_INTENT, direction: tuple(self.move), turn: self.turn });
                    send({ type: 'MOVE', action: firing ? Action.FIRE : Action.UPDATE_AIM, aim: tuple(self.aim) });
                    lastIntent = time;
                }
                if (localJump && self.state === TankState.AIRBORNE) jumpElapsed += dt;
                const wasAirborne = self.state === TankState.AIRBORNE;
                self.update(world, dt, now, false, timeScaleAt(tanks, world, self.planet, self.dir, self.id));
                if (!localJump && self.state === TankState.AIRBORNE && self.vy <= 0) {
                    localJump = ++jumpSequence;
                    jumpElapsed = 0;
                    landingSentAt = 0;
                    send({ type: 'MOVE', action: Action.UPDATE_STATE, jump: localJump, fallStart: true,
                        p: self.planet, d: tuple(self.dir), h: self.h, vy: self.vy,
                        velocity: tuple(self.vel), pounding: self.pounding });
                }
                const landed = localJump > 0 && wasAirborne && self.state !== TankState.AIRBORNE;
                if (time - lastPosition >= 30 || landed) {
                    if (localJump && self.state !== TankState.AIRBORNE && !landingSentAt) landingSentAt = time;
                    send({ type: 'MOVE', action: Action.UPDATE_STATE, p: self.planet,
                        d: tuple(self.dir).map(v => Math.round(v * 10000) / 10000), h: self.h,
                        velocity: tuple(self.vel), vy: self.vy, state: self.state, pounding: self.pounding,
                        ...(localJump ? { jump: localJump, airTime: jumpElapsed } : {}) });
                    lastPosition = time;
                }
            }
        } else {
            if (!deadSince) deadSince = Date.now();
            if (own < 0 || Date.now() - deadSince > 1500) {
                if (!tanks.some(t => t.id === target && !t.isDead)) cycle(1);
                if (target < 0) view.camera.overview = true;
            }
        }
        for (const b of bullets) {
            b.update(dt * bulletTimeScale(b, tanks, world), world.desc.planets[b.planet].radius);
            if ((b.type === BulletType.MAGNET || b.type === BulletType.BOMB) &&
                now - (mineBeeps.get(b.id) ?? 0) >
                    (b.type === BulletType.BOMB ? 450 : b.age < MAGNET_ARM_TIME ? 700 : 350)) {
                const pos = world.position(b.planet, b.dir, b.altitude);
                sound('beep.mp3', pos, view.camera.camera.position);
                mineBeeps.set(b.id, now);
                if (b.type !== BulletType.MAGNET || b.age >= MAGNET_ARM_TIME)
                    view.effects.sparks(pos, b.dir, beepColor, now, 3, .5);
            }
        }
        for (const id of mineBeeps.keys()) if (!bullets.some(b => b.id === id)) mineBeeps.delete(id);
        if (state.inLobby) wipeRound = 0;
        else if (state.roundEnd && wipeRound !== state.round) {
            wipeRound = state.round;
            coverWipe();
        }
        view.preview.root.visible = !state.inLobby;
        view.render(world, tanks, bullets, items, own, target, now, dt);
        soundscape.update(world, tanks, own, target, view.camera.camera.position, now, dt,
            !document.hidden && connection.readyState === WebSocket.OPEN &&
            !state.inLobby && now >= state.roundStart && !state.roundEnd);
        if (wipeCovered && (state.round !== wipeRound || state.inLobby || now > state.roundEnd + 4000)) revealWipe();
        const spec = spectating();
        setText(spectatorCountLabel, spectatorCount ? `${spectatorCount} spectating` : '');
        setText(spectatingLabel, spec ? `${view.camera.overview ? 'Overview'
            : `Watching ${tanks.find(t => t.id === target)?.username ?? 'galaxy'}`} · A/D: target · Tab: overview` : '');
        setText(countdownLabel, !state.inLobby && now < state.roundStart ? 'GET READY' : '');
        const ammo = self?.bulletPowerup === Powerup.NONE ? self.normalAmmo : self?.ammo;
        const ammoKey = `${self?.bulletPowerup}/${ammo}/${self?.color}/${spec}/${state.inLobby}`;
        if (ammoKey !== lastAmmo) {
            lastAmmo = ammoKey;
            const counter = el('ammo');
            counter.replaceChildren();
            counter.style.display = self && !spec && !state.inLobby ? 'flex' : 'none';
            if (self) {
                counter.style.setProperty('--ammo-color', `rgb(${TANK_COLORS[self.color].join(',')})`);
                counter.ariaLabel = `${ammo} shots available`;
                const icon = POWERUPS[self.bulletPowerup].icon;
                if (icon) {
                    const image = document.createElement('img');
                    image.src = `/tanks/img/items/${icon}.png`;
                    image.alt = icon;
                    counter.appendChild(image);
                } else {
                    const normal = document.createElement('span');
                    normal.className = 'ammo-type-normal';
                    normal.ariaLabel = 'Normal ammunition';
                    counter.appendChild(normal);
                }
                const max = POWERUPS[self.bulletPowerup].ammo;
                for (let i = 0; i < max; i++) {
                    const slot = document.createElement('div');
                    slot.className = `ammo-slot${i >= (ammo ?? 0) ? ' fired' : ''}`;
                    counter.appendChild(slot);
                }
            }
        }
        const showDash = !!self && !spec && !state.inLobby;
        dashBar.style.display = showDash ? 'block' : 'none';
        if (self && showDash) {
            const charge = 1 - self.dashCd / DASH_COOLDOWN;
            dashFill.style.transform = `scaleX(${THREE.MathUtils.clamp(charge, 0, 1)})`;
            dashBar.classList.toggle('ready', self.dashCd <= 0);
        }
        debugLabel.hidden = !showDebug.checked;
        if (!debugLabel.hidden) debugLabel.textContent = `FPS: ${Math.round(fps)}\nDraws: ${view.renderer.info.render.calls}\n` +
            `Triangles: ${view.renderer.info.render.triangles}\nTextures: ${view.renderer.info.memory.textures}\n` +
            `Spectators: ${spectatorCount}\nPlanet: ${self?.planet} State: ${self?.state}`;
        if (time - lastLabels > 50) {
            lastLabels = time;
            labelTick++;
            const width = canvas.clientWidth, height = canvas.clientHeight;
            for (const [id, label] of labels) if (!tanks.some(t => t.id === id)) {
                label.remove();
                labels.delete(id);
                occluded.delete(id);
            }
            const focus = tanks.find(t => t.id === target);
            for (const t of tanks) {
                let label = labels.get(t.id);
                if (!label) {
                    label = document.createElement('span');
                    labels.set(t.id, label);
                    nameplates.appendChild(label);
                }
                const rig = view.rigs.get(t.id);
                label.hidden = !rig || t.isDead || t.missingPlayer || (t.stealth > 0 && t.id !== own) || state.inLobby;
                if (label.hidden || !rig) continue;
                labelPoint.fromArray(DEFAULT_TANK_STYLE.anchors.nameplate).applyMatrix4(rig.root.matrixWorld);
                if (labelTick % 3 === t.id % 3 || !occluded.has(t.id)) occluded.set(t.id, view.isOccluded(labelPoint));
                label.classList.toggle('other-planet', !!focus && t.planet !== focus.planet);
                label.style.opacity = occluded.get(t.id) ? '.25' : '1';
                labelPoint.project(view.camera.camera);
                const behind = labelPoint.z > 1;
                if (behind) {
                    labelPoint.x *= -1;
                    labelPoint.y *= -1;
                }
                const offscreen = behind || Math.abs(labelPoint.x) > .92 || Math.abs(labelPoint.y) > .9;
                label.classList.toggle('offscreen', offscreen);
                label.style.setProperty('--marker-angle', `${Math.atan2(-labelPoint.y, labelPoint.x)}rad`);
                setText(label, t.username);
                label.style.left = `${THREE.MathUtils.clamp((labelPoint.x + 1) / 2, .07, .93) * width}px`;
                label.style.top = `${THREE.MathUtils.clamp((1 - labelPoint.y) / 2, .07, .95) * height}px`;
                label.hidden = (offscreen && t.id === own) || labelPoint.z < -1;
            }
        }
    }
    requestAnimationFrame(draw);
}
setInterval(() => send({ type: 'PING', ping: Date.now() }), 2000);
requestAnimationFrame(draw);
window.addEventListener('pagehide', () => {
    release();
    view.dispose();
    connection.close();
});
