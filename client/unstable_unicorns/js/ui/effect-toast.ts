import { cardEntry } from './card.js';
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
    if (event.type !== 'play' || event.card === undefined) return;
    const defId = view.cards[event.card]?.defId;
    const entry = defId === undefined ? undefined : cardEntry(defId);
    if (!entry || !EFFECT_KINDS.includes(entry.kind)) return;
    const who = event.player === undefined
        ? 'Someone'
        : names[event.player] ?? `Seat ${event.player + 1}`;
    showEffectToast(`${who} played ${entry.name}`, entry.text);
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
