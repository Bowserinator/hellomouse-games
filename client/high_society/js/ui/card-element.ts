import { COLORS } from '../rules.js';
import type { StatusCard, MoneyCard } from '../types.js';

export function statusCard(card: StatusCard): HTMLElement {
    const node = document.createElement('figure');
    node.className = `status-card${card.end ? ' status-card--end' : ''}`;
    node.dataset.card = card.id;
    const image = document.createElement('img');
    image.src = `img/status/${card.id}.png`;
    image.alt = '';
    const caption = document.createElement('figcaption');
    caption.textContent = card.label;
    node.append(image, caption);
    return node;
}
export function moneyCard(card: MoneyCard, seat: number): HTMLElement {
    const node = document.createElement('span');
    node.className = 'money-card';
    node.dataset.money = String(card.id);
    const image = document.createElement('img');
    image.src = `img/money/${COLORS[seat] ?? COLORS[0]}-${String(card.value).padStart(2, '0')}.png`;
    image.alt = '';
    const label = document.createElement('strong');
    label.textContent = `${card.value}K`;
    node.append(image, label);
    return node;
}
