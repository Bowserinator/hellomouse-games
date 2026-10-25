import { cardSlot } from './card.js';
import type { ViewModel } from '../engine/view.js';

function element(tag: string, className: string, text?: string): HTMLElement {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

const PILE_MAX_LAYERS = 48;

function buildLayers(className: string, offset: number): Array<HTMLElement> {
    const layers: Array<HTMLElement> = [];
    for (let index = 0; index < PILE_MAX_LAYERS; index++) {
        const layer = element('span', className);
        layer.style.setProperty('--layer', String(index + offset));
        layer.hidden = true;
        layers.push(layer);
    }
    return layers;
}

export class CenterView {
    readonly deck: HTMLElement;
    private host: HTMLElement;
    private deckCount: HTMLElement;
    private lastDeckCount = -1;
    private discard: HTMLElement;
    private discardStack: HTMLElement;
    private discardLayers: Array<HTMLElement> = [];
    private lastDiscardCount = -1;
    private discardSlot: HTMLElement;
    private discardCount: HTMLElement;
    private nurserySlot: HTMLElement;
    private nurseryCount: HTMLElement;
    private drawCue: HTMLElement;

    constructor(host: HTMLElement) {
        this.host = host;

        this.deck = element('div', 'pile deck');
        this.deck.dataset.action = 'deck';
        this.deck.setAttribute('role', 'button');
        this.deck.tabIndex = 0;

        const stack = element('div', 'deck-stack');
        stack.setAttribute('aria-hidden', 'true');
        stack.append(element('span', 'deck-card'));

        this.drawCue = element('span', 'draw-cue');
        this.drawCue.setAttribute('aria-hidden', 'true');
        this.drawCue.hidden = true;
        this.drawCue.append(element('span', 'draw-cue-label', 'DRAW A CARD'));

        this.deckCount = element('span', 'pile-count', '0');
        this.deck.append(
            stack,
            this.drawCue,
            element('span', 'pile-label', 'Deck'),
            this.deckCount,
            element('span', 'pile-ring')
        );

        this.discard = element('div', 'pile discard');
        this.discardStack = element('div', 'discard-stack');
        this.discardStack.setAttribute('aria-hidden', 'true');
        this.discardLayers = buildLayers('discard-layer', 1);
        this.discardStack.append(...this.discardLayers);
        this.discardSlot = element('div', 'pile-top');
        this.discardCount = element('span', 'pile-count', '0');
        this.discard.append(
            element('span', 'pile-label', 'Discard'),
            this.discardStack,
            this.discardSlot,
            this.discardCount
        );

        const nursery = element('div', 'pile nursery');
        this.nurserySlot = element('div', 'pile-top');
        this.nurseryCount = element('span', 'pile-count', '0');
        nursery.append(element('span', 'pile-label', 'Nursery'), this.nurserySlot, this.nurseryCount);

        this.host.append(this.deck, nursery, this.discard);

        this.updateDeck(0);
        this.updateDiscard(0);
    }

    render(view: ViewModel): void {
        this.updateDeck(view.deckCount);
        this.updateDiscard(view.discard.length);
        this.setCount(this.nurseryCount, view.nursery.length);
        this.fillTop(this.discardSlot, view, view.discard[view.discard.length - 1]);
        this.fillTop(this.nurserySlot, view, view.nursery[view.nursery.length - 1]);
    }

    setDrawCue(show: boolean): void {
        this.drawCue.hidden = !show;
        this.deck.dataset.draw = String(show);
    }

    setDrawAvailable(available: boolean): void {
        this.deck.dataset.available = String(available);
        this.deck.setAttribute('aria-disabled', String(!available));
        this.deck.tabIndex = available ? 0 : -1;
    }

    private updateDeck(count: number): void {
        if (count === this.lastDeckCount) return;
        this.lastDeckCount = count;

        const visible = count === 0 ? 0 : Math.min(PILE_MAX_LAYERS, count);
        this.setCount(this.deckCount, count);
        this.deck.classList.toggle('empty', count === 0);
        this.deck.style.setProperty('--layer-max', String(Math.max(0, visible - 1)));
    }

    private updateDiscard(count: number): void {
        if (count === this.lastDiscardCount) return;
        this.lastDiscardCount = count;

        const visible = count <= 1 ? 0 : Math.min(PILE_MAX_LAYERS, count - 1);
        this.setCount(this.discardCount, count);
        this.discard.classList.toggle('empty', count === 0);
        this.discard.style.setProperty('--layer-max', String(visible));
        this.setLayers(this.discardLayers, visible);
    }

    private setLayers(layers: Array<HTMLElement>, visible: number): void {
        layers.forEach((layer, index) => {
            layer.hidden = index >= visible;
        });
    }

    private setCount(node: HTMLElement, value: number): void {
        node.textContent = String(value);
    }

    private fillTop(host: HTMLElement, view: ViewModel, iid: string | undefined): void {
        if (!iid) {
            delete host.dataset.iid;
            host.replaceChildren();
            return;
        }
        if (host.dataset.iid === iid) return;
        const defId = view.cards[iid]?.defId;
        if (!defId) return;
        host.dataset.iid = iid;
        const slot = cardSlot(iid, defId);
        host.replaceChildren(slot);
    }
}
