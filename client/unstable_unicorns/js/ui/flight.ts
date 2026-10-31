import { cardFace } from './card.js';
import { FLIGHT_MS } from './flight-plan.js';
import { WILDCARD } from '../vars.js';

export interface FlightOptions {
    spinDeg?: number;
    delay?: number;
    // Kept invisible until the flying card lands, so the card never appears at its destination early
    hide?: HTMLElement | null;
}

function reducedMotion(): boolean {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function ghostFace(defId: string): HTMLElement {
    if (defId !== WILDCARD) return cardFace(defId);
    const back = document.createElement('div');
    back.className = 'flight-back';
    return back;
}

export function flyCard(layer: HTMLElement, defId: string, from: DOMRect, to: DOMRect,
    options: FlightOptions = {}): void {
    if (reducedMotion()) return;
    const { spinDeg = 0, delay = 0, hide = null } = options;

    const ghost = document.createElement('div');
    ghost.className = 'flight';
    ghost.style.opacity = '0';
    ghost.append(ghostFace(defId));
    layer.append(ghost);

    const base = ghost.offsetWidth || from.width || 1;
    const startScale = from.width / base;
    const endScale = to.width / base;
    const offsetX = to.left - from.left;
    const offsetY = to.top - from.top;
    const landed = hide ? 1 : 0;

    ghost.style.left = `${from.left.toFixed(1)}px`;
    ghost.style.top = `${from.top.toFixed(1)}px`;
    if (hide) hide.style.visibility = 'hidden';

    const animation = ghost.animate([
        { transform: `translate(0px, 0px) rotate(${spinDeg}deg) scale(${startScale})`, opacity: 1 },
        {
            transform: `translate(${offsetX * 0.5}px, ${offsetY * 0.5 - 40}px) rotate(${spinDeg / 2}deg) ` +
                `scale(${((startScale + endScale) / 2) * 1.06})`,
            opacity: 1
        },
        { transform: `translate(${offsetX}px, ${offsetY}px) rotate(0deg) scale(${endScale})`, opacity: landed }
    ], { duration: FLIGHT_MS, delay, fill: 'forwards', easing: 'cubic-bezier(0.2, 1.2, 0.35, 1)' });

    animation.finished.catch(() => undefined).finally(() => {
        ghost.remove();
        if (hide) hide.style.visibility = '';
    });
}

export function showNeighWarning(layer: HTMLElement, neigher: string, player: string, card: string,
    superNeigh = false): void {
    layer.querySelector('.neigh-warning')?.remove();
    const node = document.createElement('div');
    node.className = 'neigh-warning';
    node.setAttribute('role', 'alert');
    const title = document.createElement('strong');
    title.textContent = superNeigh ? 'SUPER NEIGH!' : 'NEIGH!';
    const detail = document.createElement('span');
    detail.textContent = `${neigher} NEIGHED ${player}'s ${card}`;
    node.append(title, detail);
    layer.append(node);
    setTimeout(() => node.remove(), 3000);
}
