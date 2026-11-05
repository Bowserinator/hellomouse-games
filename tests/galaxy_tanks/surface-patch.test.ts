import { test } from 'node:test';
import assert from 'node:assert/strict';
import type * as T from 'three';
import { surfaceMaterial } from '../../client/galaxy_tanks/js/render/planet/surface-material.js';
import { contactShadow } from '../../client/galaxy_tanks/js/render/planet/contact-shadow.js';
import { DIRT_STYLE, GRASS_TONES } from '../../client/galaxy_tanks/js/render/planet/surface-styles.js';
import { generateMap } from '../../client/galaxy_tanks/js/sim/mapgen/index.js';
import { STRATEGIES } from '../../client/galaxy_tanks/js/sim/mapgen/strategies/index.js';
import { Rng } from '../../client/galaxy_tanks/js/sim/math/rng.js';
import { cross, dot, sub, vec } from '../../client/galaxy_tanks/js/sim/math/vec3.js';
import { HoleStyle, ObstacleStrategyType, ShapeKind, SurfaceType } from '../../client/galaxy_tanks/js/types.js';

class Color {
    constructor(public value: unknown) {}
    setHSL(h: number, s: number, l: number) {
        this.value = [h, s, l];
    }
}
class Matrix {
    values: Array<number> = [];
    set(...values: Array<number>) {
        this.values = values; return this;
    }
}
class Vector {
    constructor(public x = 0, public y = 0) {}
}
class Shader {
    constructor(options: unknown) {
        Object.assign(this, options);
    }
}
class Attribute {
    array: Float32Array;
    constructor(values: Array<number>, public itemSize: number) {
        this.array = new Float32Array(values);
    }
}
class Geometry {
    attributes: Record<string, Attribute> = {};
    index = { array: [] as Array<number> };
    setAttribute(name: string, attribute: Attribute) {
        this.attributes[name] = attribute;
    }
    getAttribute(name: string) {
        return this.attributes[name];
    }
    setIndex(indices: Array<number>) {
        this.index.array = indices;
    }
    getIndex() {
        return this.index;
    }
}
class Mesh {
    constructor(public geometry: Geometry, public material: Shader) {}
}

test('Surface patch preserves plastic patterns and pattern suppression while adding seeded mowing and shadows', () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'THREE');
    Object.defineProperty(globalThis, 'THREE', { configurable: true, value: Object.fromEntries([
        ['Color', Color], ['Matrix3', Matrix], ['Vector2', Vector], ['ShaderMaterial', Shader],
        ['BufferGeometry', Geometry], ['Float32BufferAttribute', Attribute], ['Mesh', Mesh]
    ]) });
    try {
        const planet = generateMap(1).planets[0];
        const texture = {} as T.Texture, sky = {} as T.CubeTexture;
        const grass = { ...planet, surface: SurfaceType.GRASS, surfaceSeed: 0 };
        const material = surfaceMaterial(grass, texture, texture, sky, sky);
        assert.equal(material.uniforms.uPattern.value, 1);
        assert.equal(surfaceMaterial({ ...grass, surfaceSeed: 16 }, texture, texture, sky, sky)
            .uniforms.uPattern.value, 2);
        assert.deepEqual(material.uniforms.uBasis.value,
            surfaceMaterial(grass, texture, texture, sky, sky).uniforms.uBasis.value);
        const rows = (material.uniforms.uBasis.value as Matrix).values;
        for (let i = 0; i < 3; i++)
            for (let j = 0; j < 3; j++)
                assert.ok(Math.abs(dot(vec(rows[i * 3], rows[i * 3 + 1], rows[i * 3 + 2]),
                    vec(rows[j * 3], rows[j * 3 + 1], rows[j * 3 + 2])) - Number(i === j)) < 1e-8);
        assert.deepEqual(material.uniforms.uPatternTone.value, new Vector(GRASS_TONES.dark, GRASS_TONES.bright));
        const plain = surfaceMaterial(grass, texture, texture, sky, sky, undefined, { pattern: false });
        assert.equal(plain.uniforms.uPattern.value, 0);
        const soil = surfaceMaterial(grass, texture, texture, sky, sky, DIRT_STYLE, { occlusion: true });
        assert.equal(soil.uniforms.uPattern.value, 0);
        assert.equal(soil.uniforms.uTint.value.value, DIRT_STYLE.tint);
        assert.equal(soil.uniforms.uAo.value, .28);
        assert.equal(soil.uniforms.uAoHeight.value, 1.5);
        assert.equal(soil.uniforms.uGlow.value, 0);
        const plastic = { ...planet, surface: SurfaceType.PLASTIC };
        assert.ok(surfaceMaterial(plastic, texture, texture, sky, sky).uniforms.uCheck.value.x > 0);
        assert.equal(surfaceMaterial(plastic, texture, texture, sky, sky, undefined, { pattern: false })
            .uniforms.uCheck.value.x, 0);
        assert.equal(contactShadow({ ...grass, obstacles: [] }, sky), null);
        const shadow = contactShadow({ ...grass, holes: [{ dir: [0, 1, 0], angRadius: .1, harmonics: [] }],
            obstacles: [{ kind: ShapeKind.BOX, dir: [0, 1, 0], yaw: .7,
                size: [3, 2, 2], height: 2, variant: 0 }] }, sky)!;
        const positions = shadow.geometry.getAttribute('position').array;
        const indices = shadow.geometry.getIndex()!.array;
        const alphas = shadow.geometry.getAttribute('aAlpha').array;
        for (let i = 0; i < positions.length; i += 3)
            assert.ok(Math.abs(Math.hypot(positions[i], positions[i + 1], positions[i + 2]) -
                (grass.radius + .03)) < 1e-5);
        for (let i = 0; i < indices.length; i += 3) {
            const point = (id: number) => vec(positions[id * 3], positions[id * 3 + 1], positions[id * 3 + 2]);
            const a = point(indices[i]), b = point(indices[i + 1]), c = point(indices[i + 2]);
            assert.ok(dot(cross(vec(), sub(vec(), b, a), sub(vec(), c, a)), a) > 0);
        }
        assert.equal(alphas[alphas.length - 1], 0);
        assert.ok(Math.abs(alphas[0] - .38) < 1e-6);
        assert.equal((shadow.material as T.ShaderMaterial).uniforms.uHoles.value, 1);
    } finally {
        if (previous) Object.defineProperty(globalThis, 'THREE', previous);
        else Reflect.deleteProperty(globalThis, 'THREE');
    }
});

test('Circular hole surfaces retain layout options and deterministic random-stream consumption', () => {
    const planet = generateMap(43).planets[0];
    for (const holeStyle of [HoleStyle.RANDOM, HoleStyle.CIRCULAR]) {
        const generate = (surface: SurfaceType) => {
            const rng = new Rng(43);
            const features = STRATEGIES[ObstacleStrategyType.HOLES].generate({
                rng, planet: { ...planet, surface }, keepOuts: [], params: { holeStyle }
            });
            return { features, next: rng.float() };
        };
        const rock = generate(SurfaceType.ROCK);
        for (const surface of [SurfaceType.MIRROR, SurfaceType.PLASTIC]) {
            const result = generate(surface);
            assert.deepEqual(result, generate(surface));
            assert.equal(result.next, rock.next);
            assert.deepEqual(result.features.core, rock.features.core);
            const holes = result.features.holes!;
            assert.ok(holes.length > 0);
            assert.ok(holes.every(hole => hole.harmonics.length === 0));
            assert.deepEqual(holes.map(hole => hole.dir), rock.features.holes!.map(hole => hole.dir));
        }
    }
});
