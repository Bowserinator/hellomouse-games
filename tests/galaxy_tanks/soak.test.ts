import { test } from 'node:test';
import assert from 'node:assert/strict';
import Client from '../../server/client.js';
import GalaxyTankGame from '../../server/games/galaxy_tanks.js';
import { Action, GalaxySync, TankState } from '../../client/galaxy_tanks/js/types.js';
import { tuple } from '../../client/galaxy_tanks/js/sim/math/vec3.js';

test('Four fake clients and a late spectator remain synchronized through repeated rounds', () => {
    const game = new GalaxyTankGame();
    const clients = Array.from({ length: 5 }, (_, i) => {
        const c = new Client({ sendUTF: (s: string) => {
            const data = JSON.parse(s);
            if (data.type === GalaxySync.GENERIC_TANK_SYNC)
                assert.equal(data.data.length, game.state.tanks.length);
        } });
        c.username = `Bot${i}`; return c;
    });
    clients.slice(0, 4).forEach(c => game.onJoin(c));
    clients.slice(1, 4).forEach(c => {
        c.ready = true; game.onReady(c);
    });
    game.onReady(clients[0]); game.onJoin(clients[4]);
    assert.equal(game.seats.size, 4);
    const start = Date.now(); let rounds = 0;
    for (let i = 1; i <= 2200; i++) {
        const now = start + i * 30;
        clients.slice(0, 4).forEach(c => {
            const t = game.seats.get(c.id)!;
            game.onMove(c, { action: Action.MOVE_INTENT, direction: tuple(t.fwd) });
            game.onMove(c, { action: Action.FIRE, aim: tuple(t.aim) });
            t.lastInput = now;
        });
        game.onMove(clients[4], { action: Action.LEAP });
        game.tick(now);
        for (const tank of game.state.tanks) {
            assert.ok([tank.dir.x, tank.dir.y, tank.dir.z, tank.h, tank.vy].every(Number.isFinite));
            assert.ok(Math.abs(Math.hypot(tank.dir.x, tank.dir.y, tank.dir.z) - 1) < 1e-6);
        }
        if (i % 200 === 0 && !game.state.inLobby)
            game.state.tanks.slice(1).forEach(t => {
                t.iFrames = 0; t.shield = 0;
                if (t.state !== TankState.FLYING) game.state.killTank(t);
            });

        rounds = Math.max(rounds, game.state.round);
    }
    assert.ok(rounds >= 3); assert.equal(game.seats.has(clients[4].id), false);
    game.onRemove(); assert.equal(game.interval, null);
});
