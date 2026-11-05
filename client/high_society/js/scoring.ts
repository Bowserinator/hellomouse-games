import type { StatusCard, MoneyCard, Score, Result } from './types.js';

export function score(cards: Array<StatusCard>): Omit<Score, 'money' | 'castOut'> {
    const luxury = cards.filter(c => c.kind === 'luxury').reduce((sum, c) => sum + c.value, 0);
    const penalty = cards.some(c => c.kind === 'passe') ? 5 : 0;
    const multiplier = 2 ** cards.filter(c => c.kind === 'prestige').length;
    const divisor = cards.some(c => c.kind === 'scandale') ? 2 : 1;
    return { luxury, penalty, multiplier, divisor, score: Math.trunc((luxury - penalty) * multiplier / divisor),
        bestLuxury: Math.max(0, ...cards.filter(c => c.kind === 'luxury').map(c => c.value)) };
}
export function results(status: Array<Array<StatusCard>>, hands: Array<Array<MoneyCard>>): Result {
    const money = hands.map(hand => hand.reduce((sum, c) => sum + c.value, 0));
    const least = Math.min(...money);
    const allTied = money.every(value => value === least);
    const scores = status.map((cards, i) => ({ ...score(cards), money: money[i],
        castOut: !allTied && money[i] === least }));
    let winners = scores.map((_, i) => i).filter(i => !scores[i].castOut);
    for (const key of ['score', 'money', 'bestLuxury'] as const) {
        const best = Math.max(...winners.map(i => scores[i][key]));
        winners = winners.filter(i => scores[i][key] === best);
    }
    return { scores, winners, hands: hands.map(hand => hand.map(c => ({ ...c }))),
        tiebreak: 'Status → remaining money → highest luxury. A remaining tie is a shared win.' };
}
