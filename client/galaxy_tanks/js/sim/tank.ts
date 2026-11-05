import performStateDiff from '../../../tanks/js/util/diff.js';
import { Powerup, TankState } from '../types.js';
import { ACCEL, AIR_CONTROL, EDGE_FORGIVENESS, FALL_DEATH_TIME, FALL_SPEED, GRAVITY, IFRAMES_LAND,
    IFRAMES_SPAWN, JUMP_V, POUND_V, STAR_COOLDOWN, STAR_HOLD_MS, STAR_TRIGGER_R, STEP_UP, TANK_SPEED, TANK_TURN_RATE } from '../vars.js';
import { advance, angDist } from './math/sphere.js';
import { V3, add, copy, cross, dot, fromTuple, length, lerp, normalize, reproject, scale, set,
    rotate, tangentProject, tuple, vec } from './math/vec3.js';
import { World } from './world/planet.js';

export class Tank {
    dir = vec(0, 1, 0);
    vel = vec();
    fwd = vec(0, 0, -1);
    aim = vec(0, 0, -1);
    move = vec();
    turn = 0;
    h = 0;
    vy = 0;
    planet = 0;
    state = TankState.GROUNDED;
    iFrames = IFRAMES_SPAWN;
    starCd = STAR_COOLDOWN;
    shield = 0;
    stealth = 0;
    bulletPowerup = Powerup.NONE;
    ammo = 0;
    fireCd = 0;
    firing = false;
    pounding = false;
    fallTime = 0;
    fallLimit = FALL_DEATH_TIME;
    flightStar = -1;
    flightStart = 0;
    ready = false;
    score = 0;
    color = 0;
    missingPlayer = false;
    username = 'User';
    lastInput = 0;
    private diff: Array<string | number> = [];
    private syncFields: Array<string> = [];
    private tmp = vec();
    private axis = vec();
    private oldDir = vec();
    constructor(public id: number) {}
    get isDead(): boolean {
        return this.state === TankState.DEAD;
    }
    get vulnerable(): boolean {
        return !this.isDead && this.state !== TankState.FLYING && this.state !== TankState.FALLING &&
            this.iFrames <= 0 && this.shield <= 0;
    }
    reset(planet: number, dir: V3): void {
        this.planet = planet;
        copy(this.dir, dir);
        set(this.vel, 0, 0, 0);
        set(this.move, 0, 0, 0);
        reproject(this.fwd, vec(0, 0, -1), dir);
        copy(this.aim, this.fwd);
        this.h = 0;
        this.vy = 0;
        this.turn = 0;
        this.state = TankState.GROUNDED;
        this.iFrames = IFRAMES_SPAWN;
        this.starCd = STAR_COOLDOWN;
        this.flightStar = -1;
        this.fireCd = 0;
        this.firing = false;
        this.pounding = false;
        this.fallTime = 0;
        this.shield = 0;
        this.stealth = 0;
        this.bulletPowerup = Powerup.NONE;
        this.ammo = 0;
    }
    leap(): void {
        if (this.state !== TankState.GROUNDED) return;
        this.vy = JUMP_V;
        this.state = TankState.AIRBORNE;
    }
    pound(): void {
        if (this.state !== TankState.AIRBORNE) return;
        this.vy = -POUND_V;
        this.pounding = true;
        scale(this.vel, this.vel, 0.3);
    }
    beginFlight(star: number, time: number): void {
        this.flightStar = star;
        this.flightStart = time;
        this.state = TankState.FLYING;
        this.h = 0;
        this.vy = 0;
        this.firing = false;
        this.pounding = false;
        set(this.vel, 0, 0, 0);
    }
    update(world: World, dt: number, now: number, allowLaunch = true): void {
        this.iFrames = Math.max(0, this.iFrames - dt);
        this.starCd = Math.max(0, this.starCd - dt);
        this.fireCd = Math.max(0, this.fireCd - dt);
        this.shield = Math.max(0, this.shield - dt);
        this.stealth = Math.max(0, this.stealth - dt);
        if (this.isDead) return;
        if (this.state === TankState.FLYING) {
            const star = world.stars[this.flightStar], path = world.paths.get(star);
            if (path && now >= this.flightStart + STAR_HOLD_MS + path.duration * 1000) {
                this.planet = star.destPlanet;
                copy(this.dir, fromTuple(star.landDir));
                reproject(this.fwd, this.fwd, this.dir);
                reproject(this.aim, this.aim, this.dir);
                this.state = TankState.GROUNDED;
                this.iFrames = IFRAMES_LAND;
                this.starCd = STAR_COOLDOWN;
                this.flightStar = -1;
            }
            return;
        }
        if (this.state === TankState.FALLING) {
            this.fallTime += dt;
            return;
        }
        const p = world.desc.planets[this.planet], grounded = this.state === TankState.GROUNDED;
        tangentProject(this.tmp, this.move, this.dir);
        const moving = length(this.tmp) > 0.05;
        if (moving) normalize(this.tmp, this.tmp);
        scale(this.tmp, this.tmp, moving ? TANK_SPEED : 0);
        if (grounded && p.tuning.friction < 1) {
            scale(this.vel, this.vel, Math.exp(-ACCEL * p.tuning.friction * dt));
            if (moving) add(this.vel, this.vel, scale(this.tmp, this.tmp, ACCEL * dt));
            const speed = length(this.vel);
            if (speed > TANK_SPEED) scale(this.vel, this.vel, TANK_SPEED / speed);
        } else {
            const rate = grounded ? ACCEL : ACCEL * AIR_CONTROL;
            lerp(this.vel, this.vel, this.tmp, 1 - Math.exp(-rate * dt));
        }
        copy(this.oldDir, this.dir);
        advance(this.dir, this.vel, dt, p.radius + Math.max(this.h, 0));
        // Parallel transport the independent hull and turret headings.
        cross(this.axis, this.oldDir, this.dir);
        const sine = length(this.axis), cosine = dot(this.oldDir, this.dir);
        if (sine > 1e-9) {
            scale(this.axis, this.axis, 1 / sine);
            for (const heading of [this.fwd, this.aim]) {
                cross(this.tmp, this.axis, heading);
                const along = dot(this.axis, heading) * (1 - cosine);
                set(heading, heading.x * cosine + this.tmp.x * sine + this.axis.x * along,
                    heading.y * cosine + this.tmp.y * sine + this.axis.y * along,
                    heading.z * cosine + this.tmp.z * sine + this.axis.z * along);
            }
        }
        const oldHeight = this.h;
        const support = world.colliders.supportHeight(this.planet, this.dir, 1.1, oldHeight + STEP_UP);
        if (grounded && this.h > support + STEP_UP) this.state = TankState.AIRBORNE;
        if (this.state === TankState.AIRBORNE) {
            this.h += this.vy * dt - 0.5 * GRAVITY * dt * dt;
            this.vy -= GRAVITY * dt;
            if (this.vy <= 0 && this.h <= support) {
                this.h = support;
                this.vy = 0;
                this.state = TankState.GROUNDED;
                this.pounding = false;
            }
        } else this.h = support;
        world.colliders.resolve(this);
        tangentProject(this.vel, this.vel, this.dir);
        reproject(this.fwd, this.fwd, this.dir);
        reproject(this.aim, this.aim, this.dir);
        if (this.turn)
            rotate(this.fwd, this.fwd, this.dir, this.turn * TANK_TURN_RATE * dt);
        else if (length(this.vel) > .05)
            reproject(this.fwd, this.vel, this.dir);
        if (this.h < 0.3 && world.fields[this.planet].signedDistance(this.dir) < -EDGE_FORGIVENESS) {
            const lava = world.lavaHeight(this.planet);
            this.state = TankState.FALLING;
            this.fallTime = 0;
            this.firing = false;
            this.fallLimit = lava === undefined ? FALL_DEATH_TIME : -lava / FALL_SPEED;
            return;
        }
        if (allowLaunch && this.state === TankState.GROUNDED && this.starCd <= 0 && this.h < 0.8)
            for (let i = 0; i < world.stars.length; i++) {
                const s = world.stars[i];
                if (s.planet === this.planet && angDist(this.dir, fromTuple(s.dir)) * p.radius < STAR_TRIGGER_R) {
                    this.beginFlight(i, now);
                    break;
                }
            }
    }
    get fell(): boolean {
        return this.state === TankState.FALLING && this.fallTime >= this.fallLimit;
    }
    sync(diff = true): string {
        const round = (v: number) => Math.round(v * 10000) / 10000;
        const data = [this.id, this.planet, ...tuple(this.dir).map(round), round(this.h), ...tuple(this.vel).map(round),
            ...tuple(this.fwd).map(round), ...tuple(this.aim).map(round), round(this.vy), this.state,
            round(this.iFrames), round(this.shield), round(this.stealth), this.bulletPowerup, this.ammo,
            Number(this.ready), this.score, this.color, Number(this.missingPlayer), this.username,
            this.flightStar, this.flightStart, round(this.fallTime), Number(this.pounding), round(this.fireCd)];
        const [result, next] = performStateDiff(data, diff, this.diff);
        if (diff) this.diff = next;
        return result;
    }
    applySync(data: string): void {
        data.split(',').forEach((v, i) => {
            if (v !== '') this.syncFields[i] = v;
        });
        const a = this.syncFields, n = a.map(Number);
        this.id = n[0];
        this.planet = n[1];
        set(this.dir, n[2], n[3], n[4]);
        this.h = n[5];
        set(this.vel, n[6], n[7], n[8]);
        set(this.fwd, n[9], n[10], n[11]);
        set(this.aim, n[12], n[13], n[14]);
        this.vy = n[15];
        this.state = n[16];
        this.iFrames = n[17];
        this.shield = n[18];
        this.stealth = n[19];
        this.bulletPowerup = n[20];
        this.ammo = n[21];
        this.ready = !!n[22];
        this.score = n[23];
        this.color = n[24];
        this.missingPlayer = !!n[25];
        this.username = a[26];
        this.flightStar = n[27];
        this.flightStart = n[28];
        this.fallTime = n[29];
        this.pounding = !!n[30];
        this.fireCd = n[31];
    }
}
