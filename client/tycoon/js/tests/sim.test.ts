import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../engine.js';
import { decide } from '../ai.js';

function seeded(seed: number): () => number {
    return () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32;
    };
}

test('AI decisions are legal and 4,000 seeded games terminate across all round settings', () => {
    for (const jokers of [false, true]) for (let seed = 0; seed < 2000; seed++) {
        const rng = seeded(seed), rounds = seed % 20 + 1;
        const e = new Engine({ jokers, rounds, rng });
        let turns = 0;
        while (e.phase !== 'gameEnd') {
            assert.ok(++turns < rounds * 1500, `Turn cap: ${seed}/${jokers}/${rounds}`);
            const seat = e.phase === 'exchange' ? e.view(-1, Infinity).pendingExchange[0] : e.turn;
            const view = e.view(seat, Infinity);
            assert.equal(e.dispatch(seat, decide(view, rng)), null, `Illegal decision: seed ${seed}`);
        }
        assert.equal(e.scores.reduce((a, b) => a + b), rounds * 6);
        assert.equal(e.winnerSeats.length > 0, true);
    }
});
