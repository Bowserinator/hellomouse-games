import { cardSlot } from './card.js';
import type { ViewModel } from '../engine/view.js';

function element(tag: string, className: string, text?: string): HTMLElement {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

export class BabyModal {
    private overlay: HTMLElement;
    private host: HTMLElement;
    private submit: (iid: string) => void;
    private signature = '';

    constructor(overlay: HTMLElement, host: HTMLElement, submit: (iid: string) => void) {
        this.overlay = overlay;
        this.host = host;
        this.submit = submit;

        host.addEventListener('click', event => {
            const slot = (event.target as HTMLElement | null)
                ?.closest<HTMLElement>('.card-slot[data-iid]');
            const iid = slot?.dataset.iid;
            if (iid) this.submit(iid);
        });

        host.addEventListener('keydown', event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            const slot = (event.target as HTMLElement | null)
                ?.closest<HTMLElement>('.card-slot[data-iid]');
            const iid = slot?.dataset.iid;
            if (iid) {
                event.preventDefault();
                this.submit(iid);
            }
        });
    }

    render(view: ViewModel): void {
        const open = view.phase === 'PICK_BABY' &&
            view.winner === null &&
            view.prompt === null &&
            !view.players[view.seat].babyChosen;

        if (!open) {
            this.close();
            return;
        }

        this.overlay.hidden = false;

        const signature = [
            view.seat,
            view.nursery.join(','),
            view.players.map(player => player.babyChosen ? '1' : '0').join('')
        ].join('|');
        if (signature === this.signature) return;
        this.signature = signature;

        this.host.replaceChildren();

        const header = element('header', 'prompt-header');
        const title = element('h2', 'prompt-reason', 'Pick a baby unicorn');
        title.id = 'baby-title';
        const chosen = view.players.filter(player => player.babyChosen).length;
        header.append(title, element('span', 'prompt-source',
            `${chosen}/${view.players.length} chosen · ${view.nursery.length} left`));
        this.host.append(header);

        const body = element('div', 'prompt-body');
        const grid = element('div', 'prompt-grid baby-grid');
        for (const iid of view.nursery) {
            const card = view.cards[iid];
            if (!card) continue;
            const slot = cardSlot(iid, card.defId);
            slot.classList.add('baby-choice');
            slot.tabIndex = 0;
            slot.setAttribute('role', 'button');
            grid.append(slot);
        }
        body.append(grid);
        this.host.append(body);

        this.host.querySelector<HTMLElement>('.baby-choice')?.focus();
    }

    private close(): void {
        if (this.overlay.hidden) return;
        this.overlay.hidden = true;
        this.signature = '';
        this.host.replaceChildren();
    }
}
