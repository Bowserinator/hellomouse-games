import type { EventLog } from './events.js';
import type { Iid } from './ids.js';
import type { GameState, WinReason } from './state.js';
import type { World } from './query/modifiers.js';
import { isUnicorn, unicornCount } from './query/modifiers.js';

export function letterScore(world: World, stable: Array<Iid>, nameOf: (defId: string) => string): number {
    let total = 0;
    for (const iid of stable) {
        if (!isUnicorn(world, iid)) continue;
        total += nameOf(world.defOf(iid)?.id ?? '').replace(/[^a-z]/gi, '').length;
    }
    return total;
}

export function deckOutWinner(
    world: World,
    nameOf: (defId: string) => string
): { winner: number | null; reason: WinReason } {
    const state = world.state;
    if (state.pendingWinner !== null) return { winner: state.pendingWinner, reason: 'unicorns' };
    const counts = state.players.map(player => unicornCount(world, player.id));
    const best = Math.max(...counts);
    const tied = state.players.filter(player => counts[player.id] === best);
    if (tied.length === 1) return { winner: tied[0].id, reason: 'most' };
    const letters = tied.map(player => letterScore(world, player.stable, nameOf));
    const bestLetters = Math.max(...letters);
    const letterWinners = tied.filter((_player, index) => letters[index] === bestLetters);
    if (letterWinners.length === 1) return { winner: letterWinners[0].id, reason: 'letters' };
    return { winner: null, reason: 'allLose' };
}

export function endByDeckOut(
    state: GameState,
    world: World,
    nameOf: (defId: string) => string,
    log: EventLog
): void {
    if (state.phase === 'OVER') return;
    const { winner, reason } = deckOutWinner(world, nameOf);
    state.winner = winner;
    state.winReason = reason;
    state.pendingWinner = null;
    state.phase = 'OVER';
    state.exec = [];
    state.links = { current: [], next: [], targeted: [] };
    state.prompt = null;
    state.lingering = [];
    log.emit({ type: 'deckOut', player: winner ?? undefined });
}
