import { cardEntry, cardName, cardSlot } from './card.js';
import type { SeatPlacement } from './polygon.js';
import type { ViewModel } from '../engine/view.js';

export interface SeatInfo {
    view: ViewModel;
    names: Array<string | null>;
    connected: Array<boolean>;
    selectedTarget: number | null;
    targetable?: Array<number> | null;
    radius: number;
    cardW: number;
}

function element(tag: string, className: string, text?: string): HTMLElement {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function initials(name: string | null, seat: number): string {
    const trimmed = (name ?? '').trim();
    return trimmed ? trimmed.slice(0, 1).toUpperCase() : String(seat + 1);
}

function stable(info: SeatInfo, seat: number): HTMLElement {
    const { view } = info;
    const list = element('div', 'seat-stable');
    const cards = view.players[seat].stable;
    const count = Math.max(view.players.length, 1);
    const chord = 2 * info.radius * Math.sin(Math.PI / count);
    const maxWidth = Math.min(info.cardW * 3, chord - info.cardW * 0.5);
    const step = cards.length > 1
        ? Math.max(0.08, Math.min(1, (maxWidth - info.cardW) / ((cards.length - 1) * info.cardW)))
        : 1;
    cards.forEach((iid, index) => {
        const defId = view.cards[iid]?.defId;
        if (!defId) return;
        const slot = cardSlot(iid, defId);
        slot.style.setProperty('--i', String(index));
        slot.style.setProperty('--step', String(step));
        slot.classList.add('seat-card');
        list.append(slot);
    });
    return list;
}

function fan(info: SeatInfo, seat: number): HTMLElement {
    const holder = element('div', 'seat-hand');
    const count = info.view.players[seat].handCount;
    const backW = info.cardW * 0.6;
    const chord = 2 * info.radius * Math.sin(Math.PI / Math.max(info.view.players.length, 1));
    const maxWidth = Math.max(backW, Math.min(backW * 4, chord - backW * 0.5));
    const step = count > 1
        ? Math.max(0, Math.min(1, (maxWidth - backW) / ((count - 1) * backW)))
        : 1;
    holder.style.setProperty('--hand-step', step.toFixed(3));
    holder.dataset.count = String(count);
    holder.setAttribute('aria-hidden', 'true');
    for (let index = 0; index < count; index++) holder.append(element('span', 'card-back'));
    return holder;
}

function plate(info: SeatInfo, seat: number, rotationDeg: number): HTMLElement {
    const { view } = info;
    const player = view.players[seat];
    const host = element('div', 'seat-plate-host');
    const angle = ((rotationDeg % 360) + 360) % 360;
    const flipped = angle > 90 && angle < 270;
    if (flipped) host.style.transform = 'rotate(180deg)';

    const header = element('div', 'seat-plate');
    const avatar = element('span', 'seat-avatar', initials(info.names[seat], seat));
    avatar.style.setProperty('--hue', String((seat * 47) % 360));
    header.append(avatar,
        element('span', 'seat-name', info.names[seat] ?? `Seat ${seat + 1}`),
        element('span', 'seat-unicorns', `${player.unicorns}/${view.winTarget}`),
        element('span', 'seat-hand-count', `${player.handCount} in hand`));

    if (seat === view.turn.player) header.append(element('span', 'seat-badge turn', 'Turn'));
    if (view.waitingOn.includes(seat) && seat !== view.turn.player)
        header.append(element('span', 'seat-badge waiting', 'Waiting'));
    if (info.connected[seat] === false) header.append(element('span', 'seat-badge offline', 'Offline'));

    const status = element('ul', 'seat-status');
    for (const iid of player.stable) {
        const defId = view.cards[iid]?.defId;
        if (!defId) continue;
        const entry = cardEntry(defId);
        if (!entry || (entry.kind !== 'upgrade' && entry.kind !== 'downgrade')) continue;
        const item = element('li', entry.kind, `${entry.kind === 'upgrade' ? '▲' : '▼'} ${cardName(defId)}`);
        if (entry.text) item.dataset.tip = entry.text;
        status.append(item);
    }

    if (status.children.length === 0) host.append(header);
    else if (flipped) host.append(status, header);
    else host.append(header, status);
    return host;
}

export function seatElement(info: SeatInfo, seat: number, placement: SeatPlacement): HTMLElement {
    const { view } = info;
    const node = element('section', `seat${seat === view.seat ? ' mine' : ''}`);
    node.dataset.seat = String(seat);
    const chord = 2 * info.radius * Math.sin(Math.PI / Math.max(view.players.length, 1));
    node.style.setProperty('--seat-chord', `${chord.toFixed(2)}px`);
    node.style.transform =
        `translate(${placement.anchor.x.toFixed(2)}px, ${placement.anchor.y.toFixed(2)}px) rotate(${placement.rotationDeg}deg)`;

    if (seat === view.turn.player) node.classList.add('active');
    if (seat === info.selectedTarget) node.classList.add('targeted');
    if (info.targetable?.includes(seat)) node.classList.add('targetable');
    if (seat === view.seat) node.classList.add('bottom');

    node.append(plate(info, seat, placement.rotationDeg), stable(info, seat));
    if (seat !== view.seat) node.append(fan(info, seat));
    node.dataset.title = info.names[seat] ?? `Seat ${seat + 1}`;
    node.dataset.hand = String(view.players[seat].handCount);
    node.dataset.unicorns = String(view.players[seat].unicorns);
    node.setAttribute('aria-label',
        `${info.names[seat] ?? `Seat ${seat + 1}`}, ${view.players[seat].unicorns} of ${view.winTarget} unicorns`);
    return node;
}
