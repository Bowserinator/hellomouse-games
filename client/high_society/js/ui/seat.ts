import { moneyCard, statusCard } from './card-element.js';
import type { PlayerView, SeatInfo, StatusCard, MoneyCard } from '../types.js';

export function seatElement(player: PlayerView, info: SeatInfo, index: number, active: boolean,
    mine: boolean, rotationDeg: number,
    preview: (node: HTMLElement, card: StatusCard | MoneyCard, seat: number) => void,
    over = false): HTMLElement {
    const node = document.createElement('section');
    node.className = `seat${active ? ' seat--active' : ''}${player.passed ? ' seat--passed' : ''}`;
    node.dataset.seat = String(index);
    node.style.setProperty('--seat-angle', `${rotationDeg}deg`);
    const labels = document.createElement('div');
    labels.className = 'seat-labels';
    const angle = (rotationDeg % 360 + 360) % 360;
    labels.classList.toggle('flip', angle > 90 && angle < 270);
    const title = document.createElement('h3');
    title.textContent = `${info.username}${mine ? ' (you)' : ''}${info.ai ? ' · CPU' : ''}`;
    const count = document.createElement('p');
    count.textContent = `Bid ${player.tableTotal}K · ${player.handCount} money cards${info.connected ? '' : ' · Offline'}${
        player.passed ? ' · Passed' : ''}`;
    labels.append(title);
    if (!over) labels.append(count);
    if (player.pendingFauxPas) {
        const badge = document.createElement('p');
        badge.className = 'warning';
        badge.textContent = 'Faux Pas · Discard your next luxury';
        labels.append(badge);
    }
    const bid = document.createElement('div');
    bid.className = 'seat__bid'; bid.dataset.zone = `bid-${index}`;
    for (const card of player.table) {
        const face = moneyCard(card, index); face.tabIndex = 0;
        preview(face, card, index); bid.append(face);
    }
    const collection = document.createElement('div');
    collection.className = 'seat__collection'; collection.dataset.zone = `status-${index}`;
    for (const card of player.status) {
        const face = statusCard(card); face.tabIndex = 0;
        preview(face, card, index); collection.append(face);
    }
    node.append(bid, labels, collection);
    if (!mine) {
        const backs = document.createElement('div');
        backs.className = 'seat__backs'; backs.dataset.zone = `hand-${index}`;
        backs.setAttribute('aria-hidden', 'true');
        for (let i = 0; i < Math.min(5, player.handCount); i++) {
            const back = document.createElement('img');
            back.src = 'img/card-back.png'; back.alt = '';
            backs.append(back);
        }
        node.append(backs);
    }
    return node;
}
