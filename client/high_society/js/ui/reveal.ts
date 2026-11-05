import type { Sync, Result } from '../types.js';
import { moneyCard } from './card-element.js';

export async function reveal(sync: Sync, result: Result, motion = true): Promise<void> {
    const reduced = !motion || matchMedia('(prefers-reduced-motion: reduce)').matches;
    for (let i = 0; i < result.hands.length; i++) {
        const seat = document.querySelector<HTMLElement>(`[data-seat="${i}"]`);
        if (!seat) continue;
        const hand = document.createElement('div'); hand.className = 'revealed-hand';
        hand.append(...result.hands[i].map(card => moneyCard(card, i)));
        const text = document.createElement('p');
        text.textContent = `${sync.seats[i].username} reveals ${result.scores[i].money}K`;
        seat.querySelector('.seat-labels')?.append(text);
        seat.append(hand);
        if (!reduced) await hand.animate([{ opacity: 0, transform: 'rotateY(90deg)' },
            { opacity: 1, transform: 'rotateY(0)' }], { duration: 550 }).finished.catch(() => {});
    }
    for (let i = 0; i < result.scores.length; i++) {
        const seat = document.querySelector<HTMLElement>(`[data-seat="${i}"]`);
        const score = result.scores[i];
        seat?.classList.toggle('seat--out', score.castOut);
        const text = document.createElement('p');
        seat?.querySelector('.seat-labels')?.append(text);
        if (seat && !reduced)
            for (const stage of [`Luxury: ${score.luxury}`, `Passé −${score.penalty}: ${score.luxury - score.penalty}`,
                `Prestige ×${score.multiplier}: ${(score.luxury - score.penalty) * score.multiplier}`,
                `Scandale ÷${score.divisor}: ${score.score}`]) {
                text.textContent = stage;
                await text.animate([{ opacity: .3 }, { opacity: 1 }], { duration: 300 }).finished.catch(() => {});
            }
        text.textContent = `${score.castOut ? 'Cast out · Least money · ' : ''}Status: (${score.luxury} − ${
            score.penalty}) × ${score.multiplier} ÷ ${score.divisor} = ${score.score}`;
    }
}
