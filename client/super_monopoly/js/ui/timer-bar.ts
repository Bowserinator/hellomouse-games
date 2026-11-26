import { el } from './dom.js';

const URGENT_MS = 10000;

/** A thin countdown bar pinned to the top of its scrolling container. */
export function timerBar(remaining: () => number, total: () => number,
    onTick: (left: number, urgent: boolean) => void = () => undefined): { node: HTMLElement; stop: () => void } {
    const node = el('div', '', 'timer-bar');
    const fill = el('span');
    node.append(fill);
    const tick = (): void => {
        const left = Math.max(0, remaining());
        const urgent = left > 0 && left <= URGENT_MS;
        fill.style.width = `${Math.min(100, left / Math.max(1, total()) * 100)}%`;
        node.classList.toggle('urgent', urgent);
        onTick(left, urgent);
    };
    const interval = setInterval(tick, 100);
    tick();
    return { node, stop: () => clearInterval(interval) };
}
