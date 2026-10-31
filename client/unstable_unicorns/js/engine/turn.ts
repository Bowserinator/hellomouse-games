import type { CardEvent } from './dsl/ast.js';
import type { Iid } from './ids.js';
import type { GameState, Phase } from './state.js';
import { resolveLinks } from './chain.js';
import { moveCard } from './move.js';
import { actionsPerTurn, drawsPerTurn, handLimit } from './query/modifiers.js';
import { commitChain } from './play.js';
import type { Result, Table } from './play.js';
import { moveCtxOf, worldOf } from './exec/context.js';
import { startEffect } from './exec/interpreter.js';
import { drawCards } from './exec/primitives.js';

const OK: Result = {};

function isOver(state: GameState): boolean {
    const phase: Phase = state.phase;
    return phase === 'OVER';
}

function fail(error: string): Result {
    return { error };
}

export function raise(table: Table, event: CardEvent) {
    table.ex.log.emit(event);
    return resolveLinks(table.ex);
}

function runLingering(table: Table, until: 'endOfTurn') {
    const state = table.state;
    const due = state.lingering.filter(entry => entry.until === until);
    for (const entry of due) {
        state.lingering = state.lingering.filter(pending => pending !== entry);
        if (entry.returnCard !== undefined && entry.returnOwner !== undefined) {
            const card = state.cards[entry.returnCard];
            if (card?.zone === 'stable' && card.owner === entry.player)
                moveCard(moveCtxOf(table.ex), entry.returnCard, { zone: 'stable', owner: entry.returnOwner }, 'return');
        } else
            startEffect(table.ex, entry.effect, entry.player, entry.source);
        resolveLinks(table.ex);
        if (state.phase === 'OVER' || state.prompt !== null) return;
    }
}

export function advanceTurn(table: Table) {
    const state = table.state;
    const current = state.turn.player;
    let next = current;
    if (state.turn.extraTurns > 0) state.turn.extraTurns--;
    else {
        state.turn.extraTurns = 0;
        for (let step = 1; step <= state.players.length; step++) {
            const candidate = (current + step) % state.players.length;
            if (state.players[candidate]) {
                next = candidate;
                break;
            }
        }
    }
    state.turn = {
        player: next,
        actionsUsed: 0,
        drawsUsed: 0,
        bonusPlays: 0,
        extraTurns: state.turn.extraTurns,
        endNow: false
    };
    state.phase = 'AWAIT_BEGIN';
}

export function beginTurn(table: Table, player: number): Result {
    const state = table.state;
    if (state.phase !== 'AWAIT_BEGIN') return fail('The turn cannot start now');
    if (state.turn.player !== player) return fail('It is not your turn');
    if (table.stack.size > 0 || state.pendingWinner !== null) commitChain(table);
    if (isOver(state)) return OK;

    state.phase = 'TURN_START';
    state.turn.actionsUsed = 0;
    state.turn.drawsUsed = 0;
    state.turn.bonusPlays = state.players[player].stable.some(iid => table.ex.defOf(iid)?.id === 'double-dutch') ? 1 : 0;
    raise(table, { type: 'turnStart', player });
    if (state.phase !== 'TURN_START') return OK;

    return finishBeginTurn(table);
}

export function finishBeginTurn(table: Table): Result {
    const state = table.state;
    if (state.phase !== 'TURN_START' || state.prompt !== null) return OK;
    if (state.turn.endNow) {
        state.phase = 'ACTION';
        return endTurn(table, state.turn.player);
    }
    if (state.deck.length === 0 && state.discard.length === 0) {
        table.ex.deckOut?.();
        return OK;
    }
    drawCards(table.ex, state.turn.player, drawsPerTurn(worldOf(table.ex), state.turn.player));
    if (state.phase === 'TURN_START' && state.prompt === null) state.phase = 'ACTION';
    return OK;
}

export function actionsLeft(table: Table, player: number): number {
    const turn = table.state.turn;
    if (turn.player !== player || turn.drawsUsed > 0) return 0;
    return Math.max(0, actionsPerTurn(worldOf(table.ex), player) + turn.bonusPlays - turn.actionsUsed);
}

export function drawsLeft(table: Table, player: number): number {
    const turn = table.state.turn;
    return turn.player === player && turn.actionsUsed === 0 && turn.drawsUsed === 0 ? 1 : 0;
}

export function afterAction(table: Table) {
    if (table.state.prompt !== null) return;
    if (table.state.turn.endNow && table.state.phase === 'ACTION') endTurn(table, table.state.turn.player);
}

export function drawAction(table: Table, player: number): Result {
    const state = table.state;
    if (state.phase !== 'ACTION') return fail('You cannot draw now');
    if (state.turn.player !== player) return fail('It is not your turn');
    if (state.pendingWinner !== null) return fail('Let the current play resolve first');
    if (drawsLeft(table, player) <= 0) return fail('You have no draws left');
    if (state.deck.length === 0 && state.discard.length === 0)
        return fail('There are no cards left to draw');
    commitChain(table);
    if (isOver(state)) return fail('The game is over');
    state.turn.actionsUsed++;
    state.turn.drawsUsed++;
    drawCards(table.ex, player, 1);
    resolveLinks(table.ex);
    afterAction(table);
    return OK;
}

export function endTurn(table: Table, player: number): Result {
    const state = table.state;
    if (state.phase !== 'ACTION') return fail('You cannot end the turn now');
    if (state.turn.player !== player) return fail('It is not your turn');

    state.phase = 'TURN_END';
    raise(table, { type: 'turnEnd', player });
    return finishEndTurn(table);
}

export function finishEndTurn(table: Table): Result {
    const state = table.state;
    if (state.phase !== 'TURN_END' || state.prompt !== null) return OK;
    runLingering(table, 'endOfTurn');
    if (isOver(state) || state.prompt !== null) return OK;

    const player = state.turn.player;
    if (state.players[player].hand.length > handLimit(worldOf(table.ex), player)) {
        state.phase = 'DISCARD_LIMIT';
        return OK;
    }

    advanceTurn(table);
    return OK;
}

export function discardCards(table: Table, player: number, iids: Array<Iid>): Result {
    const state = table.state;
    if (state.phase !== 'DISCARD_LIMIT') return fail('You do not have to discard now');
    if (state.turn.player !== player) return fail('It is not your turn');
    const hand = state.players[player].hand;
    if (iids.length === 0) return fail('Pick at least one card');
    if (new Set(iids).size !== iids.length) return fail('Duplicate cards');
    for (const iid of iids) if (!hand.includes(iid)) return fail('That card is not in your hand');
    const limit = handLimit(worldOf(table.ex), player);
    if (hand.length - iids.length < limit) return fail('You are discarding too many cards');

    const ctx = moveCtxOf(table.ex);
    for (const iid of iids) moveCard(ctx, iid, 'discard', 'discard');
    resolveLinks(table.ex);
    if (state.players[player].hand.length <= limit) advanceTurn(table);
    return OK;
}
