import { cardName } from './card.js';
import type { ViewModel } from '../engine/view.js';

function element(tag: string, className: string, text?: string): HTMLElement {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

export class TargetModal {
    private host: HTMLElement;
    private names: () => Array<string | null>;
    private onPick: (seat: number) => void;
    private onCancel: () => void;
    private iid: string | null = null;

    constructor(host: HTMLElement, names: () => Array<string | null>, onPick: (seat: number) => void,
        onCancel: () => void) {
        this.host = host;
        this.names = names;
        this.onPick = onPick;
        this.onCancel = onCancel;
        host.addEventListener('click', event => this.onClick(event));
        document.addEventListener('keydown', event => this.onKey(event));
    }

    get isOpen(): boolean {
        return this.iid !== null;
    }

    open(view: ViewModel, iid: string): void {
        const seats = view.targets[iid] ?? [];
        if (seats.length === 0) return;
        this.iid = iid;
        const overlay = this.host.closest<HTMLElement>('.modal-darken');
        if (overlay) overlay.style.display = 'block';
        this.draw(view, iid, seats);
    }

    close(): void {
        if (this.iid === null) return;
        this.iid = null;
        this.host.replaceChildren();
        const overlay = this.host.closest<HTMLElement>('.modal-darken');
        if (overlay) overlay.style.display = 'none';
    }

    private nameOf(seat: number): string {
        return this.names()[seat] ?? `Seat ${seat + 1}`;
    }

    private draw(view: ViewModel, iid: string, seats: Array<number>): void {
        const card = view.cards[iid];
        this.host.replaceChildren();

        const header = element('header', 'prompt-header');
        header.append(element('h2', 'prompt-reason',
            card ? `Choose a player for ${cardName(card.defId)}` : 'Choose a player'));
        this.host.append(header);

        const body = element('div', 'prompt-body');
        const row = element('div', 'prompt-players');
        for (const seat of seats) {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = this.nameOf(seat);
            button.dataset.seat = String(seat);
            row.append(button);
        }
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.textContent = 'Cancel';
        cancel.dataset.seat = 'cancel';
        row.append(cancel);
        body.append(row);
        this.host.append(body);
    }

    private onKey(event: KeyboardEvent): void {
        if (this.iid === null || event.key !== 'Escape') return;
        this.close();
        this.onCancel();
    }

    private onClick(event: Event): void {
        if (this.iid === null) return;
        const buttonNode = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('button[data-seat]');
        if (!buttonNode) return;
        const seat = buttonNode.dataset.seat;
        if (seat === 'cancel') {
            this.close();
            this.onCancel();
            return;
        }
        const picked = Number(seat);
        if (Number.isNaN(picked)) return;
        this.close();
        this.onPick(picked);
    }
}
