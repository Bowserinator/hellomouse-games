import { el } from './dom.js';

let node: HTMLElement | undefined;

export function hideTooltip(): void {
    node?.remove();
}

/** Shows `text` in a floating label above `target` while it is hovered. */
export function tooltip(target: HTMLElement, text: string): void {
    target.addEventListener('pointerenter', () => {
        node ??= el('div', '', 'tooltip');
        node.textContent = text;
        node.setAttribute('role', 'tooltip');
        const host = target.closest('dialog') ?? document.body;
        host.addEventListener('close', hideTooltip, { once: true });
        host.append(node);
        const box = target.getBoundingClientRect();
        node.style.left = `${box.left + box.width / 2}px`;
        node.style.top = `${box.top - 6}px`;
    });
    target.addEventListener('pointerleave', hideTooltip);
    target.addEventListener('click', hideTooltip);
}
