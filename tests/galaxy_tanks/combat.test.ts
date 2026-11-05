import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { GameState } from '../../client/galaxy_tanks/js/sim/gamestate.js';
import { generateMap } from '../../client/galaxy_tanks/js/sim/mapgen/index.js';
import { Tank } from '../../client/galaxy_tanks/js/sim/tank.js';
import { Bullet } from '../../client/galaxy_tanks/js/sim/bullet.js';
import { givePowerup } from '../../client/galaxy_tanks/js/sim/powerups.js';
import { vec, copy, normalize } from '../../client/galaxy_tanks/js/sim/math/vec3.js';
import { MAGNET_CHASE_ACCEL, MAGNET_CHASE_SPEED } from '../../client/galaxy_tanks/js/vars.js';
import { BulletType, GalaxySync, ObstacleStrategyType, Powerup } from '../../client/galaxy_tanks/js/types.js';
function match(): GameState {
    const map = generateMap(16, { strategy: ObstacleStrategyType.SCATTER });
    map.planets.forEach(p => {
        p.radius = 30; p.obstacles = []; p.holes = [];
    });
    const game = new GameState(map); game.inLobby = false; game.now = 1000;
    game.tanks = [new Tank(0), new Tank(1), new Tank(2)];
    game.tanks.forEach((t, i) => {
        t.planet = i; t.iFrames = 0;
    });
    return game;
}
test('Shotgun, bomb splits, cross-planet teleport, hidden targets and rocket warning', () => {
    let g = match(), a = g.tanks[0]; givePowerup(a, Powerup.SHOTGUN); g.fire(a);
    assert.equal(g.bullets.length, 7); assert.equal(a.bulletPowerup, Powerup.NONE);
    g = match(); a = g.tanks[0]; givePowerup(a, Powerup.BOMB); g.fire(a);
    for (let i = 0; i < 141; i++) g.update(0.01, 1000 + i * 10);
    assert.equal(g.bullets.filter(b => b.type === BulletType.SMALL).length, 12);
    g = match(); a = g.tanks[0]; g.tanks[1].stealth = 10;
    givePowerup(a, Powerup.TELEPORT); g.fire(a);
    assert.equal(a.planet, 2); assert.equal(g.tanks[2].planet, 0); assert.equal(a.iFrames, 0.6);
    g = match(); a = g.tanks[0]; givePowerup(a, Powerup.ROCKET); g.fire(a);
    assert.equal(g.bullets[0].type, BulletType.ROCKET); assert.equal(g.bullets[0].altitude, 20);
    assert.notEqual(g.bullets[0].planet, a.planet); assert.equal(g.tanks.filter(t => t.isDead).length, 0);
    for (let i = 0; i < 201; i++) g.update(0.01, 1000 + i * 10);
    assert.ok(g.events.some(e => e.type === GalaxySync.ROCKET_STRIKE));
});
test('Every weapon pickup is consumed on fire, as in Tanks', () => {
    for (const powerup of [Powerup.FAST, Powerup.LASER, Powerup.SHOTGUN, Powerup.BOMB,
        Powerup.MAGNET, Powerup.ROCKET, Powerup.TELEPORT]) {
        const g = match(), tank = g.tanks[0];
        givePowerup(tank, powerup); g.fire(tank);
        assert.equal(tank.bulletPowerup, Powerup.NONE, Powerup[powerup]);
    }
});
test('Shield stops a laser; opposing bullets cancel without friendly cancellation', () => {
    const g = match(), a = g.tanks[0], b = g.tanks[1], c = g.tanks[2];
    a.planet = b.planet = c.planet = 0; b.shield = 6;
    copy(a.aim, vec(1, 0, 0)); copy(b.dir, normalize(vec(), vec(0.2, 1, 0)));
    copy(c.dir, normalize(vec(), vec(0.4, 1, 0)));
    givePowerup(a, Powerup.LASER); g.fire(a); g.update(0.01, 1001);
    assert.equal(b.isDead, false); assert.equal(c.isDead, false);
    const h = match();
    h.bullets = [new Bullet(1, 0, 0, vec(0, 1, 0), vec(1, 0, 0), 5, BulletType.NORMAL, 0),
        new Bullet(2, 1, 0, vec(0, 1, 0), vec(-1, 0, 0), 5, BulletType.FAST, 1)];
    h.update(0.01, 1001); assert.equal(h.bullets.length, 0);
    h.bullets = [new Bullet(3, 0, 0, vec(0, 1, 0), vec(1, 0, 0), 5, BulletType.NORMAL, 0),
        new Bullet(4, 0, 0, vec(0, 1, 0), vec(1, 0, 0), 5, BulletType.NORMAL, 0)];
    h.update(0.01, 1011); assert.equal(h.bullets.length, 2);
});
test('Stealth survives firing; mines seek their owner and idle without visible targets', () => {
    const g = match(), tank = g.tanks[0];
    givePowerup(tank, Powerup.STEALTH); g.fire(tank);
    assert.equal(tank.stealth, 10);
    const mine = new Bullet(99, 0, 0, normalize(vec(), vec(0.2, 1, 0)), vec(1, 0, 0),
        1.1, BulletType.MAGNET, 0);
    mine.age = 2; g.bullets = [mine];
    g.update(0.01, 1001); assert.equal(Math.hypot(mine.vel.x, mine.vel.y, mine.vel.z), 0);
    tank.stealth = 0; g.update(0.01, 1011);
    const speed = Math.hypot(mine.vel.x, mine.vel.y, mine.vel.z);
    assert.ok(mine.vel.x < 0); assert.ok(speed > 0 && speed <= MAGNET_CHASE_ACCEL * 0.01 + 1e-8);
    g.update(0.01, 1021); const faster = Math.hypot(mine.vel.x, mine.vel.y, mine.vel.z);
    assert.ok(faster > speed && faster <= MAGNET_CHASE_SPEED);
});
test('Laser destroys opposing bullets but not armed mines', () => {
    const g = match(), a = g.tanks[0]; copy(a.aim, vec(1, 0, 0));
    givePowerup(a, Powerup.LASER); g.fire(a);
    const dir = normalize(vec(), vec(0.2, 1, 0));
    const normal = new Bullet(100, 1, 0, dir, vec(0, 0, 1), 1.1, BulletType.NORMAL, 1);
    const mine = new Bullet(101, 1, 0, dir, vec(0, 0, 1), 1.1, BulletType.MAGNET, 1);
    mine.age = 1; g.bullets.push(normal, mine); g.update(0.01, 1001);
    assert.equal(g.bullets.some(b => b.id === normal.id), false);
    assert.equal(g.bullets.some(b => b.id === mine.id), true);
});
test('Simulation has no DOM, WebGL, rendering or THREE imports', () => {
    const root = 'client/galaxy_tanks/js/sim';
    const files = (dir: string): Array<string> => readdirSync(dir, { withFileTypes: true })
        .flatMap(e => e.isDirectory() ? files(`${dir}/${e.name}`) : [`${dir}/${e.name}`]);
    for (const file of files(root)) {
        const source = readFileSync(file, 'utf8');
        assert.doesNotMatch(source, /\b(?:THREE|document|window|WebGLRenderingContext)\b/, file);
        assert.doesNotMatch(source, /from\s+['"][^'"]*(?:render|three)[^'"]*['"]/, file);
    }
});
