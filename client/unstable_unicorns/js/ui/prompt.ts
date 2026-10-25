import { cardName, cardSlot } from './card.js';
import { counterclockwiseSeats } from './player-picker.js';
import type { CardView, PromptView } from '../engine/view.js';

export type Answer = Array<string> | Array<number> | boolean | number | 'cancel';

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
    private handCounts: () => Array<number>;
    private dragging: string | null = null;
    private dragGhost: HTMLElement | null = null;
    private dropTarget: HTMLElement | null = null;
    private dropAfter = false;
    private dragOffset = { x: 0, y: 0 };
    private previousFocus: HTMLElement | null = null;

    constructor(host: HTMLElement, submit: (answer: Answer) => void, names: () => Array<string | null>,
        handCounts: () => Array<number> = () => []) {
        this.host = host;
        this.submit = submit;
        this.names = names;
        this.handCounts = handCounts;
        host.addEventListener('click', event => this.onClick(event));
        host.addEventListener('keydown', event => this.onCandidateKey(event));
        host.addEventListener('pointerdown', event => this.onPointerDown(event));
        host.addEventListener('pointermove', event => this.onPointerMove(event));
        host.addEventListener('pointerup', event => this.onPointerUp(event));
        host.addEventListener('pointercancel', event => this.onPointerUp(event));
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
            this.previousFocus = (document.activeElement as HTMLElement | null) ?? null;
        }

        this.shown = prompt;
        this.faces = faces;
        const overlay = this.host.closest<HTMLElement>('.modal-darken');
        if (overlay) overlay.style.display = 'block';
        this.host.dataset.kind = prompt.kind;
        this.draw();
    }

    close(): void {
        this.clearDrag();
        this.shown = null;
        this.host.replaceChildren();
        delete this.host.dataset.promptKind;
        delete this.host.dataset.promptRequired;
        const overlay = this.host.closest<HTMLElement>('.modal-darken');
        if (overlay) overlay.style.display = 'none';
        const focus = this.previousFocus;
        this.previousFocus = null;
        focus?.focus();
    }

    private nameOf(seat: number): string {
        return this.names()[seat] ?? `Seat ${seat + 1}`;
    }

    private draw(): void {
        const prompt = this.shown;
        if (!prompt) return;

        this.host.replaceChildren();
        this.host.dataset.promptKind = prompt.kind;
        this.host.dataset.promptRequired = prompt.kind === 'cards' && prompt.min === 0 ? 'false' : 'true';

        const header = element('header', 'prompt-header');
        const title = element('h2', 'prompt-reason', prompt.reason);
        title.id = 'prompt-title';
        header.append(title);
        const source = prompt.source ? this.faces[prompt.source] : undefined;
        if (source) header.append(element('span', 'prompt-source', cardName(source.defId)));
        this.host.append(header);

        const body = element('div', `prompt-body prompt-body-${prompt.kind}`);
        this.host.append(body);

        if (prompt.kind === 'cards' || prompt.kind === 'order') this.drawCards(body, prompt);
        else if (prompt.kind === 'player') this.drawPlayerOptions(body, prompt);
        else if (prompt.kind === 'yesno') this.drawYesNo(body);
        else this.drawOptions(body, prompt);
        if (prompt.canCancel && prompt.kind !== 'cards' && prompt.kind !== 'order' && prompt.kind !== 'yesno') {
            const footer = element('footer', 'prompt-footer');
            footer.append(this.pickButton('Cancel', 'cancel', true));
            this.host.append(footer);
        }
        this.focusInitial();
    }

    private drawCards(body: HTMLElement, prompt: PromptView): void {
        if (prompt.kind === 'order') {
            const list = element('div', 'prompt-order-list');
            for (const iid of this.order) list.append(this.orderCard(iid));
            body.append(list);
            const footer = element('footer', 'prompt-footer');
            footer.append(this.pickButton('Confirm order', 'confirm', true));
            if (prompt.canCancel) footer.append(this.pickButton('Cancel', 'cancel', true));
            this.host.append(footer);
            return;
        }

        const players = new Map<number, Array<string>>();
        for (const iid of prompt.cards) {
            const card = this.faces[iid];
            if (!card) continue;
            const list = players.get(card.owner) ?? [];
            list.push(iid);
            players.set(card.owner, list);
        }

        for (const [owner, iids] of players) {
            const playerGroup = element('section', 'prompt-player-group');
            playerGroup.append(element('h3', 'prompt-player-title', this.nameOf(owner)));
            const grid = element('div', 'prompt-grid');
            for (const iid of iids) {
                const slot = cardSlot(iid, this.faces[iid].defId);
                slot.setAttribute('role', 'button');
                slot.setAttribute('tabindex', '0');
                slot.setAttribute('aria-label', cardName(this.faces[iid].defId));
                slot.setAttribute('aria-pressed', String(this.picks.includes(iid)));
                slot.classList.toggle('selected', this.picks.includes(iid));
                grid.append(slot);
            }
            playerGroup.append(grid);
            body.append(playerGroup);
        }

        const footer = element('footer', 'prompt-footer');
        footer.append(element('span', 'prompt-count',
            `${this.picks.length} chosen · pick ${prompt.min === prompt.max ? prompt.min : `${prompt.min}-${prompt.max}`}`));
        if (prompt.min === 0) footer.append(this.pickButton('Skip', 'skip', true));
        footer.append(this.pickButton('Confirm', 'confirm', this.valid(prompt)));
        if (prompt.min > 0 && prompt.canCancel) footer.append(this.pickButton('Cancel', 'cancel', true));
        this.host.append(footer);
    }

    private orderCard(iid: string): HTMLElement {
        const card = element('div', 'prompt-order-card');
        card.dataset.iid = iid;
        const index = this.order.indexOf(iid);
        card.append(element('span', 'prompt-order-badge', String(index + 1)));
        const face = this.faces[iid];
        if (face) card.append(cardSlot(iid, face.defId));
        return card;
    }

    private drawPlayerOptions(body: HTMLElement, prompt: PromptView): void {
        const seats = counterclockwiseSeats(prompt.players, prompt.player, this.names().length);
        this.drawChoiceButtons(body, seats.map(seat => ({
            label: `${this.nameOf(seat)}\u00a0\u00a0(${this.handCounts()[seat] ?? 0} in hand)`,
            step: `player:${seat}`
        })));
    }

    private drawYesNo(body: HTMLElement): void {
        const row = element('div', 'prompt-choice-actions');
        row.append(this.pickButton('Yes', 'yes', true), this.pickButton('No', 'no', true));
        body.append(row);
    }

    private drawOptions(body: HTMLElement, prompt: PromptView): void {
        const buttons = [];
        for (let option = prompt.min; option <= prompt.max; option++)
            buttons.push({ label: `Option ${option}`, step: `option:${option}` });
        this.drawChoiceButtons(body, buttons);
    }

    private drawChoiceButtons(body: HTMLElement, buttons: Array<{ label: string; step: string }>): void {
        const row = element('div', 'prompt-options');
        for (const button of buttons) row.append(this.pickButton(button.label, button.step, true));
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

    private focusInitial(): void {
        const target = this.host.querySelector<HTMLElement>('.prompt-body-cards .card-slot') ??
            this.host.querySelector<HTMLElement>('button[data-step]') ?? this.host;
        target.focus();
    }

    private toggleCard(iid: string): void {
        this.picks = this.picks.includes(iid)
            ? this.picks.filter(card => card !== iid) : [...this.picks, iid];
        this.draw();
    }

    private onCandidateKey(event: KeyboardEvent): void {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const prompt = this.shown;
        const target = event.target as HTMLElement | null;
        const slot = target?.closest<HTMLElement>('.card-slot');
        if (!prompt || prompt.kind !== 'cards' || !slot?.dataset.iid) return;
        event.preventDefault();
        this.toggleCard(slot.dataset.iid);
    }

    private onKey(event: KeyboardEvent): void {
        const prompt = this.shown;
        if (!prompt || event.key !== 'Escape') return;
        event.preventDefault();
        if (prompt.kind === 'yesno') return this.submit(false);
        if (prompt.kind === 'cards' && prompt.min === 0) return this.submit([]);
        if (prompt.canCancel) this.submit('cancel');
    }

    private onClick(event: Event): void {
        const target = event.target as HTMLElement | null;
        const slot = target?.closest<HTMLElement>('.card-slot');
        const buttonNode = target?.closest<HTMLButtonElement>('button[data-step]');
        const prompt = this.shown;
        if (!prompt) return;

        if (slot && prompt.kind === 'cards' && slot.dataset.iid !== undefined && !buttonNode) {
            this.toggleCard(slot.dataset.iid);
            return;
        }
        if (!buttonNode) return;
        const step = buttonNode.dataset.step ?? '';

        if (step === 'confirm' && prompt.kind === 'cards') return this.submit([...this.picks]);
        if (step === 'confirm' && prompt.kind === 'order') return this.submit([...this.order]);
        if (step === 'skip') return this.submit([]);
        if (step === 'cancel' && prompt.canCancel) return this.submit('cancel');
        if (step === 'yes') return this.submit(true);
        if (step === 'no') return this.submit(false);
        if (step.startsWith('player:')) return this.submit([Number(step.slice('player:'.length))]);
        if (step.startsWith('option:')) return this.submit(Number(step.slice('option:'.length)));
    }

    private onPointerDown(event: Event): void {
        if (this.shown?.kind !== 'order') return;
        const card = (event.target as HTMLElement | null)?.closest<HTMLElement>('.prompt-order-card');
        if (!card?.dataset.iid) return;
        this.dragging = card.dataset.iid;
        card.classList.add('dragging');
        const point = event as PointerEvent;
        card.setPointerCapture(point.pointerId);
        const rect = card.getBoundingClientRect();
        this.dragOffset = { x: point.clientX - rect.left, y: point.clientY - rect.top };
        this.dragGhost = card.cloneNode(true) as HTMLElement;
        this.dragGhost.classList.add('prompt-order-drag-preview');
        document.body.append(this.dragGhost);
        this.moveGhost(point);
        this.updateDropTarget(point, card);
        point.preventDefault();
    }

    private onPointerMove(event: Event): void {
        if (!this.dragging) return;
        const point = event as PointerEvent;
        this.moveGhost(point);
        this.updateDropTarget(point);
        point.preventDefault();
    }

    private onPointerUp(event: Event): void {
        const iid = this.dragging;
        if (!iid || this.shown?.kind !== 'order') return;
        const point = event as PointerEvent;
        const source = this.host.querySelector<HTMLElement>(`.prompt-order-card[data-iid="${iid}"]`);
        if (source?.hasPointerCapture(point.pointerId)) source.releasePointerCapture(point.pointerId);
        this.updateDropTarget(point);
        const target = this.dropTarget;
        const after = this.dropAfter;
        const targetIid = target?.dataset.iid;
        const sourceIndex = this.order.indexOf(iid);
        const targetIndex = targetIid ? this.order.indexOf(targetIid) : -1;
        this.clearDrag();
        if (!targetIid || targetIid === iid || sourceIndex < 0 || targetIndex < 0) return;
        this.order.splice(sourceIndex, 1);
        const insertAt = targetIndex + (after ? 1 : 0) - (sourceIndex < targetIndex ? 1 : 0);
        this.order.splice(Math.max(0, insertAt), 0, iid);
        this.draw();
    }

    private moveGhost(point: PointerEvent): void {
        if (!this.dragGhost) return;
        this.dragGhost.style.left = `${point.clientX - this.dragOffset.x}px`;
        this.dragGhost.style.top = `${point.clientY - this.dragOffset.y}px`;
    }

    private updateDropTarget(point: PointerEvent, source?: HTMLElement): void {
        const pointed = document.elementFromPoint(point.clientX, point.clientY) as HTMLElement | null;
        const target = pointed?.closest<HTMLElement>('.prompt-order-card') ??
            (pointed ? null : source);
        if (!target || target.dataset.iid === this.dragging) return;
        this.dropTarget?.classList.remove('drop-before', 'drop-after');
        this.dropTarget = target;
        const rect = target.getBoundingClientRect();
        this.dropAfter = point.clientX > rect.left + rect.width / 2;
        target.classList.add(this.dropAfter ? 'drop-after' : 'drop-before');
    }

    private clearDrag(): void {
        if (this.dropTarget) this.dropTarget.classList.remove('drop-before', 'drop-after');
        const source = this.host.querySelector<HTMLElement>('.prompt-order-card.dragging');
        if (source) source.classList.remove('dragging');
        this.dragGhost?.remove();
        this.dragging = null;
        this.dragGhost = null;
        this.dropTarget = null;
    }
}
