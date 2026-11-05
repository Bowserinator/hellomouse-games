import { moneyCard } from './card-element.js';
import type { Sync, Result } from '../types.js';

export function scoreboard(sync: Sync, result: Result): Array<HTMLElement> {
    return result.scores.map((score, i) => {
        const row = document.createElement('section');
        row.className = `result-row${score.castOut ? ' result-row--out' : ''}`;
        const title = document.createElement('h3');
        title.textContent = `${sync.seats[i].username} · ${score.money}K${score.castOut ? ' · CAST OUT'
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
