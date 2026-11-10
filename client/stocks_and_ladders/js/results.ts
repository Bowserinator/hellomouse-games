/** Final standings dialog with a per-round allocation breakdown. */
import { el } from '../../shared/ts/dom.js';
import type { NativeDialog } from '../../shared/ts/dom.js';
import { BEHAVIOR_LABELS, GAME_CONFIG, STOCK_COLORS } from './config.js';
import { formatChange, formatMoney } from './format.js';
import type { Move, Sync } from './types.js';

function listItem(color: string, text: string): HTMLLIElement {
    const item = document.createElement('li');
    item.style.setProperty('--chip-color', color);
    item.textContent = text;
    return item;
}

export class Results {
    private sync: Sync | null = null;
    private selected = 0;
    private dialog = el<NativeDialog>('results-modal');

    constructor(move: (message: Move) => void) {
        el('results-close').onclick = () => this.dialog.close();
        el('show-results').onclick = () => this.open();
        el('results-lobby').onclick = () => move({ action: 'RETURN_TO_LOBBY' });
    }

    update(sync: Sync): void {
        this.sync = sync;
        if (this.dialog.open) this.render();
    }

    show(sync: Sync): void {
        this.selected = sync.youAre;
        this.update(sync);
        this.open();
    }

    open(): void {
        if (!this.sync?.view?.final) return;
        this.render();
        if (!this.dialog.open) this.dialog.showModal();
    }

    close(): void {
        this.sync = null;
        if (this.dialog.open) this.dialog.close();
    }

    private render(): void {
        const { sync } = this;
        const view = sync?.view;
        const final = view?.final;
        if (!sync || !view || !final) return;
        const name = (seat: number): string => sync.seats[seat]?.username ?? '';
        const finalMoney = (seat: number): number => view.worth[seat][view.worth[seat].length - 1];

        el('results-title').textContent = `${name(final.placements[0])} wins!`;
        el('results-lobby').hidden = !sync.isHost;
        el('results-wait').hidden = sync.isHost;
        el('standings').replaceChildren(...final.placements.map((seat, place) => listItem(
            view.players[seat].color,
            `${place + 1}. ${name(seat)}${seat === sync.youAre ? ' (you)' : ''} · ${formatMoney(finalMoney(seat))} ` +
                `(${formatChange(finalMoney(seat) / GAME_CONFIG.startingMoney - 1)})`
        )));

        el('breakdown-players').replaceChildren(...final.placements.map(seat => {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = name(seat);
            button.style.setProperty('--chip-color', view.players[seat].color);
            button.setAttribute('aria-pressed', String(seat === this.selected));
            button.onclick = () => {
                this.selected = seat;
                this.render();
            };
            return button;
        }));
        el('breakdown').replaceChildren(...final.allocations[this.selected].map((shares, round) => {
            const column = document.createElement('div');
            const stack = document.createElement('div');
            const label = document.createElement('small');
            column.className = 'breakdown-column';
            stack.className = 'breakdown-stack';
            label.textContent = String(round + 1);
            shares.forEach((share, stock) => {
                const part = document.createElement('span');
                part.style.flex = `${share} 1 0`;
                part.style.background = STOCK_COLORS[stock];
                part.title = `${view.tickers[stock]} ${share}%`;
                stack.appendChild(part);
            });
            column.append(stack, label);
            return column;
        }));
        el('behaviors').replaceChildren(...view.tickers.map((ticker, stock) =>
            listItem(STOCK_COLORS[stock], `${ticker} · ${BEHAVIOR_LABELS[final.behaviors[stock]]}`)));
    }
}
