import { test } from 'node:test';
import assert from 'node:assert/strict';
import Client from '../../server/client.js';
import GalaxyTankGame from '../../server/games/galaxy_tanks.js';
import { Action, GalaxySync, TankState } from '../../client/galaxy_tanks/js/types.js';
import { normalize, tuple, vec } from '../../client/galaxy_tanks/js/sim/math/vec3.js';
import { MAX_PLAYERS } from '../../client/galaxy_tanks/js/vars.js';
function client(name: string) {
    const messages: Array<Record<string, unknown>> = [];
    const c = new Client({ sendUTF: (s: string) => messages.push(JSON.parse(s)) });
    c.username = name; return Object.assign(c, { messages });
}
test('Lobby, authority, spectators, reconnects and complete late snapshots', () => {
    const g = new GalaxyTankGame(), a = client('Ann'), b = client('Bob'); g.uuid = 'test';
    assert.equal(g.interval, null); g.onJoin(a); g.onJoin(b);
    assert.equal(g.state.tanks[0].ready, true); assert.equal(g.state.tanks[1].ready, false);
    g.onReady(a); assert.equal(g.state.inLobby, true);
    const old = g.state.tanks[1].color;
    g.onMessage(b, { type: GalaxySync.CHANGE_COLOR, color: g.state.tanks[0].color });
    assert.equal(g.state.tanks[1].color, old);
    g.onMessage(b, { type: GalaxySync.CHANGE_ROUNDS, round: 0 }); assert.equal(g.state.totalRounds, 20);
    g.onMessage(a, { type: GalaxySync.CHANGE_ROUNDS, round: 0 }); assert.equal(g.state.totalRounds, 5);
    b.ready = true; g.onReady(b); g.onReady(a); assert.equal(g.state.inLobby, false);
    const s = client('Spectator'); g.onJoin(s); assert.equal(g.seats.has(s.id), false);
    for (const type of [GalaxySync.MAP_DESC, GalaxySync.CREATE_ALL_TANKS, GalaxySync.STATE_SYNC,
        GalaxySync.SYNC_ALL_BULLETS, GalaxySync.ADD_POWERUP_ITEM, GalaxySync.YOUARE_SPECTATOR])
        assert.ok(s.messages.some(m => m.type === type));
    const t = g.state.tanks[0]; g.state.now = g.state.roundStart + 1; t.iFrames = 0;
    g.onMove(s, { action: Action.FIRE }); assert.equal(t.firing, false);
    g.onMove(a, { action: Action.MOVE_INTENT, direction: [Infinity, 0, 0] }); assert.equal(t.move.x, 0);
    g.onMove(a, { action: Action.MOVE_INTENT, direction: [20, 0, 0] }); assert.equal(t.move.x, 0);
    g.onMove(a, { action: Action.MOVE_INTENT, direction: [0, 0, 0], turn: 1 }); assert.equal(t.turn, 1);
    for (const turn of [2, .5, Infinity, NaN, '1']) {
        g.onMove(a, { action: Action.MOVE_INTENT, direction: [0, 0, 0], turn }); assert.equal(t.turn, 1);
    }
    g.onMove(a, { action: Action.MOVE_INTENT, direction: [0, 0, 0], turn: 0 }); assert.equal(t.turn, 0);
    g.onMove(a, { action: Action.UPDATE_STATE });
    assert.ok(a.messages.some(m => m.type === GalaxySync.CORRECT_POSITION));
    const corrected = a.messages.filter(m => m.type === GalaxySync.CORRECT_POSITION).length;
    const dir = normalize(vec(), vec(t.dir.x + 0.0001, t.dir.y, t.dir.z));
    g.onMove(a, { action: Action.UPDATE_STATE, p: t.planet, d: tuple(dir), h: t.h });
    assert.equal(a.messages.filter(m => m.type === GalaxySync.CORRECT_POSITION).length, corrected);
    g.onMove(a, { action: Action.UPDATE_STATE, p: t.planet, d: [0, 0, 0], h: 999 });
    assert.equal(a.messages.filter(m => m.type === GalaxySync.CORRECT_POSITION).length, corrected + 1);
    g.onDisconnect(b); assert.equal(g.state.tanks[1].missingPlayer, true);
    const c = client('Reconnect'); g.onJoin(c); assert.equal(g.seats.get(c.id), g.state.tanks[1]);
    g.state.tanks[1].state = TankState.DEAD; g.state.roundStart = Date.now() - 2000;
    g.state.roundEnd = Date.now() - 1;
    g.state.round = g.state.totalRounds; g.tick(Date.now());
    assert.equal(g.state.inLobby, true); assert.equal(g.seats.has(s.id), false);
    g.onMessage(s, { type: GalaxySync.JOIN_PLAYER }); assert.equal(g.seats.has(s.id), true);
    assert.equal(g.state.tanks[0].ready, true); assert.equal(g.seats.get(c.id)!.ready, false); g.onRemove();
});
test('Full lobbies still admit pure spectators and removal clears timer', () => {
    const g = new GalaxyTankGame();
    for (let i = 0; i < MAX_PLAYERS + 2; i++) assert.ok(g.onJoin(client(`P${i}`)));
    assert.equal(g.seats.size, MAX_PLAYERS); assert.equal(g.playerCount, MAX_PLAYERS + 2);
    g.onRoomCreate(); assert.ok(g.interval); g.onRemove(); assert.equal(g.interval, null);
});
