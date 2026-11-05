import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advance, angDist } from '../../client/galaxy_tanks/js/sim/math/sphere.js';
import { dot, fromTuple, length, vec } from '../../client/galaxy_tanks/js/sim/math/vec3.js';
import { Rng } from '../../client/galaxy_tanks/js/sim/math/rng.js';
import { generateMap } from '../../client/galaxy_tanks/js/sim/mapgen/index.js';
import { minClearance, connectedLand } from '../../client/galaxy_tanks/js/sim/mapgen/validators.js';
import { Tank } from '../../client/galaxy_tanks/js/sim/tank.js';
import { GameState } from '../../client/galaxy_tanks/js/sim/gamestate.js';
import { World } from '../../client/galaxy_tanks/js/sim/world/planet.js';
import { BulletType, CoreType, GalaxySync, ObstacleStrategyType, Powerup, SurfaceType, TankState } from '../../client/galaxy_tanks/js/types.js';
import { FALL_DEATH_TIME, ROUND_SETTLE_TIME, STAR_HOLD_MS } from '../../client/galaxy_tanks/js/vars.js';
import { givePowerup } from '../../client/galaxy_tanks/js/sim/powerups.js';

const emptyMap = () => {
    const map = generateMap(42, { strategy: ObstacleStrategyType.SCATTER });
    map.planets.forEach(p => {
        p.obstacles = []; p.holes = [];
    }); return map;
};
test('Great-circle transport stays unit and tangent for 100000 steps', () => {
    const dir = vec(0, 1, 0), vel = vec(9, 0, 0);
    for (let i = 0; i < 100000; i++) advance(dir, vel, 0.03, 23);
    assert.ok(Math.abs(length(dir) - 1) < 1e-9);
    assert.ok(Math.abs(dot(dir, vel)) < 1e-8);
    assert.ok(Math.abs(length(vel) - 9) < 1e-8);
    const a = new Rng(3), b = new Rng(3);
    for (let i = 0; i < 100; i++) assert.equal(a.float(), b.float());
});
test('500 seeds produce connected clear varied three-planet maps', () => {
    const surfaces = new Set(), strategies = new Set();
    for (let seed = 0; seed < 500; seed++) {
        const map = generateMap(seed), sides: Array<number> = [];
        assert.equal(map.planets.length, 3); assert.equal(map.rings.length, 3);
        for (const p of map.planets) {
            surfaces.add(p.surface); strategies.add(p.strategy);
            assert.ok(minClearance(p), `Clearance ${seed}/${p.id}`);
            const points = p.spawnPoints.map(fromTuple);
            for (const ring of map.rings)
                for (const star of [ring.a, ring.b])
                    if (star.planet === p.id) points.push(fromTuple(star.dir));
                    else if (star.destPlanet === p.id) points.push(fromTuple(star.landDir));
            assert.ok(connectedLand(p, points), `Connected ${seed}/${p.id}`);
            for (const q of map.planets.slice(p.id + 1)) {
                const d = Math.hypot(p.center[0] - q.center[0], p.center[2] - q.center[2]);
                assert.ok(d - p.radius - q.radius >= 55, `Gap ${seed}`); sides.push(d);
            }
        }
        assert.ok(Math.max(...sides) / Math.min(...sides) <= 1.35);
    }
    assert.equal(surfaces.size, 7); assert.equal(strategies.size, 3);
});
test('Leap apex, pound, ice braking, and lossless diff sync', () => {
    const world = new World(emptyMap()), tank = new Tank(0);
    tank.leap(); let apex = 0;
    for (let i = 0; i < 120; i++) {
        tank.update(world, 1 / 120, i * 1000 / 120, false); apex = Math.max(apex, tank.h);
    }
    assert.ok(Math.abs(apex - 3.5) < 0.03); assert.ok(tank.h < 0.02);
    tank.leap(); tank.update(world, 0.1, 0, false); tank.pound();
    for (let i = 0; i < 10; i++) tank.update(world, 0.01, i * 10, false);
    assert.equal(tank.state, TankState.GROUNDED);
    const target = new Tank(1); target.applySync(tank.sync());
    tank.score = 7; target.applySync(tank.sync()); assert.equal(target.score, 7);
    assert.equal(target.planet, tank.planet);
    world.desc.planets[0].surface = SurfaceType.ICE; world.desc.planets[0].tuning.friction = 0.06;
    tank.vel.x = 9; tank.update(world, 0.1, 0, false);
    assert.ok(Math.abs(length(tank.vel) - 9 * Math.exp(-14 * 0.06 * 0.1)) < 0.01);
});
test('Fixed bullet altitude, iframes, powerup conflicts, harmless death', () => {
    const game = new GameState(emptyMap()), a = new Tank(0), b = new Tank(1);
    game.tanks = [a, b]; game.inLobby = false; game.now = 2000;
    a.iFrames = 1; game.fire(a); assert.equal(game.bullets.length, 0);
    a.iFrames = 0; a.h = 3; game.fire(a);
    assert.equal(game.bullets[0].altitude, 4.1);
    game.bullets[0].update(0.1, game.world.desc.planets[0].radius);
    assert.equal(game.bullets[0].altitude, 4.1); assert.equal(game.bullets[0].type, BulletType.NORMAL);
    givePowerup(a, Powerup.SHIELD); givePowerup(a, Powerup.STEALTH);
    assert.equal(a.shield, 0); assert.equal(a.stealth, 10);
    givePowerup(a, Powerup.BOMB); assert.equal(a.ammo, 1);
    b.iFrames = 0; game.killTank(a, 1); assert.equal(b.isDead, false); assert.equal(b.score, 1);
    assert.ok(!('damage' in game.events.at(-1)!));
    game.killTank(a, 1); assert.equal(b.score, 1);
});
test('Flight is shared, ends at landing pad, and protects landing', () => {
    const world = new World(emptyMap()), tank = new Tank(0), star = world.stars[0];
    tank.beginFlight(0, 1000); const path = world.paths.get(star)!;
    tank.update(world, 0.03, 1000 + STAR_HOLD_MS - 1);
    assert.equal(tank.state, TankState.FLYING);
    tank.update(world, 0.03, 1000 + path.duration * 1000 + STAR_HOLD_MS - 1);
    assert.equal(tank.state, TankState.FLYING);
    tank.update(world, 0.03, 1000 + path.duration * 1000 + STAR_HOLD_MS + 1);
    assert.equal(tank.planet, star.destPlanet); assert.ok(angDist(tank.dir, fromTuple(star.landDir)) < 1e-7);
    assert.equal(tank.state, TankState.GROUNDED); assert.equal(tank.iFrames, 0.9);
});
test('Last survivor is scored only after a short settle period', () => {
    const g = new GameState(emptyMap()); g.inLobby = false; g.now = 1000;
    g.tanks = [new Tank(0), new Tank(1)]; g.tanks.forEach(t => {
        t.iFrames = 0;
    });
    g.killTank(g.tanks[1], 0);
    g.update(0.01, 1000); assert.equal(g.roundEnd, 0);
    const survivor = g.tanks[0], oldDir = { ...survivor.dir };
    survivor.move.x = 1;
    g.update(0.1, 1000 + ROUND_SETTLE_TIME / 2);
    assert.ok(angDist(oldDir, survivor.dir) > 0);
    assert.equal(g.roundEnd, 0);
    g.update(0.01, 1000 + ROUND_SETTLE_TIME - 1); assert.equal(g.roundEnd, 0);
    g.update(0.01, 1000 + ROUND_SETTLE_TIME + 1); assert.ok(g.roundEnd > 0);
});
test('Tanks falling into a lava core explode as soon as they reach it', () => {
    const map = emptyMap(), planet = map.planets[0];
    planet.holes = [{ dir: [0, 1, 0], angRadius: 0.3, harmonics: [] }]; planet.crustThickness = 3;
    planet.core = { kind: CoreType.LAVA, radiusFrac: 0.4, seed: 1 };
    const g = new GameState(map); g.inLobby = false; g.now = 1000;
    g.tanks = [new Tank(0), new Tank(1)]; g.tanks[1].planet = 1;
    let elapsed = 0;
    while (!g.tanks[0].isDead && elapsed < FALL_DEATH_TIME) {
        g.update(0.01, 1000 + elapsed * 1000); elapsed += 0.01;
    }
    const killed = g.events.find(e => e.type === GalaxySync.TANK_KILLED)!;
    assert.equal(killed.fall, false); assert.equal(killed.h, g.world.lavaHeight(0));
    assert.ok(elapsed < FALL_DEATH_TIME / 2);
});
