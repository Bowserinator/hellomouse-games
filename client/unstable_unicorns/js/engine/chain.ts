import type { CardDef, CardEvent } from './dsl/ast.js';
import type { LoggedEvent } from './events.js';
import type { Iid } from './ids.js';
import type { Pending } from './state.js';
import { holds } from './dsl/cond.js';
import { moveCard } from './move.js';
import { condCtx } from './query/active.js';
import { isUnicorn, stableLimit, unicornCount } from './query/modifiers.js';
import { zoneOf } from './zones.js';
import { worldOf, type ExecCtx } from './exec/context.js';
import { run, startEffect, type RunState } from './exec/interpreter.js';

const MAX_CHAIN_STEPS = 10000;

export function triggerPendings(ex: ExecCtx, event: CardEvent): Array<Pending> {
    const world = worldOf(ex);
    const pendings: Array<Pending> = [];

    for (const player of ex.state.players)
        for (const iid of player.stable) {
            const def: CardDef | undefined = ex.defOf(iid);
            for (const trigger of def?.triggers ?? []) {
                if (trigger.on !== event.type) continue;
                if (!trigger.effect.id) continue;
                if (!holds(trigger.when, condCtx(world, player.id, iid, event))) continue;
                pendings.push({ source: iid, player: player.id, effect: trigger.effect.id });
            }
        }

    return pendings;
}

export function orderPendings(state: { turn: { player: number }; players: Array<unknown> }, pendings: Array<Pending>) {
    const seats = state.players.length;
    const rank = (player: number) => ((player - state.turn.player) % seats + seats) % seats;
    return pendings
        .map((pending, index) => ({ pending, index }))
        .sort((a, b) => rank(a.pending.player) - rank(b.pending.player) || a.index - b.index)
        .map(entry => entry.pending);
}

export function collectEvents(ex: ExecCtx, targeted: Array<Iid>) {
    for (const event of ex.log.drain() as Array<LoggedEvent>)
        for (const pending of triggerPendings(ex, event)) {
            if (targeted.includes(pending.source)) continue;
            targeted.push(pending.source);
            ex.state.links.next.push(pending);
        }
}

function overflowStable(ex: ExecCtx) {
    const world = worldOf(ex);
    for (const player of ex.state.players) {
        const limit = stableLimit(world, player.id);
        let extra = player.stable.filter(iid => !isUnicorn(world, iid)).length - limit;
        for (let i = player.stable.length - 1; i >= 0 && extra > 0; i--) {
            const iid = player.stable[i];
            if (isUnicorn(world, iid)) continue;
            moveCard({ ...world, log: ex.log, runReplacement: (owner, source, effect) => {
                if (effect.id) ex.queue({ source, player: owner, effect: effect.id });
            } }, iid, 'discard', 'discard');
            extra--;
        }
    }
}

function expireLingering(ex: ExecCtx) {
    ex.state.lingering = ex.state.lingering.filter(entry => {
        if (entry.until === 'endOfTurn') return true;
        return zoneOf(ex.state, entry.source) === 'stable';
    });
}

function checkWinner(ex: ExecCtx) {
    const world = worldOf(ex);
    const pending = ex.state.pendingWinner;
    if (pending !== null && unicornCount(world, pending) < ex.state.winTarget) ex.state.pendingWinner = null;
    const reached = ex.state.players.find(player => unicornCount(world, player.id) >= ex.state.winTarget);
    if (reached) ex.state.pendingWinner = reached.id;
}

export function endOfLink(ex: ExecCtx) {
    checkWinner(ex);
    if (ex.state.phase === 'OVER') return;
    overflowStable(ex);
    expireLingering(ex);
    checkWinner(ex);
}

export function resolveLinks(ex: ExecCtx): RunState {
    const links = ex.state.links;

    for (let step = 0; step < MAX_CHAIN_STEPS; step++) {
        if (ex.state.prompt) return 'wait';
        if (ex.state.phase === 'OVER') {
            ex.log.drain();
            return 'done';
        }

        if (ex.state.exec.length) {
            if (run(ex) === 'wait') return 'wait';
            collectEvents(ex, links.targeted);
            continue;
        }

        const pending = links.current.shift();
        if (pending) {
            startEffect(ex, pending.effect, pending.player, pending.source);
            continue;
        }

        links.targeted = [];
        endOfLink(ex);
        collectEvents(ex, links.targeted);
        if (!links.next.length) return 'done';

        links.current = orderPendings(ex.state, links.next);
        links.next = [];
    }

    throw new Error('Chain did not settle');
}
