import type { CardDef, CardEvent, Effect } from './dsl/ast.js';
import type { LoggedEvent } from './events.js';
import type { Iid } from './ids.js';
import type { Pending } from './state.js';
import { holds } from './dsl/cond.js';
import { moveCard } from './move.js';
import { condCtx } from './query/active.js';
import { blocksTriggers, isUnicorn, protectedFrom, stableLimit, unicornCount } from './query/modifiers.js';
import { zoneOf } from './zones.js';
import { moveCtxOf, worldOf, type ExecCtx } from './exec/context.js';
import { run, startEffect, type RunState } from './exec/interpreter.js';

const MAX_CHAIN_STEPS = 10000;

export function triggerPendings(ex: ExecCtx, event: CardEvent): Array<Pending> {
    const world = worldOf(ex);
    const pendings: Array<Pending> = [];

    const sources = ex.state.players.flatMap(player => player.stable.map(iid => ({ iid, owner: player.id })));
    if (event.card && event.player !== undefined && ex.state.cards[event.card]?.zone !== 'stable' &&
        (event.type === 'destroy' || event.type === 'sacrifice' || event.type === 'leaveStable'))
        sources.push({ iid: event.card, owner: event.player });

    for (const { iid, owner } of sources) {
        const def: CardDef | undefined = ex.defOf(iid);
        const departed = ex.state.cards[iid]?.zone !== 'stable';
        if (departed ? event.suppressed : isUnicorn(world, iid) && blocksTriggers(world, owner)) continue;
        for (const trigger of def?.triggers ?? []) {
            if (trigger.on !== event.type || !trigger.effect.id) continue;
            if (trigger.scope === 'source' && event.card !== iid) continue;
            if (trigger.scope === 'owner' && event.player !== owner) continue;
            if (trigger.unicorn && !event.unicorn) continue;
            if (!holds(trigger.when, condCtx(world, owner, iid, event))) continue;
            pendings.push({ source: iid, player: owner, effect: trigger.effect.id, event });
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
            targeted.push(pending.source);
            ex.state.links.next.push(pending);
        }
}

function overflowStable(ex: ExecCtx) {
    const world = worldOf(ex);
    for (const player of ex.state.players) {
        const extra = unicornCount(world, player.id) - stableLimit(world, player.id);
        if (extra <= 0) continue;
        const candidates = player.stable.filter(iid =>
            isUnicorn(world, iid) && !protectedFrom(world, iid, 'sacrifice'));
        if (candidates.length === 0) continue;

        const node = `__overflow:${Object.keys(ex.nodes).length}`;
        const effect: Effect = {
            e: 'prim',
            prim: {
                p: 'sacrifice',
                sel: {
                    zone: 'stable',
                    owner: 'self',
                    count: Math.min(extra, candidates.length),
                    filter: { f: 'unicorn' }
                }
            }
        };
        ex.nodes[node] = effect;
        ex.state.exec.push({ node, pc: 0, bindings: { frameBy: player.id, frameSource: '' } });
        return;
    }
}

function expireLingering(ex: ExecCtx) {
    for (const entry of ex.state.lingering) {
        if (entry.until !== 'sourceLeavesStable' || zoneOf(ex.state, entry.source) === 'stable') continue;
        if (entry.returnCard === undefined || entry.returnOwner === undefined) continue;
        const card = ex.state.cards[entry.returnCard];
        if (card?.zone === 'stable')
            moveCard(moveCtxOf(ex), entry.returnCard, { zone: 'stable', owner: entry.returnOwner }, 'return');
    }
    ex.state.lingering = ex.state.lingering.filter(entry =>
        entry.until === 'endOfTurn' || zoneOf(ex.state, entry.source) === 'stable');
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
            startEffect(ex, pending.effect, pending.player, pending.source, pending.event);
            continue;
        }

        links.targeted = [];
        endOfLink(ex);
        collectEvents(ex, links.targeted);
        if (ex.state.exec.length) continue;
        if (!links.next.length) {
            for (const iid of [...ex.state.limbo]) {
                const kind = ex.defOf(iid)?.kind;
                if (kind === 'magic' || kind === 'instant')
                    moveCard(moveCtxOf(ex), iid, 'discard', 'discard');
            }
            collectEvents(ex, links.targeted);
            if (!links.next.length) return 'done';
        }

        links.current = orderPendings(ex.state, links.next);
        links.next = [];
    }

    throw new Error('Chain did not settle');
}
