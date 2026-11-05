import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MovementInput } from '../../client/galaxy_tanks/js/movement-input.js';
import { Bullet } from '../../client/galaxy_tanks/js/sim/bullet.js';
import { GameState } from '../../client/galaxy_tanks/js/sim/gamestate.js';
import { Tank } from '../../client/galaxy_tanks/js/sim/tank.js';
import { magnetTarget } from '../../client/galaxy_tanks/js/sim/targeting.js';
import { generateMap } from '../../client/galaxy_tanks/js/sim/mapgen/index.js';
import { FlightPath } from '../../client/galaxy_tanks/js/sim/math/flight-path.js';
import { distance, dot, fromTuple, length, normalize, sub, vec } from '../../client/galaxy_tanks/js/sim/math/vec3.js';
import { BulletType, CoreType, GalaxySync, ObstacleStrategyType, Powerup } from '../../client/galaxy_tanks/js/types.js';
import { BULLET_LIFE, BULLET_SPEED, DELAY_AFTER_WIN_ROUND, LASER_LENGTH, MAGNET_ARM_TIME,
    MAGNET_TRACK_WIDTH, ROUND_SETTLE_TIME, STAR_HEIGHT, STAR_PATH_CLEARANCE, TANK_HEIGHT
} from '../../client/galaxy_tanks/js/vars.js';

test('Captured movement directions stay fixed until release or reset', () => {
    const input = new MovementInput(), up = vec(0, 1, 0), out = vec();
    input.capture('w', vec(1, 0, 0), vec(0, 0, -1), up);
    input.direction(up, out);
    assert.ok(distance(out, vec(0, 0, -1)) < 1e-8);
    input.capture('w', vec(-1, 0, 0), vec(0, 0, 1), up);
    input.direction(up, out);
    assert.ok(distance(out, vec(0, 0, -1)) < 1e-8);
    input.capture('d', vec(-1, 0, 0), vec(0, 0, 1), up);
    input.direction(up, out);
    assert.ok(distance(out, normalize(vec(), vec(-1, 0, -1))) < 1e-8);
    input.release('w');
    input.direction(up, out);
    assert.ok(distance(out, vec(-1, 0, 0)) < 1e-8);
    input.capture('w', vec(-1, 0, 0), vec(0, 0, 1), up);
    input.direction(up, out);
    assert.ok(distance(out, normalize(vec(), vec(-1, 0, 1))) < 1e-8);
    input.release('d');
    input.direction(up, out);
    assert.ok(distance(out, vec(0, 0, 1)) < 1e-8);
    input.reset(); input.direction(up, out);
    assert.equal(length(out), 0);
});

test('A new key press can reset and recapture every held movement key together', () => {
    const input = new MovementInput(), up = vec(0, 1, 0), out = vec();
    const held = ['w', 'd'];
    for (const key of held) input.capture(key, vec(1, 0, 0), vec(0, 0, -1), up);
    input.reset();
    for (const key of held) input.capture(key, vec(-1, 0, 0), vec(0, 0, 1), up);
    input.direction(up, out);
    assert.ok(distance(out, normalize(vec(), vec(-1, 0, 1))) < 1e-8);
});

test('Lava surface sits slightly above the bottom of hole walls', () => {
    const map = generateMap(16), planet = map.planets[0];
    planet.core = { kind: CoreType.LAVA, radiusFrac: .9, seed: 1 };
    const game = new GameState(map);
    for (const thickness of [1, 3, 5]) {
        planet.crustThickness = thickness;
        assert.ok(Math.abs(game.world.lavaHeight(0)! - (-thickness + .1)) < 1e-8);
    }
});

test('Locked movement transports around the planet instead of stopping at the horizon', () => {
    const input = new MovementInput(), out = vec();
    input.capture('d', vec(1, 0, 0), vec(0, 0, -1), vec(0, 1, 0));
    for (let i = 1; i <= 360; i++) {
        const a = i * Math.PI / 180, up = vec(Math.sin(a), Math.cos(a), 0);
        input.direction(up, out);
        assert.ok(Math.abs(dot(out, up)) < 1e-8);
        assert.ok(distance(out, vec(Math.cos(a), -Math.sin(a), 0)) < 1e-8);
    }
});

test('Weapon lifetimes and tracking range use the requested multipliers', () => {
    const bullet = (type: BulletType) => new Bullet(1, 0, 0, vec(0, 1, 0), vec(1, 0, 0), 1.1, type, 0);
    for (const radius of [20, 100]) {
        assert.equal(bullet(BulletType.NORMAL).lifetime(radius),
            2 * Math.max(BULLET_LIFE, 2 * Math.PI * (radius + 1.1) / BULLET_SPEED + .1));
        assert.equal(bullet(BulletType.FAST).lifetime(radius),
            2 * Math.max(3.2, 2 * Math.PI * (radius + 1.1) / 86 + .1));
    }
    assert.equal(bullet(BulletType.SMALL).lifetime(20), 1);
    assert.equal(bullet(BulletType.BOMB).lifetime(20), 1.4 * 3);
    assert.equal(LASER_LENGTH, 420);
    assert.equal(MAGNET_TRACK_WIDTH, .22 * .6 * .6 * .5);
});

test('Single Bézier flights have radial endpoints, smooth tangents, and planet clearance', () => {
    for (let seed = 0; seed < 100; seed++) {
        const map = generateMap(seed);
        for (const ring of map.rings) for (const star of [ring.a, ring.b]) {
            const path = new FlightPath(map, ring, star), p = vec(), up = vec(), fwd = vec();
            const start = vec(), end = vec();
            path.sample(0, start, up, fwd); path.sample(1, end, up, fwd);
            const source = map.planets[star.planet];
            assert.ok(Math.abs(distance(start, fromTuple(source.center)) - source.radius - STAR_HEIGHT) < 1e-8);
            assert.ok(Math.abs(distance(path['controls'][1], fromTuple(source.center)) - source.radius -
                (STAR_HEIGHT + 10 * TANK_HEIGHT) * 1.5) < 1e-8);
            assert.ok(dot(normalize(vec(), sub(vec(), path['controls'][1], path['controls'][0])),
                fromTuple(star.dir)) > .999999);
            path.sample(.001, p, up, fwd);
            assert.ok(dot(normalize(vec(), sub(vec(), p, start)), fromTuple(star.dir)) > .999);
            path.sample(.999, p, up, fwd);
            assert.ok(dot(normalize(vec(), sub(vec(), end, p)), fromTuple(star.landDir)) < -.999);
            let previousFwd = vec();
            for (let i = 0; i <= 1000; i++) {
                path.sample(i / 1000, p, up, fwd);
                assert.ok(Math.abs(length(fwd) - 1) < 1e-8);
                assert.ok(Math.abs(dot(up, fwd)) < 1e-8);
                if (i) assert.ok(dot(previousFwd, fwd) > .99);
                previousFwd = { ...fwd };
                for (const planet of map.planets) {
                    const other = planet.id !== star.planet && planet.id !== star.destPlanet;
                    assert.ok(distance(p, fromTuple(planet.center)) >=
                        planet.radius + (other ? STAR_PATH_CLEARANCE : 0) - 1e-8,
                    `Clearance ${seed}/${star.planet}/${i}`);
                }
                if (i > 0 && i < 1000 && i % 10 === 0) {
                    const before = vec(), after = vec();
                    path.sample(i / 1000 - 1e-5, before, up, fwd);
                    path.sample(i / 1000 + 1e-5, after, up, fwd);
                    assert.ok(dot(normalize(before, sub(before, p, before)),
                        normalize(after, sub(after, after, p))) > .999, `Tangent ${seed}/${i}`);
                }
            }
        }
    }
});

test('Unarmed magnets have no target and can be shot by any player; armed magnets resist bullets', () => {
    const map = generateMap(16, { strategy: ObstacleStrategyType.SCATTER });
    map.planets.forEach(p => {
        p.obstacles = []; p.holes = [];
    });
    for (const owner of [0, 1]) for (const type of [BulletType.NORMAL, BulletType.FAST, BulletType.LASER])
        for (const age of [1, MAGNET_ARM_TIME]) {
            const game = new GameState(map); game.inLobby = false;
            game.tanks = [new Tank(0), new Tank(1)];
            game.tanks[0].planet = 1; game.tanks[1].planet = 2;
            const mine = new Bullet(1, 0, 0, vec(0, 1, 0), vec(), 1.1, BulletType.MAGNET, 0);
            mine.age = age;
            const target = new Tank(2);
            assert.equal(magnetTarget(mine, [target]), age < MAGNET_ARM_TIME ? undefined : target);
            const shot = new Bullet(2, owner, 0, vec(0, 1, 0), vec(), 1.1, type, 0);
            game.bullets = [mine, shot]; game.update(.01, 1000);
            assert.equal(game.bullets.includes(mine), age >= MAGNET_ARM_TIME,
                `Mine owner ${owner}, projectile ${type}, age ${age}`);
        }
});

test('Laser hitscan hits other tanks and its owner after circling the planet', () => {
    const map = generateMap(16, { strategy: ObstacleStrategyType.SCATTER });
    map.planets.forEach(p => {
        p.obstacles = []; p.holes = [];
    });
    const game = new GameState(map); game.inLobby = false;
    const shooter = new Tank(0), target = new Tank(1);
    shooter.iFrames = target.iFrames = 0;
    shooter.aim = vec(1, 0, 0); shooter.bulletPowerup = Powerup.LASER; shooter.ammo = 3;
    target.dir = vec(1, 0, 0);
    game.tanks = [shooter, target]; game.fire(shooter);
    game.update(.01, 1000);
    assert.ok(target.isDead);
    assert.ok(shooter.isDead);
    const kills = game.events.filter(e => e.type === GalaxySync.TANK_KILLED);
    assert.deepEqual(kills.map(e => e.id), [target.id, shooter.id]);
    const beam = game.events.find(e => e.type === GalaxySync.LASER_BEAM)!;
    assert.ok(Array.isArray(beam.points));
    assert.ok(beam.points.length > 2 * Math.PI * map.planets[0].radius - 6);
});

test('Round transitions wait only for the wipe after the survivor grace period', () => {
    const game = new GameState(generateMap(3)); game.inLobby = false;
    game.tanks = [new Tank(0)];
    game.update(.01, 1000);
    assert.equal(game.roundEnd, 0);
    game.update(.01, 1000 + ROUND_SETTLE_TIME);
    assert.equal(DELAY_AFTER_WIN_ROUND, 600);
    assert.equal(game.roundEnd, 1000 + ROUND_SETTLE_TIME + DELAY_AFTER_WIN_ROUND);
    game.update(.01, game.roundEnd);
    assert.equal(game.round, 1);
    assert.equal(game.roundEnd, 0);
});
