import { cardEntry } from './card.js';
import { playTarget, seatName } from './log.js';
import type { LoggedEvent } from '../engine/events.js';
import type { ViewModel } from '../engine/view.js';

const EFFECT_KINDS: Array<string> = ['magic', 'instant', 'upgrade', 'downgrade'];
const HOLD_MS = 3400;

let host: HTMLElement | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

export function bindEffectToast(node: HTMLElement): void {
    host = node;
}

export function effectToast(event: LoggedEvent, view: ViewModel, names: Array<string | null>): void {
    if ((event.type !== 'play' && event.type !== 'enterStable') || event.card === undefined) return;
    const defId = event.publicDefId ?? view.cards[event.card]?.defId;
    const entry = defId === undefined ? undefined : cardEntry(defId);
    if (!entry) return;
    if (event.type === 'play' ? !EFFECT_KINDS.includes(entry.kind) : entry.unicornType !== 'special') return;
    const who = seatName(names, event.player);
    showEffectToast(event.type === 'enterStable'
        ? `${entry.name} entered ${who}'s Stable`
        : `${who} played ${entry.name}${playTarget(event, names)}`, entry.text);
}

export function showEffectToast(title: string, text: string): void {
    if (!host) return;
    const node = host;
    if (timer) clearTimeout(timer);
    node.replaceChildren();
    const heading = document.createElement('strong');
    heading.textContent = title;
    node.append(heading);
    if (text) {
        const detail = document.createElement('span');
        detail.textContent = text;
        node.append(detail);
    }
    node.hidden = false;
    node.classList.remove('show');
    void node.offsetWidth;
    node.classList.add('show');
    timer = setTimeout(() => {
        node.hidden = true;
        node.classList.remove('show');
        timer = null;
    }, HOLD_MS);
}
