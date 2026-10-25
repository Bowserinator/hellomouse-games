import { cardName, cardSlot } from './card.js';
import type { CardView, PromptView } from '../engine/view.js';

export type Answer = Array<string> | Array<number> | boolean | number;

const ZONE_LABEL: Record<string, string> = {
    stable: 'stable',
    hand: 'hand',
    discard: 'discard pile',
    nursery: 'nursery',
    deck: 'deck'
};

function element(tag: string, className: string, text?: string): HTMLElement {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

export class PromptModal {
    private host: HTMLElement;
    private submit: (answer: Answer) => void;
    private promptId = -1;
    private picks: Array<string> = [];
    private order: Array<string> = [];
    private shown: PromptView | null = null;
    private faces: Record<string, CardView> = {};
    private names: () => Array<string | null>;

    constructor(host: HTMLElement, submit: (answer: Answer) => void, names: () => Array<string | null>) {
        this.host = host;
        this.submit = submit;
        this.names = names;
        host.addEventListener('click', event => this.onClick(event));
        document.addEventListener('keydown', event => this.onKey(event));
    }

    get isOpen(): boolean {
        return this.shown !== null;
    }

    render(prompt: PromptView | null, faces: Record<string, CardView>): void {
        if (!prompt) return this.close();

        if (prompt.id !== this.promptId) {
            this.promptId = prompt.id;
            this.picks = [];
            this.order = [...prompt.cards];
        }

        this.shown = prompt;
        this.faces = faces;
        const overlay = this.host.closest<HTMLElement>('.modal-darken');
        if (overlay) overlay.style.display = 'block';
        this.host.dataset.kind = prompt.kind;
        this.draw();
    }

    close(): void {
        this.shown = null;
        this.host.replaceChildren();
        const overlay = this.host.closest<HTMLElement>('.modal-darken');
        if (overlay) overlay.style.display = 'none';
    }

    private nameOf(seat: number): string {
        return this.names()[seat] ?? `Seat ${seat + 1}`;
    }

    private draw(): void {
        const prompt = this.shown;
        if (!prompt) return;

        this.host.replaceChildren();

        const header = element('header', 'prompt-header');
        header.append(element('h2', 'prompt-reason', prompt.reason));
        const source = prompt.source ? this.faces[prompt.source] : undefined;
        if (source) header.append(element('span', 'prompt-source', cardName(source.defId)));
        this.host.append(header);

        const body = element('div', 'prompt-body');
        this.host.append(body);

        if (prompt.kind === 'cards' || prompt.kind === 'order') this.drawCards(body, prompt);
        else if (prompt.kind === 'player') this.drawPlayers(body, prompt);
        else if (prompt.kind === 'yesno') this.drawYesNo(body);
        else this.drawOptions(body, prompt);
    }

    private drawCards(body: HTMLElement, prompt: PromptView): void {
        if (prompt.kind === 'order') {
            for (const iid of this.order) body.append(this.orderRow(prompt, iid));
            const footer = element('footer', 'prompt-footer');
            footer.append(this.pickButton('Confirm order', 'confirm', true));
            this.host.append(footer);
            return;
        }

        const groups = new Map<string, Array<string>>();
        for (const iid of prompt.cards) {
            const card = this.faces[iid];
            if (!card) continue;
            const label = `${this.nameOf(card.owner)}'s ${ZONE_LABEL[card.zone] ?? card.zone}`;
            const list = groups.get(label) ?? [];
            list.push(iid);
            groups.set(label, list);
        }

        for (const [label, iids] of groups) {
            const group = element('section', 'prompt-group');
            group.append(element('h3', 'prompt-group-title', label));
            const grid = element('div', 'prompt-grid');
            for (const iid of iids) {
                const slot = cardSlot(iid, this.faces[iid].defId);
                slot.classList.toggle('selected', this.picks.includes(iid));
                grid.append(slot);
            }
            group.append(grid);
            body.append(group);
        }

        const footer = element('footer', 'prompt-footer');
        footer.append(element('span', 'prompt-count',
            `${this.picks.length} chosen · pick ${prompt.min === prompt.max ? prompt.min : `${prompt.min}-${prompt.max}`}`));
        if (prompt.min === 0) footer.append(this.pickButton('Skip', 'skip', true));
        footer.append(this.pickButton('Confirm', 'confirm', this.valid(prompt)));
        this.host.append(footer);
    }

    private orderRow(prompt: PromptView, iid: string): HTMLElement {
        void prompt;
        const row = element('div', 'prompt-order-row');
        const index = this.order.indexOf(iid);
        row.append(
            this.pickButton('Up', `up:${iid}`, index > 0),
            this.pickButton('Down', `down:${iid}`, index < this.order.length - 1)
        );
        const card = this.faces[iid];
        if (card) row.append(cardSlot(iid, card.defId));
        return row;
    }

    private drawPlayers(body: HTMLElement, prompt: PromptView): void {
        const row = element('div', 'prompt-players');
        for (const seat of prompt.players)
            row.append(this.pickButton(this.nameOf(seat), `player:${seat}`, true));
        body.append(row);
    }

    private drawYesNo(body: HTMLElement): void {
        const row = element('div', 'prompt-players');
        row.append(this.pickButton('Yes', 'yes', true), this.pickButton('No', 'no', true));
        body.append(row);
    }

    private drawOptions(body: HTMLElement, prompt: PromptView): void {
        const row = element('div', 'prompt-players');
        for (let option = prompt.min; option <= prompt.max; option++)
            row.append(this.pickButton(`Option ${option}`, `option:${option}`, true));
        body.append(row);
    }

    private valid(prompt: PromptView): boolean {
        return this.picks.length >= prompt.min && this.picks.length <= prompt.max;
    }

    private pickButton(label: string, step: string, enabled: boolean): HTMLButtonElement {
        const node = document.createElement('button');
        node.textContent = label;
        node.dataset.step = step;
        node.disabled = !enabled;
        return node;
    }

    private onKey(event: KeyboardEvent): void {
        const prompt = this.shown;
        if (!prompt || event.key !== 'Escape') return;
        if (prompt.min > 0) {
            event.preventDefault();
            return;
        }
        this.submit(prompt.kind === 'cards' || prompt.kind === 'order' ? [] : false);
    }

    private onClick(event: Event): void {
        const target = event.target as HTMLElement | null;
        const slot = target?.closest<HTMLElement>('.card-slot');
        const buttonNode = target?.closest<HTMLButtonElement>('button[data-step]');
        const prompt = this.shown;
        if (!prompt) return;

        if (slot && prompt.kind === 'cards' && slot.dataset.iid !== undefined && !buttonNode) {
            const iid = slot.dataset.iid;
            this.picks = this.picks.includes(iid)
                ? this.picks.filter(card => card !== iid) : [...this.picks, iid];
            this.draw();
            return;
        }

        if (!buttonNode) return;
        const step = buttonNode.dataset.step ?? '';

        if (step === 'confirm' && prompt.kind === 'cards') return this.submit([...this.picks]);
        if (step === 'confirm' && prompt.kind === 'order') return this.submit([...this.order]);
        if (step === 'skip') return this.submit([]);
        if (step === 'yes') return this.submit(true);
        if (step === 'no') return this.submit(false);
        if (step.startsWith('player:')) return this.submit([Number(step.slice('player:'.length))]);
        if (step.startsWith('option:')) return this.submit(Number(step.slice('option:'.length)));

        if (step.startsWith('up:') || step.startsWith('down:')) {
            const iid = step.slice(step.indexOf(':') + 1);
            const index = this.order.indexOf(iid);
            const next = step.startsWith('up') ? index - 1 : index + 1;
            if (index === -1 || next < 0 || next >= this.order.length) return;
            this.order.splice(index, 1);
            this.order.splice(next, 0, iid);
            this.draw();
        }
    }
}
