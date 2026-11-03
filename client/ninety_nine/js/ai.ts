import { RANKS, SUITS, resolveCard } from './variants/schema.js';
import type { ResolvedDef } from './variants/schema.js';
import type { View, Move, CardView } from './types.js';

export function decide(view: View, rng: () => number = Math.random): Move {
    if (view.phase === 'bust') return { action: 'CONTINUE' };
    const mine = view.players[view.turn];
    const resolved = (card: CardView): ResolvedDef => card.def!.value.type === 'copy'
        ? view.lastPlay?.def ?? { ...card.def!, value: { type: 'add', n: 0 }, effects: [] } : card.def!;
    const safety = (def: ResolvedDef): number => {
        const v = def.value;
        if (v.type === 'set') return 3;
        if (v.type === 'add') return v.n <= 0 ? 3 : 0;
        if (v.type === 'choice') return Math.min(...v.options) <= 0 ? 3 : 0;
        return 1;
    };
    const unseen = RANKS.filter(rank => rank !== 'JOKER' || view.variant.rules.jokers > 0)
        .flatMap(rank => SUITS.flatMap(suit => {
            const known = [...mine.hand, ...view.discard]
                .filter(card => card.rank === rank && card.suit === suit).length;
            return Array.from({ length: Math.max(0, (view.options.seats > 6 ? 2 : 1) - known) }, () =>
                resolveCard(view.variant, { rank, suit }));
        }));
    const bustChance = (seat: number, total: number): number => {
        let busts = 0;
        for (let sample = 0; sample < 24; sample++) {
            let canPlay = false;
            for (let i = 0; i < view.players[seat].count; i++) {
                const v = unseen[Math.floor(rng() * unseen.length)]?.value;
                if (!v || v.type === 'copy' || v.type === 'set' ||
                    (v.type === 'add' ? total + v.n <= 99 : v.options.some(n => total + n <= 99))) canPlay = true;
            }
            if (!canPlay) busts++;
        }
        return busts / 24;
    };
    if (view.prompt) {
        const target = [...view.prompt.options].sort((a, b) => {
            if (view.prompt?.kind === 'steal') return view.players[b].count - view.players[a].count;
            return bustChance(b, view.total) - bustChance(a, view.total);
        })[0];
        return { action: 'CHOOSE', promptId: view.prompt.id, value: target };
    }
    const safetyCount = mine.hand.reduce((sum, card) => sum + (safety(resolved(card)) > 0 ? 1 : 0), 0);
    const candidates = view.legal.map(play => {
        const def = resolved(mine.hand.find(card => card.iid === play.iid)!);
        const v = def.value;
        const delta = v.type === 'add' ? v.n : v.type === 'choice' ? play.choice! : 0;
        const total = v.type === 'set' ? v.total : Math.max(view.variant.rules.floor, view.total + delta);
        let score = (safetyCount - (safety(def) > 0 ? 1 : 0)) * (view.total >= 75 ? 22 : 10);
        score += view.total >= 85 ? -total * .25 : Math.max(0, delta);
        if (v.type === 'set') score += safetyCount >= 3 ? 35 : -20;
        let direction = view.direction;
        let steps = 1;
        for (const effect of def.effects ?? []) {
            if (effect.type === 'reverse') direction = direction === 1 ? -1 : 1;
            if (effect.type === 'skip') steps += effect.count ?? 1;
        }
        let next = view.turn;
        for (let i = 0; i < steps; i++)
            do next = (next + direction + view.players.length) % view.players.length;
            while (view.players[next].eliminated);
        if (view.total >= 80) score += bustChance(next, total) * 18;
        return { move: { action: 'PLAY', ...play } as Move, score: score + rng() };
    });
    for (const iids of view.combinations)
        candidates.push({ move: { action: 'COMBINE', iids }, score: 25 + rng() });
    return candidates.sort((a, b) => b.score - a.score)[0]?.move ?? { action: 'CONTINUE' };
}
