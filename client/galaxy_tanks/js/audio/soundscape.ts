import { CoreType, TankState } from '../types.js';
import { STAR_HEIGHT, STAR_HOLD_MS, TANK_SPEED } from '../vars.js';
import { Tank } from '../sim/tank.js';
import { World } from '../sim/world/planet.js';
import { V3, copy, distance, fromTuple, length, vec } from '../sim/math/vec3.js';
import { LoopSound, sound, stopLoops, updateLoops } from './sound.js';

interface PreviousTank {
    state: TankState;
    flightStart: number;
    launched: boolean;
}
export class Soundscape {
    private previous = new Map<number, PreviousTank>();
    private shields = new Map<number, number>();
    private emptyAt = -Infinity;
    private up = vec();
    private forward = vec();
    reset(): void {
        stopLoops();
        this.previous.clear();
        this.shields.clear();
        this.emptyAt = -Infinity;
    }
    shieldHit(id: number, position: V3, listener: V3, now: number): void {
        if (now - (this.shields.get(id) ?? -Infinity) < 150) return;
        this.shields.set(id, now);
        sound('shield_hit.mp3', position, listener, .7);
    }
    empty(now: number): void {
        if (now - this.emptyAt < 500) return;
        this.emptyAt = now;
        sound('ammunition_zero.mp3', undefined, undefined, .7);
    }
    update(world: World, tanks: Array<Tank>, own: number, target: number,
        listener: V3, now: number, dt: number, active: boolean): void {
        if (!active) {
            updateLoops([], listener, dt);
            this.previous.clear();
            return;
        }
        const requests: Array<LoopSound> = [];
        const focus = tanks.find(tank => tank.id === target && !tank.isDead);
        const focusPosition = focus ? world.position(focus.planet, focus.dir, focus.h) : listener;
        for (const tank of tanks) {
            const previous = this.previous.get(tank.id);
            const pos = world.position(tank.planet, tank.dir, tank.h);
            const path = tank.state === TankState.FLYING ? world.paths.get(world.stars[tank.flightStar]) : undefined;
            if (path) path.sample((now - tank.flightStart - STAR_HOLD_MS) / (path.duration * 1000),
                pos, this.up, this.forward);
            if (tank === focus) copy(focusPosition, pos);
            const audible = !tank.isDead && !tank.missingPlayer && (tank.stealth <= 0 || tank.id === own);
            const launched = tank.state === TankState.FLYING && now >= tank.flightStart + STAR_HOLD_MS;
            if (audible) {
                if (previous?.state === TankState.GROUNDED && tank.state === TankState.AIRBORNE && tank.vy > 0)
                    sound('jump.mp3', pos, listener, .7);
                if (previous && launched &&
                    (!previous.launched || previous.flightStart !== tank.flightStart))
                    sound('launch_star_launch.mp3', pos, listener, 3);
                if (tank.state === TankState.GROUNDED) {
                    const speed = Math.min(1, length(tank.vel) / TANK_SPEED);
                    requests.push({ key: `tank:${tank.id}`, name: 'tank_hum.ogg', position: pos,
                        gain: (.08 + speed * .22) * .8, rate: .7 + speed * .8 });
                }
            }
            this.previous.set(tank.id, { state: tank.state, flightStart: tank.flightStart, launched });
        }
        for (const id of this.previous.keys()) if (!tanks.some(tank => tank.id === id)) this.previous.delete(id);
        world.stars.forEach((star, index) => {
            const pos = world.position(star.planet, fromTuple(star.dir), STAR_HEIGHT);
            const near = Math.max(0, Math.min(1, (14 - distance(focusPosition, pos)) / 10));
            const held = tanks.some(tank => tank.state === TankState.FLYING && tank.flightStar === index &&
                now < tank.flightStart + STAR_HOLD_MS && (tank.stealth <= 0 || tank.id === own));
            if (near > 0 || held) requests.push({ key: `star:${index}`, name: 'launch_star_idle.mp3', position: pos,
                gain: (held ? .55 : near * .3) * 3, rate: held ? 3 : .7 + near * 1.3 });
        });
        const planet = focus && world.desc.planets[focus.planet];
        if (focus && planet?.core && planet.holes?.length) {
            let closest = planet.holes[0], closestDistance = Infinity;
            for (const hole of planet.holes) {
                const d = distance(focusPosition, world.position(focus.planet, fromTuple(hole.dir), 0));
                if (d < closestDistance) {
                    closest = hole;
                    closestDistance = d;
                }
            }
            const edgeDistance = focus.state === TankState.FLYING
                ? Math.max(0, closestDistance - planet.radius * closest.angRadius)
                : Math.hypot(Math.max(0, world.fields[focus.planet].signedDistance(focus.dir)), focus.h);
            const near = Math.max(0, 1 - edgeDistance / 28);
            const name = planet.core.kind === CoreType.LAVA ? 'lava_sfx.mp3'
                : planet.core.kind === CoreType.BLACK_HOLE ? 'black_hole_woosh.mp3' : 'dark_matter_hum.mp3';
            requests.push({ key: `core:${focus.planet}`, name,
                position: world.position(focus.planet, fromTuple(closest.dir), -(planet.crustThickness ?? 3)),
                gain: near * .55, rate: 1 });
        }
        updateLoops(requests, listener, dt);
    }
}
