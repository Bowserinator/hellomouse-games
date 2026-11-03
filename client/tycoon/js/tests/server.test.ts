import { test } from 'node:test';
import assert from 'node:assert/strict';
import Client from '../../../../server/client.js';
import TycoonGame from '../../../../server/games/tycoon.js';
import { decide } from '../ai.js';
import type { Engine } from '../engine.js';
import type { Sync } from '../types.js';

function client(username: string): Client & { messages: Array<Sync & { error?: string }> } {
    const messages: Array<Sync & { error?: string }> = [];
    const c = new Client({ sendUTF: (text: string) => messages.push(JSON.parse(text)) });
    c.username = username; return Object.assign(c, { messages });
}
function room(): { g: TycoonGame; a: ReturnType<typeof client> } {
    const g = new TycoonGame(), a = client('Ann'); g.uuid = 'test';
    assert.ok(g.onJoin(a)); return { g, a };
}

test('Four fixed seats, human joins replace AI, leave restores AI, cap at four humans', () => {
    const { g, a } = room();
    assert.deepEqual(g.globalStateSync(a).seats.map(s => s.ai), [false, true, true, true]);
    const b = client('Bob'); g.onJoin(b); g.onDisconnect(a);
    assert.equal(g.globalStateSync(b).isHost, true);
    for (let i = 0; i < 3; i++) assert.ok(g.onJoin(client(`P${i}`)));
    assert.equal(g.onJoin(client('Overflow')), false); g.onRemove();
});

test('Host options validated live, start requires ready humans, options persist after returning', () => {
    const { g, a } = room(); const b = client('Bob'); g.onJoin(b);
    g.onMove(b, { action: 'SET_OPTIONS', rounds: 1, jokers: false }); assert.equal(g.settings.rounds, 5);
    for (const rounds of [0, 21, 1.2, '2', NaN]) {
        g.onMove(a, { action: 'SET_OPTIONS', rounds, jokers: false }); assert.equal(g.settings.rounds, 5);
    }
    g.onMove(a, { action: 'SET_OPTIONS', rounds: 1, jokers: false });
    assert.deepEqual(b.messages.at(-1)?.settings, { rounds: 1, jokers: false });
    g.onMove(a, { action: 'START_GAME' }); assert.equal(g.engine, null);
    a.ready = b.ready = true;
    g.onMove(b, { action: 'START_GAME' }); assert.equal(g.engine, null);
    g.onMove(a, { action: 'START_GAME' }); assert.ok(g.engine);
    assert.ok(a.messages.at(-1)?.view?.events.some(e => e.group === 'deal'));
    g.onMove(a, { action: 'SET_OPTIONS', rounds: 2, jokers: true }); assert.equal(g.settings.rounds, 1);
    g.onMove(a, { action: 'RETURN_TO_LOBBY' }); assert.ok(g.engine);
    const e = g.engine as Engine | null;
    while (e && e.phase !== 'gameEnd') assert.equal(e.dispatch(e.turn, decide(e.view(e.turn, Infinity))), null);
    g.onMove(b, { action: 'RETURN_TO_LOBBY' }); assert.equal(g.engine, null);
    assert.deepEqual(g.settings, { rounds: 1, jokers: false }); assert.equal(a.ready, false);
    assert.equal(g.config.holdEmptySeats, false); g.onRemove();
});

test('Solo play, held human seats never become AI, observer privacy and private resume token', () => {
    const { g, a } = room(); a.ready = true; g.onMove(a, { action: 'START_GAME' });
    const token = g.globalStateSync(a).token;
    const ids = g.engine?.hands[0].map(c => c.iid);
    g.onDisconnect(a); assert.equal(g.config.holdEmptySeats, true);
    assert.equal(g.players[0], null);
    const watcher = client('Watcher'); assert.ok(g.onJoin(watcher));
    const sync = g.globalStateSync(watcher);
    assert.equal(sync.youAre, -1); assert.equal(sync.seats[0].ai, false);
    assert.ok(sync.view?.hands.flat().every(c => c.value === null)); assert.equal(sync.view?.events.length, 0);
    g.onMove(watcher, { action: 'RESUME', token: 'wrong' }); assert.equal(g.players[0], null);
    g.onMove(watcher, { action: 'RESUME', token }); assert.equal(g.players[0], watcher);
    assert.equal(watcher.username, 'Ann'); assert.deepEqual(g.engine?.hands[0].map(c => c.iid), ids);
    assert.equal(g.globalStateSync(watcher).view?.events.length, 0);
    g.onRemove(); assert.equal(g.engine, null);
});

test('AI and summary timers clear on disconnect/removal and resume with connected humans only', () => {
    const { g, a } = room(); a.ready = true; g.onMove(a, { action: 'START_GAME' });
    // Inspect timer ownership without exposing it as a public game API.
    const timers = (g as unknown as { timers: Set<unknown> }).timers;
    assert.ok(timers.size <= 1);
    g.onDisconnect(a); assert.equal(timers.size, 0);
    const observer = client('Observer'); g.onJoin(observer); assert.equal(timers.size, 0);
    g.onRemove(); assert.equal(timers.size, 0);
});
