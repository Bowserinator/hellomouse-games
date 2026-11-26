import { tokenImage } from '../types.js';

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = ''): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    node.textContent = text;
    node.className = cls;
    return node;
}

export function tokenIcon(token: number, cls = ''): HTMLImageElement {
    const node = document.createElement('img');
    node.src = tokenImage(token);
    node.alt = '';
    node.draggable = false;
    node.className = cls;
    return node;
}

export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
    return document.getElementById(id) as T;
}

export function button(text: string, click: () => void, disabled = false): HTMLButtonElement {
    const node = el('button', text);
    node.type = 'button';
    node.disabled = disabled;
    node.addEventListener('click', click);
    return node;
}

export interface GameDialog extends HTMLElement {
    open: boolean;
    showModal(): void;
    close(): void;
}

let backAction: (() => void) | undefined;

/** Sets what happens when the open panel is dismissed, or clears it when called with nothing. */
export function panelBack(action?: () => void): void {
    backAction = action;
}

export function panel(title: string, ...content: Array<Node>): void {
    const dialog = byId<GameDialog>('panel');
    backAction = undefined;
    dialog.onclose = () => {
        const back = backAction;
        backAction = undefined;
        back?.();
    };
    dialog.querySelector('.panel__confirm')?.remove();
    dialog.querySelectorAll('.panel__action').forEach(node => node.remove());
    byId('panel-close').hidden = false;
    byId('panel-title').textContent = title;
    byId('panel-close').textContent = 'Close';
    byId('panel-content').replaceChildren(...content);
    if (!dialog.open) dialog.showModal();
}

export function confirmPanel(title: string, message: string, confirm: () => void): void {
    panel(title, el('p', message));
    const action = button('Confirm', confirm);
    action.className = 'panel__confirm';
    byId('panel-close').after(action);
}

/** Replaces the footer's Close button with the given actions, or adds to it when `keepClose` is set. */
export function panelActions(actions: ReadonlyArray<HTMLButtonElement>, keepClose = false): void {
    byId('panel-close').hidden = !keepClose;
    for (const action of actions) {
        action.classList.add('panel__action');
        byId('panel-close').before(action);
    }
}

export function cancelable(): void {
    byId('panel-close').textContent = 'Cancel';
}

export const money = (amount: number | null): string => amount === null ? '—' : `$${amount.toLocaleString()}`;
