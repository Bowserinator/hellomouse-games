import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../engine.js';
import { decide } from '../ai.js';
import { applyEvent, rewind } from '../ui/flights.js';

test('Flight snapshots conserve cards and keep opponent hands masked throughout every timeline', () => {
    let seed = 71;
    const rng = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296;
    };
    const engine = new Engine({ rounds: 3, rng });
    let seen = 0;
    for (let step = 0; step < 3000; step++) {
        for (const seat of [-1, 0]) {
            const view = engine.view(seat, seen);
            const zones = rewind(view);
            for (const event of view.events) {
                applyEvent(zones, event, seat);
                const cards = [...zones.values()].flat();
                assert.equal(cards.length, 54);
                assert.equal(new Set(cards.map(c => c.iid)).size, 54);
                for (let other = 0; other < 4; other++) if (other !== seat)
                    assert.ok(zones.get(`hand-${other}`)?.every(c => c.value === null));
            }
            for (let hand = 0; hand < 4; hand++)
                assert.deepEqual(zones.get(`hand-${hand}`), view.hands[hand]);
            assert.deepEqual(zones.get('table'), view.tablePile);
            assert.deepEqual(zones.get('discard'), view.discard);
        }
        seen = engine.events.at(-1)?.seq ?? 0;
        if (engine.phase === 'gameEnd') return;
        const seat = engine.phase === 'exchange' ? [...engine.pendingExchange.keys()]
            .find(i => engine.view(i, Infinity).exchange) ?? 0 : engine.turn;
        assert.equal(engine.dispatch(seat, engine.phase === 'roundEnd'
            ? { action: 'CONTINUE' } : decide(engine.view(seat, Infinity), rng)), null);
    }
    assert.fail('The animation test game did not terminate');
});
