import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MovementInput } from '../../client/galaxy_tanks/js/movement-input.js';
import { GameView } from '../../client/galaxy_tanks/js/render/game-view.js';
import { CameraRig, blueNoise } from '../../client/galaxy_tanks/js/render/camera-rig.js';
import { AdaptiveResolution } from '../../client/galaxy_tanks/js/render/adaptive-resolution.js';
import { Bullet } from '../../client/galaxy_tanks/js/sim/bullet.js';
import { GameState } from '../../client/galaxy_tanks/js/sim/gamestate.js';
import { Tank } from '../../client/galaxy_tanks/js/sim/tank.js';
import { generateMap } from '../../client/galaxy_tanks/js/sim/mapgen/index.js';
import { BulletType, GalaxySync } from '../../client/galaxy_tanks/js/types.js';
import { cross, distance, dot, normalize, scale, sub, V3, vec } from '../../client/galaxy_tanks/js/sim/math/vec3.js';

function arena(): GameState {
    const map = generateMap(1);
    for (const planet of map.planets) {
        planet.obstacles = [];
        planet.holes = [];
    }
    const game = new GameState(map);
    game.inLobby = false;
    game.now = 1000;
    game.tanks = [new Tank(0), new Tank(1)];
    game.tanks[0].planet = 1;
    game.tanks[1].planet = 2;
    game.tanks[0].aim = vec(1, 0, 0);
    return game;
}

test('Normal, rail, shotgun and laser rounds detonate bombs from either owner immediately', () => {
    for (const type of [BulletType.NORMAL, BulletType.FAST, BulletType.SMALL, BulletType.LASER])
        for (const owner of [0, 1]) {
            const game = arena();
            const bomb = new Bullet(100, owner, 0, vec(0, 1, 0), vec(1, 0, 0), 1.1, BulletType.BOMB, 0);
            const bullet = new Bullet(101, 0, 0, vec(0, 1, 0), vec(1, 0, 0), 1.1, type, 0);
            game.bullets.push(bomb, bullet);
            game.update(.001, 1001);
            assert.ok(!game.bullets.includes(bomb), `Detonates type ${type}, owner ${owner}`);
            assert.equal(game.bullets.filter(b => b.type === BulletType.SMALL).length, 25);
            assert.equal(game.events.filter(e => e.type === GalaxySync.ADD_EXPLOSIONS && e.radius === 3).length, 1);
        }
});

test('Ordinary rounds collide regardless of owner, including laser hits on own rounds', () => {
    for (const type of [BulletType.NORMAL, BulletType.FAST, BulletType.SMALL, BulletType.LASER])
        for (const owner of [0, 1]) {
            const game = arena();
            const target = new Bullet(100, owner, 0, vec(0, 1, 0), vec(-1, 0, 0), 1.1, BulletType.NORMAL, 0);
            const shot = new Bullet(101, 0, 0, vec(0, 1, 0), vec(1, 0, 0), 1.1, type, 0);
            game.bullets.push(target, shot);
            game.update(.001, 1001);
            assert.ok(!game.bullets.includes(target), `Target removed for type ${type}, owner ${owner}`);
            assert.ok(!game.bullets.includes(shot), `Shot removed for type ${type}, owner ${owner}`);
        }
});

test('Queued resizing and adaptive resolution finish before drawing, with a stable hold range', () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'THREE');
    Object.defineProperty(globalThis, 'THREE', { configurable: true, value: {} });
    try {
        const game = arena();
        const events: Array<string> = [];
        let pixel = 1;
        let painted = true;
        let now = 0;
        const canvas = { clientWidth: 800, clientHeight: 600, width: 800, height: 600 };
        const renderer = {
            domElement: canvas,
            getPixelRatio: () => pixel,
            setDrawingBufferSize(w: number, h: number, ratio: number) {
                events.push('resize');
                canvas.width = Math.floor(w * ratio);
                canvas.height = Math.floor(h * ratio);
                pixel = ratio;
                painted = false;
            }
        };
        const view: GameView = Object.assign(Object.create(GameView.prototype), {
            renderer, pixel, quality: 'MED', resolution: new AdaptiveResolution(1, .55, 1.1), resizePending: false,
            rigs: new Map(), planets: [], beams: [], previewTime: 0, flightStars: new Set(),
            matrix: { multiplyMatrices() {} }, frustum: { setFromProjectionMatrix() {} },
            camera: { camera: {}, resize() {
                events.push('projection');
            }, update() {
                events.push('camera');
            } },
            post: { explosions: false, resize() {}, render() {
                events.push('draw');
                painted = true;
            } },
            sky: { update() {} }, entities: { update() {}, setViewport() {} },
            preview: { update() {} }, trails: { update() {} }, effects: { update() {}, exploding: false }
        });
        const frame = (seconds: number) => {
            events.length = 0;
            now += seconds * 1000;
            view.render(game.world, [], [], [], 0, -1, now, seconds);
        };
        for (let i = 0; i < 180; i++) frame(1 / 60);
        assert.equal(pixel, 1);
        assert.ok(!events.includes('resize'));
        for (let i = 0; i < 100 && pixel === 1; i++) frame(.03);
        assert.equal(pixel, .8);
        assert.equal(events[0], 'resize');
        assert.equal(events[events.length - 1], 'draw');
        assert.ok(events.indexOf('resize') < events.indexOf('camera'));
        assert.equal(events.filter(e => e === 'resize').length, 1);
        assert.ok(painted);
        canvas.clientWidth = 1000;
        events.length = 0;
        view.resize();
        assert.equal(events.length, 0);
        assert.ok(painted);
        frame(1 / 60);
        assert.equal(canvas.width, 800);
        assert.equal(events[0], 'resize');
        assert.equal(events[events.length - 1], 'draw');
        view.resize();
        frame(1 / 60);
        assert.ok(!events.includes('resize'));
        for (let i = 0; i < 60 * 7; i++) frame(1 / 60);
        assert.ok(Math.abs(pixel - .85) < 1e-8);
        assert.ok(painted);
    } finally {
        if (previous) Object.defineProperty(globalThis, 'THREE', previous);
        else Reflect.deleteProperty(globalThis, 'THREE');
    }
});

test('Held W follows screen-up after camera turns, without waiting for another key press', () => {
    const source = readFileSync(new URL('../../client/galaxy_tanks/js/game.js', import.meta.url), 'utf8');
    const start = source.indexOf('movementUp.set(');
    const end = source.indexOf('self.turn =', start);
    assert.ok(start >= 0 && end > start);
    const controls = new Function('movementUp', 'screenRight', 'screenForward', 'view',
        'self', 'movement', 'movementKeys', 'keys', source.slice(start, end));
    const vector = () => ({
        x: 0,
        y: 0,
        z: 0,
        set(x: number, y: number, z: number) {
            Object.assign(this, { x, y, z });
            return this;
        },
        setFromMatrixColumn(matrix: Array<V3>, column: number) {
            Object.assign(this, matrix[column]);
            return this;
        },
        projectOnPlane(up: V3) {
            sub(this, this, scale(vec(), up, dot(this, up)));
            return this;
        },
        normalize() {
            normalize(this, this);
            return this;
        },
        crossVectors(a: V3, b: V3) {
            cross(this, a, b);
            return this;
        }
    });
    const movement = new MovementInput();
    const self = { dir: normalize(vec(), vec(.2, 1, .1)), move: vec() };
    for (const right of [vec(1, 0, 0), vec(0, 0, 1), vec(-1, .1, 0)]) {
        const view = { camera: { camera: { matrixWorld: [right] } } };
        controls(vector(), vector(), vector(), view, self, movement, ['w', 'a', 's', 'd'], new Set(['w']));
        const expected = normalize(vec(), cross(vec(), self.dir, right));
        assert.ok(distance(self.move, expected) < 1e-8);
        assert.ok(Math.abs(dot(self.move, right)) < 1e-8);
    }
});

test('Shake is local and its bounded zero-mean blue noise has power proportional to frequency', () => {
    const camera: CameraRig = Object.assign(Object.create(CameraRig.prototype), { look: vec(), shakeAmount: 0 });
    camera.shake(.4, vec(80, 0, 0));
    assert.equal(Reflect.get(camera, 'shakeAmount'), 0);
    camera.shake(.4, vec(20, 0, 0));
    assert.equal(Reflect.get(camera, 'shakeAmount'), .2);
    camera.shake(.4, vec());
    assert.equal(Reflect.get(camera, 'shakeAmount'), .4);
    const noise = Array.from({ length: 64 }, (_, i) => blueNoise(i));
    assert.ok(noise.every(n => Math.abs(n) <= 1));
    assert.ok(Math.abs(noise.reduce((a, b) => a + b, 0)) < 1e-10);
    const power = (frequency: number) => {
        let re = 0;
        let im = 0;
        for (let i = 0; i < noise.length; i++) {
            re += noise[i] * Math.cos(2 * Math.PI * frequency * i / 64);
            im += noise[i] * Math.sin(2 * Math.PI * frequency * i / 64);
        }
        return re * re + im * im;
    };
    assert.ok(Math.abs(power(8) / power(2) - 4) < 1e-10);
});
