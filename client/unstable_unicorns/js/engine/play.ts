import type { CardDef } from './dsl/ast.js';
import type { Iid } from './ids.js';
import type { GameState } from './state.js';
import type { PlayStack } from './stack.js';
import { resolveLinks } from './chain.js';
import { holds } from './dsl/cond.js';
import { bulkMove, moveCard } from './move.js';
import { condCtx } from './query/active.js';
import { blocksOtherPlay, blocksPlay, protectedFrom } from './query/modifiers.js';
import { restoreInto, snapshot } from './snapshot.js';
import { moveCtxOf, worldOf, type ExecCtx } from './exec/context.js';
import { startEffect } from './exec/interpreter.js';
import { actionsLeft } from './turn.js';

export interface Table {
    state: GameState;
    stack: PlayStack;
    ex: ExecCtx;
}

export interface Result {
    error?: string;
}

const OK: Result = {};

function fail(error: string): Result {
    return { error };
}

function handCard(table: Table, player: number, iid: Iid): CardDef | string {
    const card = table.state.cards[iid];
    const def = table.ex.defOf(iid);
    if (!card || !def) return 'Unknown card';
    if (card.zone !== 'hand' || card.owner !== player) return 'That card is not in your hand';
    return def;
}

function spentAction(table: Table, player: number, iid: Iid, def: CardDef): Result {
    const world = worldOf(table.ex);
    if (def.instant) return fail('That card can only be played in response');
    if (blocksPlay(world, player, def.kind)) return fail('You cannot play that kind of card now');
    if (!holds(def.playIf, condCtx(world, player, iid))) return fail('That card cannot be played now');
    return OK;
}

function applyCard(table: Table, player: number, iid: Iid, def: CardDef, stable: number) {
    const ex = table.ex;
    if (def.kind === 'magic' || def.kind === 'instant') {
        bulkMove(table.state, [iid], 'limbo', undefined, ex.log);
        ex.log.record({ type: 'play', card: iid, player, publicDefId: def.id });
    } else moveCard(moveCtxOf(ex), iid, { zone: 'stable', owner: stable }, 'play');
    if (def.onPlay?.id) startEffect(ex, def.onPlay.id, player, iid);
    resolveLinks(ex);
}

export function commitChain(table: Table) {
    const state = table.state;
    if (state.pendingWinner !== null) {
        state.winner = state.pendingWinner;
        state.winReason = 'unicorns';
        state.pendingWinner = null;
        state.phase = 'OVER';
    }
    table.stack.clear();
}

function targetStable(
    table: Table, player: number, iid: Iid, def: CardDef, target: number | undefined
): number | Result {
    if (def.kind === 'magic' || def.kind === 'instant') return player;
    const seat = def.kind === 'baby' || def.kind === 'basic' || target === undefined ? player : target;
    if (!table.state.players[seat]) return fail('That card needs a target stable');
    if (def.playTarget === 'self' && seat !== player) return fail('That card must go into your own stable');
    if (def.playTarget === 'other' && seat === player) return fail('That card must go into another stable');
    if (blocksOtherPlay(worldOf(table.ex), seat, player, def.kind, iid)) return fail('That card cannot enter that stable');
    return seat;
}

export function playCard(table: Table, player: number, iid: Iid, target?: number): Result {
    const state = table.state;
    const found = handCard(table, player, iid);
    if (typeof found === 'string') return fail(found);
    if (state.phase !== 'ACTION') return fail('You cannot play a card now');
    if (state.turn.player !== player) return fail('It is not your turn');
    const invalid = spentAction(table, player, iid, found);
    if (invalid.error) return invalid;
    if (actionsLeft(table, player) <= 0) return fail('You have no actions left');
    const stable = targetStable(table, player, iid, found, target);
    if (typeof stable !== 'number') return stable;

    commitChain(table);
    if (state.winner !== null) return fail('The game is over');

    table.stack.push({
        card: iid,
        by: player,
        kind: 'play',
        actionCost: 1,
        immune: !!found.unneighable || protectedFrom(worldOf(table.ex), iid, 'neigh'),
        before: snapshot(state)
    });
    state.turn.actionsUsed++;
    applyCard(table, player, iid, found, stable);
    return OK;
}

export function neigh(table: Table, player: number, iid: Iid, targetEntryId: number): Result {
    const state = table.state;
    const top = table.stack.top();
    if (state.phase === 'OVER') return fail('The game is over');
    if (!top) return fail('There is nothing to neigh');
    if (top.id !== targetEntryId) return fail('That play is no longer the latest');
    if (top.immune) return fail('That card cannot be neighed');
    if (top.by === player) return fail('You cannot neigh your own card');

    const found = handCard(table, player, iid);
    if (typeof found === 'string') return fail(found);
    if (!found.instant?.neigh) return fail('That card cannot neigh');
    if (blocksPlay(worldOf(table.ex), player, found.kind)) return fail('You cannot play instants now');

    table.stack.push({
        card: iid,
        by: player,
        kind: 'neigh',
        actionCost: 0,
        immune: !!found.unneighable || !!found.instant.superNeigh,
        before: snapshot(state)
    });

    const seen = new Map<Iid, Array<number>>();
    for (const [cardIid, card] of Object.entries(state.cards))
        if (card.revealedTo.length > 0) seen.set(cardIid, [...card.revealedTo]);

    restoreInto(state, top.before);

    for (const [seenIid, seats] of seen) {
        const card = state.cards[seenIid];
        if (!card) continue;
        for (const seat of seats) if (!card.revealedTo.includes(seat)) card.revealedTo.push(seat);
    }

    state.turn.actionsUsed += top.actionCost;
    const ctx = moveCtxOf(table.ex);
    moveCard(ctx, top.card, 'discard', 'discard');
    moveCard(ctx, iid, 'discard', 'discard');
    table.ex.log.emit({ type: 'neigh', card: iid, player, targetCard: top.card, targetPlayer: top.by,
        superNeigh: !!found.instant.superNeigh });
    resolveLinks(table.ex);
    return OK;
}
