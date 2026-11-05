import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AdaptiveResolution } from '../../client/galaxy_tanks/js/render/adaptive-resolution.js';

/** Feeds constant-length frames and returns every ratio the scaler asked for */
function run(scaler: AdaptiveResolution, frameMs: number, seconds: number): Array<number> {
    const changes: Array<number> = [];
    for (let elapsed = 0; elapsed < seconds * 1000; elapsed += frameMs) {
        const ratio = scaler.update(frameMs);
        if (ratio !== undefined) changes.push(ratio);
    }
    return changes;
}

test('Resolution holds while the game keeps 60 fps, and ignores isolated hitches', () => {
    const scaler = new AdaptiveResolution(1, .55, 1);
    assert.deepEqual(run(scaler, 1000 / 60, 4), []);
    scaler.update(50);
    assert.deepEqual(run(scaler, 1000 / 60, 3), []);
    assert.equal(scaler.ratio, 1);
});

test('Resolution drops quickly under load, by at most a fifth each time, down to the minimum', () => {
    const scaler = new AdaptiveResolution(1, .55, 1.1);
    const changes = run(scaler, 40, 12);
    assert.equal(changes[0], .8);
    assert.ok(changes.every((ratio, i) => ratio >= .55 && ratio >= (changes[i - 1] ?? 1) * .8 - 1e-9));
    assert.equal(changes[changes.length - 1], .55);
    assert.deepEqual(run(scaler, 40, 5), []);
});

test('Missing 60 fps by a little lowers resolution in proportion to the missed time', () => {
    const [slightly] = run(new AdaptiveResolution(1, .55, 1.1), 18.5, 5);
    const [clearly] = run(new AdaptiveResolution(1, .55, 1.1), 21, 5);
    assert.ok(slightly > .93 && slightly < 1, `Ratio ${slightly}`);
    assert.ok(clearly > .85 && clearly < slightly, `Ratio ${clearly}`);
});

test('Resolution climbs back after sustained 60 fps but never past the quality maximum', () => {
    const scaler = new AdaptiveResolution(.7, .55, 1);
    const changes = run(scaler, 1000 / 60, 60);
    assert.ok(changes.length >= 5);
    assert.ok(changes.every((ratio, i) => ratio > (changes[i - 1] ?? .7)));
    assert.equal(scaler.ratio, 1);
    assert.deepEqual(run(scaler, 1000 / 60, 30), []);
});

test('A failed upward probe returns to the last good ratio and waits longer before retrying', () => {
    const scaler = new AdaptiveResolution(.8, .55, 1);
    const raised = run(scaler, 1000 / 60, 8);
    assert.deepEqual(raised, [.85]);
    assert.deepEqual(run(scaler, 40, 1.1), [.8]);
    let quiet = 0;
    for (; quiet < 30; quiet++) if (run(scaler, 1000 / 60, 1).length) break;
    assert.ok(quiet >= 10 && quiet < 30, `Retried after ${quiet} seconds`);
});

test('Settling ignores slow frames while shaders compile', () => {
    const scaler = new AdaptiveResolution(1, .55, 1.1);
    run(scaler, 1000 / 60, 3);
    scaler.settle();
    assert.deepEqual(run(scaler, 100, 1.5), []);
    assert.deepEqual(run(scaler, 1000 / 60, 3), []);
    assert.equal(scaler.ratio, 1);
});
