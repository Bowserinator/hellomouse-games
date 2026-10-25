import { cardName } from './card.js';
import { WILDCARD } from '../vars.js';
import type { ViewModel } from '../engine/view.js';

const PHASE_TEXT: Record<string, string> = {
    LOBBY: 'Lobby',
    PICK_BABY: 'Pick a baby unicorn',
    AWAIT_BEGIN: 'Waiting to begin the turn',
    TURN_START: 'Turn start',
    ACTION: 'Action phase',
    TURN_END: 'End of turn',
    DISCARD_LIMIT: 'Discard down to the hand limit',
    OVER: 'Game over'
};

function element(tag: string, className: string, text?: string): HTMLElement {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

export class ChainBanner {
    private host: HTMLElement;

    constructor(host: HTMLElement) {
        this.host = host;
    }

    render(view: ViewModel, names: Array<string | null>): void {
        const name = (seat: number) => names[seat] ?? `Seat ${seat + 1}`;
        this.host.replaceChildren();

        if (view.winner !== null) {
            this.host.append(element('span', 'banner-title', `${name(view.winner)} wins!`));
            this.host.dataset.state = 'over';
            return;
        }

        if (view.chain.top) {
            const top = view.chain.top;
            const defId = top.publicDefId ?? view.cards[top.card]?.defId;
            this.host.dataset.state = 'chain';
            const card = element('span', 'banner-card', defId ? cardName(defId) : 'a card');
            if (defId && defId !== WILDCARD) {
                card.dataset.iid = top.card;
                card.dataset.defId = defId;
                card.tabIndex = 0;
                card.setAttribute('aria-label', `Preview ${cardName(defId)}`);
            }
            this.host.append(element('span', 'banner-title', `${name(top.by)} played`), card);
            if (view.chain.canNeigh) this.host.append(element('span', 'banner-hint', 'Neigh to undo it'));
            if (view.pendingWinner !== null)
                this.host.append(element('span', 'banner-warn',
                    `${name(view.pendingWinner)} wins unless neighed`));
            return;
        }

        this.host.dataset.state = 'plain';
        this.host.append(element('span', 'banner-title', PHASE_TEXT[view.phase] ?? view.phase));

        const waiting = view.waitingOn.filter(seat => seat !== view.seat).map(name);
        if (waiting.length > 0)
            this.host.append(element('span', 'banner-hint', `Waiting on ${waiting.join(', ')}`));

        if (view.phase === 'ACTION' && view.turn.player === view.seat)
            this.host.append(element('span', 'banner-hint',
                `${view.turn.actionsLeft} action${view.turn.actionsLeft === 1 ? '' : 's'} left`));
    }
}
