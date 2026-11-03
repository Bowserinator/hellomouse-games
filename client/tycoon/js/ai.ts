import { legalPlays } from './engine.js';
import { strength } from './cards.js';
import type { CardView, Move, View } from './types.js';

export function decide(view: View, rng: () => number = Math.random): Move {
    const seat = view.youAre, hand = view.hands[seat] ?? [];
    const groupSize = (c: CardView): number => hand.filter(other => !other.joker && other.value === c.value).length;
    if (view.exchange) {
        const ordered = [...hand].sort((a, b) => {
            const cost = (c: CardView): number => strength(c) + (groupSize(c) > 1 ? 20 : 0) +
                (c.joker || (c.value === 2 && c.suit === 'Spades') ? 100 : 0);
            return cost(a) - cost(b);
        });
        return { action: 'EXCHANGE', iids: ordered.slice(0, view.exchange.count).map(c => c.iid) };
    }
    if (view.phase === 'roundEnd') return { action: 'CONTINUE' };
    const plays = legalPlays(view, seat);
    const finish = plays.find(ids => ids.length === hand.length);
    if (finish) return { action: 'PLAY', iids: finish };
    if (!plays.length) return { action: 'PASS' };
    const ordered = plays.map(ids => {
        const cards = hand.filter(c => ids.includes(c.iid));
        const natural = cards.find(c => !c.joker);
        const rank = natural ? strength(natural) : 13;
        const remaining = hand.filter(c => !ids.includes(c.iid));
        const average = remaining.reduce((sum, c) => sum + strength(c), 0) / Math.max(1, remaining.length);
        const invertedRank = natural && view.revolution ? 12 - rank : rank;
        const breaking = natural && groupSize(natural) > cards.filter(c => !c.joker).length;
        const premium = cards.some(c => c.joker || c.value === 1 || c.value === 2) ||
            !!(breaking && natural && groupSize(natural) === 4);
        let cost = invertedRank + cards.filter(c => c.joker).length * 18 + (breaking ? 16 : 0);
        if (!view.table) cost -= (ids.length - 1) * 2;
        const goodRevolution = view.revolution ? average > 6 : average < 6 || ['poor', 'beggar'].includes(view.titles[seat] ?? '');
        if (ids.length === 4) cost += goodRevolution ? -30 : 35;
        if (natural?.value === 8 && average > 4 && average < 9) cost -= 4;
        if (view.titles[seat] === 'tycoon') cost -= ids.length * 3;
        return { ids, cost, premium, tie: rng() };
    }).sort((a, b) => a.cost - b.cost || a.tie - b.tie);
    const best = ordered[0];
    const imminent = view.counts.some((n, i) => i !== seat && n > 0 && n <= 2);
    const cleanLead = hand.some(c => !c.joker && groupSize(c) === 1 && strength(c) >= 8);
    if (view.table && !imminent && best.premium && cleanLead && view.titles[seat] !== 'tycoon')
        return { action: 'PASS' };
    return { action: 'PLAY', iids: best.ids };
}
