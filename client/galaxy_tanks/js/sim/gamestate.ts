import { BulletType, GalaxySync, Powerup, TankState } from '../types.js';
import { DELAY_AFTER_WIN_ROUND, DELAY_POWERUP_SPAWN, ITEM_FLOAT_HEIGHT, MAGNET_ARM_TIME, MAGNET_CHASE_ACCEL,
    MAGNET_CHASE_SPEED, LASER_LENGTH, MAX_NORMAL_AMMO, MAX_POWERUP_ITEMS, MUZZLE_H, MUZZLE_OFFSET,
    PRE_ROUND_DELAY, ROUND_SETTLE_TIME,
    TANK_FIRE_DELAY, TANK_HEIGHT, TANK_RADIUS } from '../vars.js';
import { Bullet, BULLETS, PowerupItem } from './bullet.js';
import { generateMap } from './mapgen/index.js';
import { MapDesc } from './mapgen/map-desc.js';
import { Rng } from './math/rng.js';
import { advance, angDist, slerpDir } from './math/sphere.js';
import { V3, copy, dot, fromTuple, length, normalize, reflect, reproject, rotate,
    scale, set, sub, tangentProject, vec } from './math/vec3.js';
import { givePowerup, POWERUPS } from './powerups.js';
import { Tank } from './tank.js';
import { World } from './world/planet.js';
import { magnetTarget, nearestTarget, rocketTargets } from './targeting.js';

export interface SimEvent {
    type: GalaxySync; [key: string]: unknown;
}
export interface StateSync {
    inLobby: boolean; round: number; totalRounds: number; roundStart: number;
    roundEnd: number; serverTime: number;
}
export class GameState {
    tanks: Array<Tank> = [];
    bullets: Array<Bullet> = [];
    powerupItems: Array<PowerupItem> = [];
    events: Array<SimEvent> = [];
    world: World;
    inLobby = true;
    round = 0;
    totalRounds = 20;
    roundStart = 0;
    roundEnd = 0;
    settleEnd = 0;
    now = 0;
    private lastItems = 0;
    private nextId = 1;
    private rng: Rng;
    private tmp = vec();
    private sample = vec();
    private normal = vec();
    private posA = vec();
    private posB = vec();
    constructor(map: MapDesc = generateMap(1)) {
        this.world = new World(map);
        this.rng = new Rng(map.seed);
    }
    setMap(map: MapDesc): void {
        this.world = new World(map);
        this.rng = new Rng(map.seed);
        this.bullets = [];
        this.powerupItems = [];
    }
    sync(): StateSync {
        return { inLobby: this.inLobby, round: this.round, totalRounds: this.totalRounds,
            roundStart: this.roundStart, roundEnd: this.roundEnd, serverTime: this.now };
    }
    startGame(now: number): void {
        this.tanks.forEach(t => {
            t.score = 0;
        });
        this.round = 0;
        this.inLobby = false;
        this.newRound(now);
    }
    newRound(now: number): void {
        const roll = this.rng.float(), planetCount = roll < .3 ? 1 : roll < .7 ? 2 : 3;
        this.setMap(generateMap(this.rng.int(0, 0x7fffffff), { planetCount }));
        this.events.push({ type: GalaxySync.MAP_DESC, map: this.world.desc });
        this.now = now;
        this.round++;
        this.roundEnd = this.settleEnd = 0;
        this.roundStart = now + PRE_ROUND_DELAY;
        this.lastItems = now;
        this.bullets = [];
        this.powerupItems = [];
        const offset = this.rng.int(0, this.world.desc.planets.length - 1);
        for (let i = 0; i < this.tanks.length; i++) {
            const t = this.tanks[i], planet = (i + offset) % this.world.desc.planets.length;
            const candidates = this.world.desc.planets[planet].spawnPoints;
            const others = this.tanks.slice(0, i).filter(other => other.planet === planet);
            const best = candidates.reduce((a, b) => {
                const score = (p: Array<number>) => others.reduce((min, other) =>
                    Math.min(min, angDist(fromTuple(p as [number, number, number]), other.dir)), Math.PI);
                return score(b) > score(a) ? b : a;
            });
            t.reset(planet, fromTuple(best));
            if (t.missingPlayer) t.state = TankState.DEAD;
        }
        this.events.push({ type: GalaxySync.CREATE_ALL_TANKS });
    }
    update(dt: number, now: number): void {
        this.now = now;
        if (this.inLobby || now < this.roundStart) return;
        if (this.roundEnd) {
            if (now >= this.roundEnd)
                if (this.round >= this.totalRounds) {
                    this.inLobby = true;
                    this.events.push({ type: GalaxySync.ANNOUNCE_WINNER,
                        scores: this.tanks.map(t => [t.username, t.score]) });
                } else this.newRound(now);

            return;
        }
        for (const t of this.tanks) {
            const previous = t.state;
            t.update(this.world, dt, now);
            if (t.state === TankState.FLYING && previous !== TankState.FLYING)
                this.events.push({ type: GalaxySync.FLIGHT_START, id: t.id, star: t.flightStar, t0: now });
            if (t.fell) this.killTank(t, -1, true);
            if (t.firing) this.fire(t);
        }
        this.resolveTanks();
        this.updateBullets(dt);
        this.pickupItems();
        if (now - this.lastItems >= DELAY_POWERUP_SPAWN) {
            this.lastItems = now;
            this.spawnItems();
        }
        const alive = this.tanks.filter(t => !t.isDead);
        if (alive.length > 1) return;
        if (!this.settleEnd) this.settleEnd = now + ROUND_SETTLE_TIME;
        if (now < this.settleEnd) return;
        if (alive[0]) alive[0].score++;
        this.roundEnd = now + DELAY_AFTER_WIN_ROUND;
    }
    private resolveTanks(): void {
        for (let i = 0; i < this.tanks.length; i++)
            for (let j = i + 1; j < this.tanks.length; j++) {
                const a = this.tanks[i], b = this.tanks[j];
                if (a.isDead || b.isDead || a.planet !== b.planet || Math.abs(a.h - b.h) >= TANK_HEIGHT ||
                    a.state === TankState.FLYING || b.state === TankState.FLYING ||
                    a.state === TankState.FALLING || b.state === TankState.FALLING) continue;
                const r = this.world.desc.planets[a.planet].radius, dist = angDist(a.dir, b.dir) * r;
                if (dist >= 2 * TANK_RADIUS) continue;
                tangentProject(this.tmp, b.dir, a.dir);
                if (length(this.tmp) < 1e-7) reproject(this.tmp, a.fwd, a.dir);
                normalize(this.tmp, this.tmp);
                const push = (2 * TANK_RADIUS - dist + 0.001) / (2 * r);
                normalize(a.dir, set(a.dir, a.dir.x - this.tmp.x * push,
                    a.dir.y - this.tmp.y * push, a.dir.z - this.tmp.z * push));
                normalize(b.dir, set(b.dir, b.dir.x + this.tmp.x * push,
                    b.dir.y + this.tmp.y * push, b.dir.z + this.tmp.z * push));
                const av = Math.max(0, a.vel.x * this.tmp.x + a.vel.y * this.tmp.y + a.vel.z * this.tmp.z);
                const bv = Math.min(0, b.vel.x * this.tmp.x + b.vel.y * this.tmp.y + b.vel.z * this.tmp.z);
                set(a.vel, a.vel.x - this.tmp.x * av, a.vel.y - this.tmp.y * av, a.vel.z - this.tmp.z * av);
                set(b.vel, b.vel.x - this.tmp.x * bv, b.vel.y - this.tmp.y * bv, b.vel.z - this.tmp.z * bv);
                tangentProject(a.vel, a.vel, a.dir);
                tangentProject(b.vel, b.vel, b.dir);
                this.world.colliders.resolve(a);
                this.world.colliders.resolve(b);
            }
    }
    killTank(tank: Tank, killer = -1, fall = false): void {
        if (tank.isDead || (!fall && !tank.vulnerable)) return;
        tank.state = TankState.DEAD;
        tank.firing = false;
        set(tank.move, 0, 0, 0);
        if (killer !== tank.id && this.tanks[killer]) this.tanks[killer].score++;
        const lava = fall ? this.world.lavaHeight(tank.planet) : undefined;
        this.events.push({ type: GalaxySync.TANK_KILLED, id: tank.id, killer, fall: fall && lava === undefined,
            planet: tank.planet, dir: { ...tank.dir }, h: lava ?? tank.h, color: tank.color, startTime: this.now });
    }
    fire(tank: Tank): void {
        if (tank.isDead || tank.iFrames > 0 || tank.fireCd > 0 || tank.state === TankState.FLYING ||
            tank.state === TankState.FALLING || this.now < this.roundStart || this.roundEnd || this.inLobby) return;
        const powerup = tank.bulletPowerup, config = POWERUPS[powerup];
        if (powerup === Powerup.NONE && this.bullets.filter(b => b.owner === tank.id).length >= MAX_NORMAL_AMMO) return;
        const type = config.bullet;
        if (this.bullets.filter(b => b.owner === tank.id && b.type === type).length >= BULLETS[type].maxAmmo) return;
        tank.fireCd = TANK_FIRE_DELAY / 1000;
        this.events.push({ type: GalaxySync.TANK_FIRED, id: tank.id, powerup });
        if (type === BulletType.TELEPORT) {
            const target = nearestTarget(tank, this.tanks, this.world);
            if (target) {
                const planet = tank.planet, dir = { ...tank.dir }, h = tank.h;
                tank.planet = target.planet;
                copy(tank.dir, target.dir);
                tank.h = target.h;
                target.planet = planet;
                copy(target.dir, dir);
                target.h = h;
                for (const t of [tank, target]) {
                    set(t.vel, 0, 0, 0);
                    set(t.move, 0, 0, 0);
                    t.vy = 0;
                    t.clientAirborne = false;
                    t.dashTime = 0;
                    t.starCd = 1.5;
                    reproject(t.fwd, t.fwd, t.dir);
                    reproject(t.aim, t.aim, t.dir);
                }
                this.events.push({ type: GalaxySync.TELEPORT_SWAP, a: tank.id, b: target.id });
            }
        } else if (type === BulletType.ROCKET)
            for (const target of rocketTargets(tank, this.tanks, this.world))
                this.addBullet(tank, type, target.dir, target.planet, 20, tank.aim);
        else {
            const count = powerup === Powerup.SHOTGUN ? 7 : 1;
            for (let i = 0; i < count; i++) {
                rotate(this.tmp, tank.aim, tank.dir, count > 1 ? (i - 3) * 14 / 3 * Math.PI / 180 : 0);
                this.addBullet(tank, type, tank.dir, tank.planet, tank.h + MUZZLE_H, this.tmp, MUZZLE_OFFSET);
            }
        }
        if (powerup !== Powerup.NONE && --tank.ammo <= 0) tank.bulletPowerup = Powerup.NONE;
    }
    private addBullet(tank: Tank, type: BulletType, dir: V3, planet: number, altitude: number,
        heading: V3, offset = 0): Bullet {
        const bullet = new Bullet(this.nextId++, tank.id, planet, dir, heading, altitude, type, tank.color);
        if (offset) {
            scale(this.sample, heading, offset);
            advance(bullet.dir, this.sample, 1, this.world.desc.planets[planet].radius + altitude);
        }
        this.bullets.push(bullet);
        this.events.push({ type: GalaxySync.ADD_BULLET, bullet });
        return bullet;
    }
    private hitFraction(bullet: Bullet, tank: Tank): number | null {
        if (tank.isDead || tank.state === TankState.FLYING || tank.state === TankState.FALLING ||
            tank.planet !== bullet.planet || bullet.altitude < tank.h - 0.1 ||
            bullet.altitude > tank.h + TANK_HEIGHT ||
            (tank.id === bullet.owner && bullet.type !== BulletType.LASER && bullet.age < 0.3)) return null;
        const r = this.world.desc.planets[tank.planet].radius, a = bullet.previous, b = bullet.dir;
        const theta = angDist(a, b), steps = Math.max(1, Math.ceil(theta * r / 0.2));
        for (let i = 0; i <= steps; i++) {
            slerpDir(this.sample, a, b, i / steps);
            if (angDist(this.sample, tank.dir) * r < TANK_RADIUS + BULLETS[bullet.type].radius) {
                if (!tank.vulnerable && bullet.type !== BulletType.FAST) {
                    tangentProject(this.tmp, sub(this.tmp, b, a), this.sample);
                    if (dot(this.tmp, tank.dir) <= 0) continue;
                }
                return i / steps;
            }
        }
        return null;
    }
    private explode(bullet: Bullet, radius: number): void {
        const r = this.world.desc.planets[bullet.planet].radius;
        for (const tank of this.tanks)
            if (tank.planet === bullet.planet &&
                Math.hypot(angDist(tank.dir, bullet.dir) * r,
                    Math.max(0, bullet.altitude - tank.h - TANK_HEIGHT, tank.h - bullet.altitude)) < radius)
                this.killTank(tank, bullet.owner);
        this.events.push({ type: GalaxySync.ADD_EXPLOSIONS, planet: bullet.planet,
            dir: { ...bullet.dir }, h: bullet.altitude, color: bullet.color, radius });
    }
    private splitBomb(bullet: Bullet): void {
        const owner = this.tanks[bullet.owner];
        if (!owner) return;
        const heading = reproject(vec(), bullet.vel, bullet.dir);
        for (let i = 0; i < 25; i++) {
            rotate(this.tmp, heading, bullet.dir, i * Math.PI * 2 / 25);
            this.addBullet(owner, BulletType.SMALL, bullet.dir, bullet.planet, bullet.altitude, this.tmp);
        }
    }
    private updateBullets(dt: number): void {
        const removed = new Set<number>(), initial = [...this.bullets];
        let bounced = false;
        for (const b of initial) {
            if (removed.has(b.id)) continue;
            const p = this.world.desc.planets[b.planet], config = BULLETS[b.type];
            if (b.type === BulletType.MAGNET && b.age >= MAGNET_ARM_TIME) {
                const target = magnetTarget(b, this.tanks);
                if (target) {
                    const speed = Math.min(MAGNET_CHASE_SPEED, length(b.vel) + MAGNET_CHASE_ACCEL * dt);
                    scale(b.vel, reproject(this.tmp, target.dir, b.dir), speed);
                } else set(b.vel, 0, 0, 0);
            }
            if (b.type === BulletType.ROCKET) {
                b.age += dt;
                if (b.age >= config.life) {
                    const impact = new Bullet(b.id, b.owner, b.planet, b.dir, b.vel, 0.3, b.type, b.color);
                    this.explode(impact, config.radius);
                    removed.add(b.id);
                }
                continue;
            }
            const laser = b.type === BulletType.LASER;
            if (laser) {
                const points: Array<V3> = [{ ...b.dir }];
                scale(b.vel, reproject(this.tmp, this.tanks[b.owner].aim, b.dir), 1);
                // Short segments preserve the intended arc even beyond an antipode.
                for (let n = 0; n < LASER_LENGTH; n++) {
                    copy(b.previous, b.dir);
                    advance(b.dir, b.vel, 1, p.radius + b.altitude);
                    let wall = this.world.colliders.raycastAltitude(
                        b.planet, b.previous, b.dir, b.altitude, config.radius, this.normal);
                    let shield: number | undefined;
                    const hits = this.tanks.map(tank => ({ tank, hit: this.hitFraction(b, tank) }))
                        .filter((h): h is { tank: Tank; hit: number } => h.hit !== null)
                        .sort((a, c) => a.hit - c.hit);
                    for (const { tank, hit } of hits) {
                        if (wall !== null && hit >= wall) break;
                        if (!tank.vulnerable) {
                            wall = hit;
                            shield = tank.id;
                            break;
                        }
                        this.killTank(tank, b.owner);
                    }
                    if (wall !== null) advance(b.dir, b.vel, -(1 - wall), p.radius + b.altitude);
                    for (const other of initial) {
                        if (other.planet !== b.planet ||
                            other.type === BulletType.ROCKET || other.type === BulletType.LASER ||
                            (other.type === BulletType.MAGNET && other.age >= MAGNET_ARM_TIME) ||
                            Math.abs(other.altitude - b.altitude) > 0.5) continue;
                        for (let k = 0; k <= 8; k++) {
                            slerpDir(this.posA, b.previous, b.dir, k / 8);
                            if (angDist(this.posA, other.dir) * (p.radius + b.altitude) <
                                config.radius + BULLETS[other.type].radius) {
                                removed.add(other.id);
                                break;
                            }
                        }
                    }
                    points.push({ ...b.dir });
                    if (wall !== null) {
                        this.events.push({ type: GalaxySync.ADD_EXPLOSIONS, planet: b.planet,
                            dir: { ...b.dir }, h: b.altitude, color: b.color, radius: 0, shield });
                        if (shield !== undefined)
                            reproject(this.normal, scale(this.tmp, this.tanks[shield].dir, -1), b.dir);
                        else reproject(this.normal, this.normal, b.dir);
                        reflect(b.vel, b.vel, this.normal);
                    }
                }
                this.events.push({ type: GalaxySync.LASER_BEAM, planet: b.planet, points,
                    h: b.altitude, color: b.color });
                removed.add(b.id);
                continue;
            }
            b.age += dt;
            let remaining = dt;
            for (let step = 0; step < 8 && remaining > 1e-8; step++) {
                copy(b.previous, b.dir);
                advance(b.dir, b.vel, remaining, p.radius + b.altitude);
                let hit = this.world.colliders.raycastAltitude(b.planet, b.previous, b.dir, b.altitude,
                    config.radius, b.type === BulletType.FAST ? undefined : this.normal);
                let victim: Tank | undefined;
                for (const t of this.tanks) {
                    const fraction = this.hitFraction(b, t);
                    if (fraction !== null && (hit === null || fraction < hit)) {
                        hit = fraction;
                        victim = t;
                    }
                }
                if (hit === null) break;
                advance(b.dir, b.vel, -remaining * (1 - hit), p.radius + b.altitude);
                const bounce = b.type !== BulletType.FAST && (!victim || !victim.vulnerable);
                if (victim && !bounce) this.killTank(victim, b.owner);
                this.events.push({ type: GalaxySync.ADD_EXPLOSIONS, planet: b.planet,
                    dir: { ...b.dir }, h: b.altitude, color: b.color, radius: 0,
                    shield: victim && !victim.vulnerable && !victim.isDead ? victim.id : undefined });
                if (!bounce) {
                    removed.add(b.id);
                    break;
                }
                if (victim) reproject(this.normal, scale(this.tmp, victim.dir, -1), b.dir);
                else reproject(this.normal, this.normal, b.dir);
                reflect(b.vel, b.vel, this.normal);
                bounced = true;
                remaining *= 1 - hit;
            }
            if (b.age >= b.lifetime(p.radius)) removed.add(b.id);
        }
        for (let i = 0; i < initial.length; i++)
            for (let j = i + 1; j < initial.length; j++) {
                const a = initial[i], b = initial[j];
                if (removed.has(a.id) || removed.has(b.id) || a.planet !== b.planet ||
                    a.type === BulletType.ROCKET || b.type === BulletType.ROCKET ||
                    (a.type === BulletType.MAGNET && a.age >= MAGNET_ARM_TIME) ||
                    (b.type === BulletType.MAGNET && b.age >= MAGNET_ARM_TIME) ||
                    Math.abs(a.altitude - b.altitude) > 0.5) continue;
                // Test synchronous swept positions, so fast crossing rounds cancel too.
                for (let k = 0; k <= 12; k++) {
                    slerpDir(this.posA, a.previous, a.dir, k / 12);
                    slerpDir(this.posB, b.previous, b.dir, k / 12);
                    if (angDist(this.posA, this.posB) * this.world.desc.planets[a.planet].radius <
                        BULLETS[a.type].radius + BULLETS[b.type].radius) {
                        removed.add(a.id);
                        removed.add(b.id);
                        this.events.push({ type: GalaxySync.ADD_EXPLOSIONS, planet: a.planet,
                            dir: { ...this.posA }, h: a.altitude, color: a.color, radius: 0 });
                        break;
                    }
                }
            }
        for (const b of initial)
            if (removed.has(b.id))
                if (b.type === BulletType.BOMB) {
                    this.explode(b, 3);
                    this.splitBomb(b);
                } else if (b.type === BulletType.MAGNET) this.explode(b, 3.5);
        this.bullets = this.bullets.filter(b => !removed.has(b.id));
        if (removed.size) this.events.push({ type: GalaxySync.REMOVE_BULLETS, ids: [...removed] });
        if (bounced) this.events.push({ type: GalaxySync.SYNC_ALL_BULLETS, bullets: this.bullets });
    }
    spawnItems(): void {
        for (let n = 0; n < 2 && this.powerupItems.length < MAX_POWERUP_ITEMS; n++) {
            const p = this.rng.weighted(this.world.desc.planets, pl => pl.radius ** 2);
            for (let attempt = 0; attempt < 200; attempt++) {
                const d = this.rng.unitVec();
                if (this.world.fields[p.id].signedDistance(d) < 2 ||
                    !this.world.colliders.clearance(p.id, d, 3) ||
                    this.tanks.some(t => !t.isDead && t.planet === p.id && angDist(t.dir, d) * p.radius < 8) ||
                    this.world.stars.some(s => (s.planet === p.id && angDist(d, fromTuple(s.dir)) * p.radius < 5) ||
                        (s.destPlanet === p.id && angDist(d, fromTuple(s.landDir)) * p.radius < 5)) ||
                    this.powerupItems.some(it => it.planet === p.id && angDist(it.dir, d) * p.radius < 3)) continue;
                const item = { id: this.nextId++, planet: p.id, dir: d, powerup: this.rng.int(1, 9) };
                this.powerupItems.push(item);
                this.events.push({ type: GalaxySync.ADD_POWERUP_ITEM, item });
                break;
            }
        }
    }
    private pickupItems(): void {
        this.powerupItems = this.powerupItems.filter(item => {
            const tank = this.tanks.find(t => !t.isDead && t.state !== TankState.FLYING &&
                t.state !== TankState.FALLING && t.planet === item.planet &&
                Math.hypot(angDist(t.dir, item.dir) * this.world.desc.planets[t.planet].radius,
                    Math.max(0, ITEM_FLOAT_HEIGHT - t.h - TANK_HEIGHT, t.h - ITEM_FLOAT_HEIGHT)) < 2.2);
            if (!tank) return true;
            givePowerup(tank, item.powerup);
            this.events.push({ type: GalaxySync.DELETE_POWERUP_ITEM, id: item.id });
            this.events.push({ type: GalaxySync.GIVE_POWERUP, id: tank.id, powerup: item.powerup });
            return false;
        });
    }
}
