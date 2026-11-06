import { moneyCard } from './card-element.js';
import type { Sync, Result } from '../types.js';

export function scoreboard(sync: Sync, result: Result): Array<HTMLElement> {
    const order = result.scores.map((_, i) => i).sort((a, b) => {
        const x = result.scores[a], y = result.scores[b];
        return Number(x.castOut) - Number(y.castOut) || y.score - x.score || y.money - x.money ||
            y.bestLuxury - x.bestLuxury || a - b;
    });
    return order.map(i => {
        const score = result.scores[i];
        const row = document.createElement('section');
        row.className = `result-row${score.castOut ? ' result-row--out' : ''}${
            result.winners.includes(i) ? ' result-row--win' : ''}`;
        const title = document.createElement('h3');
        title.textContent = `${sync.seats[i].username} · ${score.score} status · ${score.money}K${score.castOut ? ' · CAST OUT'
            : result.winners.includes(i) ? ' · WINNER' : ''}`;
        const hand = document.createElement('div'); hand.className = 'result-row__hand';
        hand.append(...result.hands[i].map(card => moneyCard(card, i)));
        const breakdown = document.createElement('p');
        breakdown.textContent = `(${score.luxury} luxury − ${score.penalty}) × ${score.multiplier} ÷ ${
            score.divisor} = ${score.score} status`;
        row.append(title, hand, breakdown);
        return row;
    });
}
