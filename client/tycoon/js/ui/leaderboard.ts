import { TITLE_LABELS } from '../cards.js';
import type { Sync, View } from '../types.js';
import { label } from './card-element.js';

export function leaderboard(target: HTMLElement, sync: Sync, view: View): void {
    target.replaceChildren();
    const heading = document.createElement('h2'); heading.textContent = `ROUND ${view.round} / ${view.totalRounds}`;
    const info = document.createElement('p');
    info.textContent = `${view.options.jokers ? 'Jokers ON' : 'Jokers OFF'} · ${view.revolution ? '革命 REVOLUTION — values inverted' : 'Normal order'}`;
    target.append(heading, info);
    for (const seat of [0, 1, 2, 3].sort((a, b) => view.scores[b] - view.scores[a] || a - b)) {
        const row = document.createElement('div'); row.className = 'leader-row';
        row.classList.toggle('active', view.turn === seat && view.phase === 'play');
        const title = view.titles[seat];
        row.append(title ? label(TITLE_LABELS[title].jp, TITLE_LABELS[title].en) : document.createElement('span'));
        const player = document.createElement('span'); player.className = 'leader-name';
        player.textContent = `${sync.seats[seat].username}${seat === view.youAre ? ' (you)' : ''}${sync.seats[seat].ai ? ' · AI' : ''}${!sync.seats[seat].connected ? ' · Offline' : ''}`;
        const divider = document.createElement('span'); divider.textContent = ' · '; divider.setAttribute('aria-hidden', 'true');
        const score = document.createElement('strong'); score.textContent = String(view.scores[seat]);
        score.title = 'Total points'; score.setAttribute('aria-label', `${view.scores[seat]} total points`);
        if (['roundEnd', 'gameEnd'].includes(view.phase)) {
            const gain = document.createElement('small'); gain.className = 'score-gain';
            gain.textContent = `+${3 - view.out.indexOf(seat)}`; score.append(gain);
        }
        const count = document.createElement('span'); count.className = 'leader-count'; count.title = 'Cards left';
        const remaining = document.createElement('span'); remaining.dataset.count = `hand-${seat}`;
        remaining.textContent = String(view.counts[seat]); count.append(remaining, ' cards');
        const status = document.createElement('small');
        status.textContent = view.bankrupt === seat ? 'BANKRUPT 都落ち' : view.out.includes(seat)
            ? `OUT (${view.out.indexOf(seat) + 1})` : view.passed.includes(seat) ? 'PASSED'
                : view.turn === seat && view.phase === 'play' ? (view.table ? 'TURN' : 'LEAD') : '';
        row.append(player, divider, score, count, status); target.append(row);
    }
}
export function setName(view: View): string {
    if (!view.table) return 'Empty table';
    const n = view.table.count, rank = view.table.rank;
    const value = rank === 0 ? 'jokers' : rank === 1 ? 'As' : rank === 11 ? 'Js'
        : rank === 12 ? 'Qs' : rank === 13 ? 'Ks' : `${rank}s`;
    return `${['', 'Single', 'Pair', 'Triple', 'Quad'][n]} of ${value}`;
}
