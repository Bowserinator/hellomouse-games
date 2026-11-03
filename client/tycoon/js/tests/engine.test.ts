import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine, checkPlay } from '../engine.js';
import { strength } from '../cards.js';
import type { TCard, Zone } from '../types.js';

export function seeded(seed: number): () => number {
    return () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32;
    };
}
let iid = 0;
const card = (value: number, suit: TCard['suit'] = 'Clubs'): TCard =>
    ({ iid: `test${iid++}`, value, suit: value ? suit : null, joker: !value });
export function fixture(hands: Array<Array<TCard>>): Engine {
    const e = new Engine({ rng: seeded(1) });
    e.hands = hands; e.deck = []; e.discard = []; e.tableCards = []; e.table = null;
    e.turn = e.leader = 0; e.events = []; return e;
}
const play = (e: Engine, seat: number, cards = e.hands[seat]): void => {
    assert.equal(e.dispatch(seat, { action: 'PLAY', iids: cards.map(c => c.iid) }), null);
};

test('Deck sizes, strength, reveal and configuration', () => {
    for (const jokers of [false, true]) {
        const e = new Engine({ jokers, rng: seeded(1) });
        assert.deepEqual(e.hands.map(h => h.length).sort(), jokers ? [13, 13, 14, 14] : [13, 13, 13, 13]);
        assert.equal(new Set(e.hands.flat().map(c => c.iid)).size, jokers ? 54 : 52);
        assert.ok(e.hands[e.turn].some(c => c.value === 2 && c.suit === 'Hearts'));
        assert.equal(e.events.filter(v => v.group === 'reveal').length, 2);
    }
    assert.deepEqual([2, 3, 13, 1, 0].map(v => strength(card(v))), [0, 1, 11, 12, 13]);
    for (const rounds of [0, 21, 1.5, NaN]) assert.throws(() => new Engine({ rounds }));
});

test('Validation rejects malformed sets, wrong turn, duplicates, foreign cards and leading passes', () => {
    const e = fixture([[card(3), card(4), card(0)], [card(8)], [card(9)], [card(10)]]);
    for (const ids of [null, [], ['missing'], [e.hands[0][0].iid, e.hands[0][0].iid], e.hands[0].map(c => c.iid)])
        assert.ok('error' in checkPlay(e, 0, ids));
    assert.ok(e.dispatch(0, { action: 'PASS' }));
    assert.ok('error' in checkPlay(e, 1, [e.hands[1][0].iid]));
    assert.ok('ok' in checkPlay(e, 0, [e.hands[0][0].iid, e.hands[0][2].iid]));
});

test('Pass lasts all hand; winner leads; an out winner hands off clockwise', () => {
    const e = fixture([[card(3), card(4)], [card(5), card(6)], [card(8)], [card(9)]]);
    play(e, 0, [e.hands[0][0]]);
    assert.equal(e.dispatch(1, { action: 'PASS' }), null);
    play(e, 2); play(e, 3);
    assert.equal(e.turn, 0);
    assert.equal(e.dispatch(0, { action: 'PASS' }), null);
    assert.equal(e.table, null); assert.equal(e.turn, 0); assert.equal(e.passed.size, 0);
});

test('Jokers beat naturals in either order, only 2 spades beats single joker, resolves immediately', () => {
    for (const revolution of [false, true]) {
        const e = fixture([[card(1), card(4)], [card(0), card(4)], [card(2, 'Spades'), card(4)], [card(8)]]);
        e.revolution = revolution;
        play(e, 0, [e.hands[0][0]]); play(e, 1, [e.hands[1][0]]);
        assert.ok('error' in checkPlay(e, 2, [e.hands[2][1].iid]));
        play(e, 2, [e.hands[2][0]]); assert.equal(e.table, null); assert.equal(e.turn, 2);
    }
    const e = fixture([[card(0), card(0), card(4)], [card(1), card(1)], [card(2)], [card(3)]]);
    play(e, 0, e.hands[0].slice(0, 2));
    assert.ok('error' in checkPlay(e, 1, e.hands[1].map(c => c.iid)));
});

test('Revolution validates before flipping, repeated flips and lucky wild sevens', () => {
    const e = fixture([
        [card(4), card(4), card(4), card(0), card(9)],
        [card(3), card(3), card(3), card(3), card(8)], [card(5)], [card(6)]
    ]);
    play(e, 0, e.hands[0].slice(0, 4)); assert.equal(e.revolution, true);
    play(e, 1, e.hands[1].slice(0, 4)); assert.equal(e.revolution, false);
    for (const revolution of [false, true]) {
        const lucky = fixture([[card(7), card(7), card(7), card(0), card(9)], [card(2)], [card(3)], [card(4)]]);
        lucky.revolution = revolution; play(lucky, 0, lucky.hands[0].slice(0, 4));
        assert.equal(lucky.revolution, !revolution); assert.equal(lucky.table, null); assert.equal(lucky.turn, 0);
    }
    const illegal = fixture([[card(8), card(9)], [card(7), card(3)], [card(4)], [card(5)]]);
    play(illegal, 0, [illegal.hands[0][0]]);
    assert.ok('error' in checkPlay(illegal, 1, [illegal.hands[1][0].iid]));
});

test('Bankruptcy, finishing order, scoring and all Beggar cards discarded', () => {
    const e = fixture([[card(9)], [card(7)], [card(4)], [card(5)]]);
    e.round = 2; e.totalRounds = 2; e.titles = ['tycoon', 'beggar', 'rich', 'poor']; e.turn = 1;
    play(e, 1); assert.equal(e.bankrupt, 0); assert.equal(e.hands[0].length, 0);
    play(e, 2); assert.equal(e.phase, 'gameEnd');
    assert.deepEqual(e.out, [1, 2, 3, 0]); assert.deepEqual(e.scores, [0, 3, 2, 1]);
    assert.equal(e.discard.length, 4); assert.deepEqual(e.winnerSeats, [1]);
    const first = fixture([[card(7)], [card(4)], [card(5)], [card(6)]]);
    play(first, 0); assert.equal(first.bankrupt, null);
    const tycoonFirst = fixture([[card(7)], [card(4)], [card(5)], [card(6)]]);
    tycoonFirst.titles = ['tycoon', 'rich', 'poor', 'beggar'];
    play(tycoonFirst, 0); assert.equal(tycoonFirst.bankrupt, null);
});

test('Jokers off leaves 2 spades ordinary; matching-size lucky answers clear in either order', () => {
    const ordinary = fixture([[card(3), card(4)], [card(2, 'Spades'), card(4)], [card(5)], [card(6)]]);
    ordinary.options.jokers = false;
    play(ordinary, 0, [ordinary.hands[0][0]]);
    assert.ok('error' in checkPlay(ordinary, 1, [ordinary.hands[1][0].iid]));
    ordinary.revolution = true;
    play(ordinary, 1, [ordinary.hands[1][0]]);
    assert.notEqual(ordinary.table, null);
    for (const revolution of [false, true]) {
        const e = fixture([[card(revolution ? 8 : 6), card(revolution ? 8 : 6), card(9)],
            [card(7), card(0), card(4)], [card(5)], [card(6)]]);
        e.revolution = revolution;
        play(e, 0, e.hands[0].slice(0, 2)); play(e, 1, e.hands[1].slice(0, 2));
        assert.equal(e.table, null); assert.equal(e.turn, 1);
    }
});

test('Final standings include every tied winner', () => {
    const e = fixture([[card(7)], [card(8)], [card(9)], [card(10)]]);
    e.totalRounds = 1; e.scores = [0, 1, 2, 0];
    play(e, 0); play(e, 1); play(e, 2);
    assert.equal(e.phase, 'gameEnd');
    assert.deepEqual(e.scores, [3, 3, 3, 0]); assert.deepEqual(e.winnerSeats, [0, 1, 2]);
});

test('Exchange is private, highest cards automatic, both choices required, Beggar leads', () => {
    const e = new Engine({ rounds: 2, rng: seeded(2) });
    while (e.phase === 'play') {
        const ids = e.legalPlays(e.turn)[0];
        assert.equal(e.dispatch(e.turn, ids ? { action: 'PLAY', iids: ids } : { action: 'PASS' }), null);
    }
    assert.equal(e.phase, 'roundEnd');
    assert.equal(e.dispatch(0, { action: 'CONTINUE' }), null);
    assert.equal(e.revolution, false); assert.equal(e.phase, 'exchange');
    const tycoon = e.titles.indexOf('tycoon'), rich = e.titles.indexOf('rich'), beggar = e.titles.indexOf('beggar');
    assert.equal(e.hands[tycoon].length, 16); assert.equal(e.hands[rich].length, 15);
    for (const [seat, prompt] of e.pendingExchange) {
        const moved = prompt.received.map(id => e.hands[seat].find(c => c.iid === id) as TCard);
        assert.ok(Math.min(...moved.map(strength)) >= Math.max(...e.hands[prompt.to].map(strength)));
        assert.ok(e.view(-1).events.filter(v => v.group === 'exchange').every(v => v.card.value === null));
    }
    const a = e.view(tycoon).exchange;
    assert.ok(a); assert.equal(e.dispatch(tycoon, { action: 'EXCHANGE', iids: a?.received }), null);
    assert.equal(e.phase, 'exchange'); assert.equal(e.view(tycoon).exchange, null);
    assert.equal(e.dispatch(rich, { action: 'EXCHANGE', iids: e.view(rich).exchange?.received }), null);
    assert.equal(e.phase, 'play'); assert.equal(e.turn, beggar);
});

test('Event replay conserves cards, exact zone order, and hidden hands across random games', () => {
    for (const jokers of [false, true]) for (let seed = 0; seed < 8; seed++) {
        const e = new Engine({ jokers, rounds: 3, rng: seeded(seed) });
        const zones = new Map<string, Array<string>>([['deck', []], ['discard', []], ['table', []], ...[0, 1, 2, 3].map(i => [`hand${i}`, []] as [string, Array<string>])]);
        const key = (z: Zone): string => typeof z === 'string' ? z : `hand${z.hand}`;
        // Setup's first shuffle sees the initial deck in ID order.
        zones.set('deck', Array.from({ length: jokers ? 54 : 52 }, (_, i) => `c${i}`));
        let seen = 0;
        for (let step = 0; ; step++) {
            assert.ok(step < 3000);
            for (const event of e.events.filter(v => v.seq > seen)) {
                const from = zones.get(key(event.from)) as Array<string>;
                const to = zones.get(key(event.to)) as Array<string>;
                const index = from.indexOf(event.card.iid); assert.notEqual(index, -1);
                from.splice(index, 1); to.push(event.card.iid); seen = event.seq;
                assert.equal(new Set([...zones.values()].flat()).size, jokers ? 54 : 52);
            }
            for (const zone of ['deck', 'discard', 'table', ...[0, 1, 2, 3].map(hand => ({ hand }))] as Array<Zone>) {
                const actual = typeof zone === 'object' ? e.hands[zone.hand] : zone === 'table' ? e.tableCards : e[zone];
                assert.deepEqual(zones.get(key(zone)), actual.map(c => c.iid));
            }
            for (let seat = -1; seat < 4; seat++)
                assert.ok(e.view(seat, seen).hands.every((h, i) => i === seat ||
                    h.every(c => c.value === null && c.joker === null)));
            if (e.phase === 'gameEnd') break;
            if (e.phase === 'roundEnd') e.dispatch(0, { action: 'CONTINUE' });
            else if (e.phase === 'exchange')
                for (const seat of e.view(-1, seen).pendingExchange) {
                    const p = e.view(seat, seen).exchange;
                    assert.equal(e.dispatch(seat, { action: 'EXCHANGE', iids: e.hands[seat].slice(0, p?.count).map(c => c.iid) }), null);
                }
            else {
                const ids = e.legalPlays(e.turn)[0];
                assert.equal(e.dispatch(e.turn, ids ? { action: 'PLAY', iids: ids } : { action: 'PASS' }), null);
            }
        }
        assert.equal(e.scores.reduce((a, b) => a + b), 18);
    }
});
