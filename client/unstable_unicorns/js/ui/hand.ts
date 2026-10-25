import { cardSlot } from './card.js';
import type { ViewModel } from '../engine/view.js';

const FAN_DEG = 4;
const FAN_LIFT = 0.6;

export type HandInteraction = 'discard' | 'neigh' | 'play' | 'blocked';

export interface HandState {
    selected: string | null;
    picks: Array<string>;
    noActions: boolean;
}

export function handInteraction(view: ViewModel, iid: string): HandInteraction {
    const card = view.cards[iid];
    if (!card) return 'blocked';
    const canNeigh = view.chain.top !== null && view.chain.canNeigh && card.neighable;
    if (view.promptOpen) return canNeigh ? 'neigh' : 'blocked';
    if (view.phase === 'DISCARD_LIMIT' && view.turn.player === view.seat) return 'discard';
    if (canNeigh) return 'neigh';
    if (view.playable.includes(iid)) return 'play';
    return 'blocked';
}

export class HandView {
    private host: HTMLElement;
    private slots = new Map<string, HTMLElement>();

    constructor(host: HTMLElement) {
        this.host = host;
    }

    render(view: ViewModel, state: HandState): void {
        const cards = view.players[view.seat].hand ?? [];
        const dimmed = view.promptOpen;
        const seen = new Set<string>();

        this.host.classList.toggle('dimmed', dimmed);
        this.host.classList.toggle('no-actions', state.noActions);

        const fanDeg = Math.min(FAN_DEG, 18 / Math.max(1, cards.length - 1));
        cards.forEach((iid, index) => {
            seen.add(iid);
            const defId = view.cards[iid]?.defId;
            if (!defId) return;
            let slot = this.slots.get(iid);
            if (!slot) {
                slot = cardSlot(iid, defId);
                slot.classList.add('hand-card');
                this.slots.set(iid, slot);
            }
            if (slot.parentElement !== this.host) this.host.append(slot);

            const offset = index - (cards.length - 1) / 2;
            slot.style.setProperty('--i', String(index));
            slot.style.setProperty('--fan-deg', `${(offset * fanDeg).toFixed(2)}deg`);
            slot.style.setProperty('--fan-y', `${(Math.abs(offset) ** 2 * FAN_LIFT).toFixed(2)}px`);
            const interaction = handInteraction(view, iid);
            slot.classList.toggle('selected',
                iid === state.selected || state.picks.includes(iid));
            slot.classList.toggle('playable', interaction === 'play');
            slot.classList.toggle('neigh-ready', interaction === 'neigh');
            slot.classList.toggle('blocked', interaction === 'blocked');
        });

        for (const [iid, slot] of this.slots)
            if (!seen.has(iid)) {
                slot.remove();
                this.slots.delete(iid);
            }

        this.host.dataset.count = String(cards.length);

        if (cards.length > 1) {
            const cardWidth = this.host.querySelector<HTMLElement>('.hand-card')?.offsetWidth ?? 130;
            const available = this.host.clientWidth;
            const fit = cardWidth - (available - cardWidth) / (cards.length - 1);
            const overlap = Math.max(34, Math.min(cardWidth * 0.78, fit));
            this.host.style.setProperty('--hand-overlap', `${-overlap.toFixed(1)}px`);
        } else
            this.host.style.setProperty('--hand-overlap', '0px');

        const note = this.host.closest('#hud')?.querySelector<HTMLElement>('.hand-note');
        if (note) {
            const tooMany = view.phase === 'DISCARD_LIMIT'
                ? view.players[view.seat].handCount - view.handLimit : 0;
            note.textContent = tooMany > 0
                ? `Discard ${tooMany} card${tooMany === 1 ? '' : 's'} · ${state.picks.length} chosen` : '';
            note.hidden = tooMany <= 0;
        }
    }
}
