import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide } from '../ai.js';
import { Engine, checkPlay } from '../engine.js';
import type { TCard } from '../types.js';

const cards = (values: Array<number>): Array<TCard> => values.map((value, i) =>
    ({ iid: `ai${i}`, value, suit: value ? 'Spades' : null, joker: !value }));

test('AI exchanges low singletons before breaking groups and keeps jokers and 2 spades', () => {
    const view = new Engine().view(0, Infinity);
    view.hands[0] = cards([3, 3, 4, 2, 0]);
    view.phase = 'exchange'; view.exchange = { count: 2, to: 1, received: [] };
    const move = decide(view, () => .5);
    assert.equal(move.action, 'EXCHANGE'); assert.deepEqual(move.iids, ['ai2', 'ai0']);
});

test('AI finishes when possible, saves premium responses, but blocks an imminent finish', () => {
    const view = new Engine().view(0, Infinity);
    view.phase = 'play'; view.turn = 0; view.table = null;
    view.hands[0] = cards([4, 4, 0]);
    const finish = decide(view, () => .5);
    assert.equal(finish.action, 'PLAY');
    assert.deepEqual((finish.iids as Array<string>).sort(), ['ai0', 'ai1', 'ai2']);
    view.hands[0] = cards([1, 10, 3]); view.counts = [3, 9, 10, 10];
    view.table = { cards: cards([13]), owner: 1, count: 1, strength: 11, rank: 13,
        loneJoker: false, spade2OverJoker: false };
    assert.equal(decide(view, () => .5).action, 'PASS');
    view.counts[1] = 1;
    const response = decide(view, () => .5);
    assert.equal(response.action, 'PLAY'); assert.ok('ok' in checkPlay(view, 0, response.iids));
});
