import { score } from './scoring.js';
import type { View, Move } from './types.js';

export function decide(view: View): Move {
    const player = view.players[view.turn];
    if (view.phase === 'fauxPas') {
        const luxury = player.status.filter(c => c.kind === 'luxury').sort((a, b) => a.value - b.value)[0];
        return { action: 'CHOOSE_DISCARD', id: luxury.id };
    }
    if (!view.legal.canBid) return { action: 'PASS' };
    const current = view.current!;
    const standing = score(player.status);
    const value = current.kind === 'luxury' ? (player.pendingFauxPas ? 0 : current.value)
        : current.kind === 'prestige' ? Math.max(3, standing.score) : 0;
    const penalty = current.kind === 'faux-pas' ? Math.min(8, standing.bestLuxury || 4)
        : current.kind === 'passe' ? 5 * standing.multiplier : Math.max(3, standing.score / 2);
    const money = view.myHand.reduce((sum, c) => sum + c.value, 0);
    const reserve = Math.max(10, 25 - view.endCardsRevealed * 4);
    const budget = Math.min(Math.max(0, money - reserve),
        Math.max(0, (view.phase === 'disgrace' ? penalty * 1.6 : value * 1.7) - player.tableTotal));
    let best: Array<number> = [];
    let cost = Infinity;
    for (let mask = 1; mask < 2 ** view.myHand.length; mask++) {
        const cards = view.myHand.filter((_, i) => (mask & (1 << i)) !== 0);
        const total = cards.reduce((sum, c) => sum + c.value, 0);
        if (total + player.tableTotal > view.highest && total < cost && total <= budget) {
            cost = total;
            best = cards.map(c => c.id);
        }
    }
    return best.length ? { action: 'BID', cards: best } : { action: 'PASS' };
}
