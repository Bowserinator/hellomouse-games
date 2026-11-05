import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Bullet, BULLETS } from '../../client/galaxy_tanks/js/sim/bullet.js';
import { GameState } from '../../client/galaxy_tanks/js/sim/gamestate.js';
import { Tank } from '../../client/galaxy_tanks/js/sim/tank.js';
import { generateMap } from '../../client/galaxy_tanks/js/sim/mapgen/index.js';
import { distance, dot, length, normalize, reproject, vec } from '../../client/galaxy_tanks/js/sim/math/vec3.js';
import { BulletType, GalaxySync, ShapeKind } from '../../client/galaxy_tanks/js/types.js';

function arena(wall = false, yaw = 0, kind = ShapeKind.BOX): GameState {
    const map = generateMap(1);
    for (const planet of map.planets) {
        planet.obstacles = []; planet.holes = [];
    }
    if (wall) map.planets[0].obstacles.push({ kind, dir: [0, 1, 0], yaw,
        size: kind === ShapeKind.CYLINDER ? [1, 1, 1] : [1, 10, 1], height: 3, variant: 0 });
    const game = new GameState(map);
    game.inLobby = false; game.now = 1000;
    game.tanks = [new Tank(0), new Tank(1)];
    game.tanks[0].planet = 1; game.tanks[1].planet = 2;
    game.tanks[0].aim = vec(1, 0, 0);
    return game;
}
function shot(game: GameState, type: BulletType): Bullet {
    const radius = game.world.desc.planets[0].radius;
    const start = normalize(vec(), vec(-4 / radius, 1, 0));
    const bullet = new Bullet(100, 0, 0, start, reproject(vec(), vec(1, 0, 0), start), 1.1, type, 0);
    game.bullets.push(bullet);
    return bullet;
}

test('The hull follows travel, manual turns take priority, and mouse aim stays independent', () => {
    const game = arena(), tank = game.tanks[0], aim = { ...tank.aim };
    tank.turn = 1;
    tank.update(game.world, .5, 1000, false);
    assert.ok(distance(tank.fwd, vec(-Math.SQRT1_2, 0, -Math.SQRT1_2)) < 1e-8);
    assert.ok(distance(tank.aim, aim) < 1e-8);
    tank.turn = -1;
    tank.update(game.world, .5, 1500, false);
    assert.ok(distance(tank.fwd, vec(0, 0, -1)) < 1e-8);
    tank.turn = 0;
    tank.move = vec(1, 0, 0);
    tank.aim = vec(0, 0, -1);
    tank.update(game.world, .1, 1600, false);
    assert.ok(distance(tank.fwd, normalize(vec(), tank.vel)) < 1e-8);
    assert.ok(distance(tank.aim, vec(0, 0, -1)) < 1e-8);
    tank.turn = 1;
    tank.update(game.world, .1, 1700, false);
    assert.ok(dot(tank.fwd, normalize(vec(), tank.vel)) < .995);
    assert.ok(distance(tank.aim, vec(0, 0, -1)) < 1e-8);
    tank.turn = 0;
    tank.update(game.world, .1, 1800, false);
    assert.ok(distance(tank.fwd, normalize(vec(), tank.vel)) < 1e-8);
    tank.move = vec();
    tank.vel = vec();
    const stopped = { ...tank.fwd };
    tank.update(game.world, .1, 1900, false);
    assert.ok(distance(tank.fwd, stopped) < 1e-8);
    tank.turn = 1;
    tank.reset(1, vec(0, 1, 0));
    assert.equal(tank.turn, 0);
});

test('Every moving projectile except rail reflects off walls without losing speed or lifetime', () => {
    for (const type of [BulletType.NORMAL, BulletType.SMALL, BulletType.BOMB, BulletType.MAGNET, BulletType.FAST]) {
        const game = arena(true), bullet = shot(game, type);
        game.update(.4, 1400);
        if (type === BulletType.FAST) {
            assert.ok(!game.bullets.includes(bullet));
            continue;
        }
        assert.ok(game.bullets.includes(bullet), `Survives wall: ${type}`);
        assert.ok(bullet.vel.x < 0, `Reflected: ${type}`);
        assert.ok(Math.abs(length(bullet.vel) - BULLETS[type].speed) < 1e-8);
        assert.ok(Math.abs(dot(bullet.vel, bullet.dir)) < 1e-8);
        assert.equal(bullet.age, .4);
        assert.ok(game.events.some(e => e.type === GalaxySync.SYNC_ALL_BULLETS));
        game.update(.02, 1420);
        assert.ok(bullet.vel.x < 0, `Leaves wall without sticking: ${type}`);
    }
});

test('Rotated walls and round obstacles return usable reflection normals', () => {
    for (const [yaw, kind] of [[Math.PI / 6, ShapeKind.BOX], [0, ShapeKind.CYLINDER]]) {
        const game = arena(true, yaw, kind), bullet = shot(game, BulletType.NORMAL);
        game.update(.2, 1200);
        assert.ok(game.bullets.includes(bullet));
        assert.ok(bullet.vel.x < 0);
        assert.ok(Math.abs(length(bullet.vel) - BULLETS[bullet.type].speed) < 1e-8);
        assert.ok(Math.abs(dot(bullet.vel, bullet.dir)) < 1e-8);
    }
});

test('Shields reflect projectiles except rail, while vulnerable tanks still take hits', () => {
    for (const shield of [0, 5]) for (const type of [BulletType.NORMAL, BulletType.SMALL,
        BulletType.BOMB, BulletType.MAGNET, BulletType.FAST]) {
        const game = arena(), target = new Tank(2);
        target.iFrames = 0; target.shield = shield; game.tanks.push(target);
        const bullet = shot(game, type);
        game.update(.4, 1400);
        if (shield && type !== BulletType.FAST) {
            assert.ok(game.bullets.includes(bullet), `Survives shield: ${type}`);
            assert.ok(bullet.vel.x < 0, `Reflects from shield: ${type}`);
            assert.equal(target.isDead, false);
            game.update(.02, 1420);
            assert.ok(bullet.vel.x < 0, `Leaves shield: ${type}`);
        } else {
            assert.ok(!game.bullets.includes(bullet));
            assert.equal(target.isDead, !shield);
        }
    }
});

test('Lasers reflect off walls and shields and retain their reflected beam points', () => {
    for (const wall of [true, false]) {
        const game = arena(wall);
        if (!wall) {
            const target = new Tank(2); target.iFrames = 0; target.shield = 5; game.tanks.push(target);
        }
        shot(game, BulletType.LASER); game.update(.01, 1010);
        const beam = game.events.find(e => e.type === GalaxySync.LASER_BEAM)!;
        const points = beam.points as Array<{ x: number }>;
        assert.ok(points.some((point, i) => i > 0 && point.x < points[i - 1].x));
        assert.ok(game.events.some(e => e.type === GalaxySync.ADD_EXPLOSIONS));
        assert.equal(game.tanks.some(tank => tank.isDead), false);
    }
});
