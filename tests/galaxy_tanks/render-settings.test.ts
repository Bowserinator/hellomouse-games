import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateMap } from '../../client/galaxy_tanks/js/sim/mapgen/index.js';
import { World } from '../../client/galaxy_tanks/js/sim/world/planet.js';
import { treadSurface } from '../../client/galaxy_tanks/js/render/tank/tread-trails.js';
import { distance, normalize, vec } from '../../client/galaxy_tanks/js/sim/math/vec3.js';
import { ShapeKind } from '../../client/galaxy_tanks/js/types.js';

test('Tread marks project onto the actual ground instead of the interpolated tank height', () => {
    const map = generateMap(1);
    for (const planet of map.planets) {
        planet.obstacles = [];
        planet.holes = [];
    }
    const world = new World(map);
    const point = world.position(0, vec(0, 1, 0), 4);
    const contact = treadSurface(world, 0, [point], 4);
    assert.ok(contact);
    assert.ok(distance(contact, world.position(0, vec(0, 1, 0), .015)) < 1e-8);
});

test('Tread marks stay on obstacle tops and do not bridge ledges or holes', () => {
    const map = generateMap(1);
    for (const planet of map.planets) {
        planet.obstacles = [];
        planet.holes = [];
    }
    map.planets[0].obstacles.push({ kind: ShapeKind.BOX, dir: [0, 1, 0], yaw: 0,
        size: [2, 2, 2], height: 3, variant: 0 });
    const world = new World(map);
    const top = world.position(0, vec(0, 1, 0), 3);
    const contact = treadSurface(world, 0, [top], 3);
    assert.ok(contact);
    assert.ok(distance(contact, world.position(0, vec(0, 1, 0), 3.015)) < 1e-8);
    const outside = world.position(0, normalize(vec(), vec(.2, 1, 0)), 3);
    assert.equal(treadSurface(world, 0, [top, outside], 3), undefined);
    map.planets[0].holes = [{ dir: [0, 1, 0], angRadius: .15, harmonics: [] }];
    const holedWorld = new World(map);
    assert.equal(treadSurface(holedWorld, 0, [top], 3), undefined);
    assert.equal(treadSurface(holedWorld, 0, [outside, top], 3), undefined);
});

test('The explosion noise removes about 90 percent of the final visible sphere', () => {
    const source = readFileSync(new URL('../../client/galaxy_tanks/js/render/effects.js', import.meta.url), 'utf8');
    const match = source.match(/chunks > ([\d.]+)-gaps\*([\d.]+)/);
    assert.ok(match);
    const threshold = Number(match[1]) - Number(match[2]);
    let holes = 0;
    const samples = 20000;
    for (let i = 0; i < samples; i++) {
        const r = Math.sqrt((i + .5) / samples);
        const angle = i * 2.399963229728653;
        const x = r * Math.cos(angle) * 18;
        const y = r * Math.sin(angle) * 58;
        const z = Math.sqrt(1 - r * r) * 18;
        const chunks = Math.sin(x + Math.sin(y * 1.7 + 5)) *
            Math.sin(z + Math.sin(x * 1.3 - 8)) *
            Math.sin(y + Math.sin(z * 1.9 + 6));
        if (chunks > threshold) holes++;
    }
    assert.ok(holes / samples > .85 && holes / samples < .95, `Final holes: ${holes / samples}`);
});
