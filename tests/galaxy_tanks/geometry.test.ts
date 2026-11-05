import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMap } from '../../client/galaxy_tanks/js/sim/mapgen/index.js';
import { SolidField } from '../../client/galaxy_tanks/js/sim/mapgen/solid-field.js';
import { bakeSdf, sampleBake } from '../../client/galaxy_tanks/js/render/planet/sdf-bake.js';
import { DEFAULT_TANK_STYLE as STYLE, ColorSlot } from '../../client/galaxy_tanks/js/render/tank/tank-style.js';
import { SHAPE_COLLIDERS } from '../../client/galaxy_tanks/js/sim/mapgen/shapes.js';
import { SURFACE_TABLE } from '../../client/galaxy_tanks/js/sim/mapgen/surfaces.js';
import { STRATEGIES } from '../../client/galaxy_tanks/js/sim/mapgen/strategies/index.js';
import { Rng } from '../../client/galaxy_tanks/js/sim/math/rng.js';
import { ObstacleStrategyType, Powerup, ShapeKind, SurfaceType } from '../../client/galaxy_tanks/js/types.js';
import { MUZZLE_H, MUZZLE_OFFSET, TANK_RADIUS } from '../../client/galaxy_tanks/js/vars.js';

test('SDF cube bake agrees with analytic solid field over 100000 directions', () => {
    const planet = generateMap(123, { strategy: ObstacleStrategyType.HOLES }).planets[0];
    assert.ok(planet.holes!.length > 0);
    const field = new SolidField(planet.holes, planet.radius), bake = bakeSdf(field, 192), rng = new Rng(19);
    let agreement = 0;
    for (let i = 0; i < 100000; i++) {
        const dir = rng.unitVec();
        if ((sampleBake(bake, dir) >= 0.5) === field.isSolid(dir)) agreement++;
    }
    assert.ok(agreement >= 99900, `Agreement ${agreement}/100000`);
});
test('Tank style, muzzle and exhaustive registries match the shared simulation', () => {
    assert.equal(STYLE.hitRadius, TANK_RADIUS);
    assert.equal(STYLE.anchors.muzzle[1], MUZZLE_H);
    assert.equal(-STYLE.anchors.muzzle[2], MUZZLE_OFFSET);
    for (const p of Object.values(Powerup).filter(v => typeof v === 'number')) assert.ok(STYLE.turret[p as Powerup]);
    const parts = [...STYLE.parts, ...Object.values(STYLE.turret).flatMap(t => t.parts)];
    for (const p of parts) {
        assert.ok(p.color.slot in ColorSlot);
        assert.ok(p.size.every(Number.isFinite)); assert.ok(p.position.every(Number.isFinite));
    }
    assert.equal(Object.keys(SHAPE_COLLIDERS).length, Object.values(ShapeKind).length / 2);
    assert.equal(Object.keys(SURFACE_TABLE).length, Object.values(SurfaceType).length / 2);
    assert.equal(Object.keys(STRATEGIES).length, Object.values(ObstacleStrategyType).length / 2);
});
