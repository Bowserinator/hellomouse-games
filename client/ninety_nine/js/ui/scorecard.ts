import type { Sync, View } from '../types.js';
import { chips } from './chips.js';
export function scorecard(sync: Sync, view: View): HTMLElement {
    const section = document.createElement('div');
    const heading = document.createElement('h2');
    heading.textContent = `HAND ${view.handNumber} · ${view.variant.name}`;
    const total = document.createElement('p');
    total.textContent = `Total ${view.total} ${view.direction === 1 ? '↻ Clockwise' : '↺ Counter-clockwise'}`;
    total.className = view.total >= 95 ? 'danger' : view.total >= 80 ? 'warm' : '';
    const table = document.createElement('table');
    const header = table.createTHead().insertRow();
    for (const text of ['Player', 'Tokens', 'Cards', 'Status']) {
        const th = document.createElement('th'); th.scope = 'col'; th.textContent = text; header.append(th);
    }
    const body = table.createTBody();
    const seats = view.players.map((player, seat) => ({ ...player, seat }));
    seats.sort((a, b) => Number(a.eliminated) - Number(b.eliminated) || b.tokens - a.tokens || a.seat - b.seat);
    for (const player of seats) {
        const i = player.seat;
        const row = body.insertRow();
        row.className = player.eliminated ? 'out' : i === view.turn ? 'active' : '';
        row.dataset.scoreSeat = String(i);
        row.insertCell().textContent = `${sync.seats[i].username}${i === sync.youAre ? ' (you)' : ''}${sync.seats[i].ai ? ' · AI' : !sync.seats[i].connected ? ' · offline' : ''}`;
        row.insertCell().append(chips(player.tokens));
        const count = row.insertCell(); count.textContent = String(player.count); count.dataset.count = String(i);
        row.insertCell().textContent = [player.eliminated ? 'OUT' : i === view.turn ? 'TURN' : '',
            i === view.dealer ? 'DEALER' : '', view.skipped.includes(i) ? 'SKIPPED' : '',
            view.lastPlay?.seat === i ? `LAST: ${view.lastPlay.card.rank}` : ''].filter(Boolean).join(' · ');
    }
    section.append(heading, total, table);
    return section;
}
