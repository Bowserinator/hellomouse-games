import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMap } from '../../client/galaxy_tanks/js/sim/mapgen/index.js';
import { World } from '../../client/galaxy_tanks/js/sim/world/planet.js';
import { Tank } from '../../client/galaxy_tanks/js/sim/tank.js';
import { GameState } from '../../client/galaxy_tanks/js/sim/gamestate.js';
import { Bullet } from '../../client/galaxy_tanks/js/sim/bullet.js';
import { ObstacleDesc } from '../../client/galaxy_tanks/js/sim/mapgen/map-desc.js';
import { normalize, vec, copy, length } from '../../client/galaxy_tanks/js/sim/math/vec3.js';
import { angDist } from '../../client/galaxy_tanks/js/sim/math/sphere.js';
import { BulletType, ObstacleStrategyType, ShapeKind, TankState } from '../../client/galaxy_tanks/js/types.js';

function scene(obstacles: Array<ObstacleDesc> = []): World {
    const map = generateMap(42, { strategy: ObstacleStrategyType.SCATTER });
    map.planets.forEach(p => {
        p.obstacles = []; p.holes = []; p.tuning.friction = 1;
    });
    map.planets[0].radius = 30; map.planets[0].obstacles = obstacles;
    return new World(map);
}
const wall = (height = 4, kind = ShapeKind.BOX): ObstacleDesc =>
    ({ kind, height, dir: [0, 1, 0], yaw: 0, size: [2, 12, height], variant: 0 });
test('OBB and circle contacts slide, remove inward velocity, and do not tunnel', () => {
    for (const kind of [ShapeKind.BOX, ShapeKind.CYLINDER]) {
        const world = scene([wall(4, kind)]), tank = new Tank(0);
        copy(tank.dir, normalize(vec(), vec(-5 / 30, 1, -3 / 30)));
        const start = { ...tank.dir };
        for (let i = 0; i < 100; i++) {
            copy(tank.move, normalize(vec(), vec(1, 0, 0.6))); tank.update(world, 0.01, i * 10, false);
        }
        assert.ok(angDist(start, tank.dir) * 30 > 1);
        assert.ok(world.colliders.clearance(0, tank.dir, 1.28));
        assert.ok(Number.isFinite(length(tank.vel)));
    }
});
test('Leap lands on a short block, tall block stops movement, ledge and holes fall', () => {
    const world = scene([wall(2)]), tank = new Tank(0);
    copy(tank.dir, normalize(vec(), vec(-4 / 30, 1, 0))); tank.leap();
    for (let i = 0; i < 100; i++) {
        copy(tank.move, vec(i < 60 ? 1 : 0, 0, 0)); tank.update(world, 0.01, i * 10, false);
    }
    assert.equal(tank.state, TankState.GROUNDED); assert.equal(tank.h, 2);
    for (let i = 0; i < 150; i++) {
        copy(tank.move, vec(1, 0, 0)); tank.update(world, 0.01, 1000 + i * 10, false);
    }
    assert.equal(tank.h, 0);
    const tall = scene([wall(4)]), blocked = new Tank(0);
    copy(blocked.dir, normalize(vec(), vec(-4 / 30, 1, 0))); blocked.leap();
    for (let i = 0; i < 100; i++) {
        copy(blocked.move, vec(1, 0, 0)); blocked.update(tall, 0.01, i * 10, false);
    }
    assert.ok(blocked.dir.x * 30 < -2.2); assert.ok(Math.abs(blocked.h) < 1e-10);
    const map = scene().desc;
    map.planets[0].holes = [{ dir: [0, 1, 0], angRadius: 0.3, harmonics: [] }];
    const hole = new World(map), falling = new Tank(0);
    falling.update(hole, 0.01, 0, false); assert.equal(falling.state, TankState.FALLING);
    for (let i = 0; i < 91; i++) falling.update(hole, 0.01, i * 10, false);
    assert.ok(falling.fell);
});
test('Bullets stop at tall obstacles, pass over low ones, and airborne tanks dodge', () => {
    const world = scene([wall(2)]), a = normalize(vec(), vec(-4 / 30, 1, 0));
    const b = normalize(vec(), vec(4 / 30, 1, 0));
    assert.notEqual(world.colliders.raycastAltitude(0, a, b, 1.1), null);
    assert.equal(world.colliders.raycastAltitude(0, a, b, 4.1), null);
    const game = new GameState(scene().desc), shooter = new Tank(0), target = new Tank(1);
    game.inLobby = false; game.now = 1000; game.tanks = [shooter, target];
    shooter.planet = 1; shooter.iFrames = target.iFrames = 0; target.h = 3; target.leap();
    game.bullets.push(new Bullet(1, 0, 0, a, vec(1, 0, 0), 1.1, BulletType.NORMAL, 0));
    for (let i = 0; i < 25; i++) game.update(0.01, 1000 + i * 10);
    assert.equal(target.isDead, false);
});
test('Tank contacts push equally, and shielded tanks still fire', () => {
    const game = new GameState(scene().desc), a = new Tank(0), b = new Tank(1);
    game.tanks = [a, b]; game.inLobby = false; a.iFrames = b.iFrames = 0;
    game.update(0.01, 1000);
    assert.ok(angDist(a.dir, b.dir) * 30 >= 2.59);
    a.shield = 6; game.fire(a); assert.equal(game.bullets.length, 1);
});
