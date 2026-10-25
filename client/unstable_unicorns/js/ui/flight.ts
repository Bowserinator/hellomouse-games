import { cardFace } from './card.js';

const DURATION = 320;

export function flyCard(layer: HTMLElement, defId: string, from: DOMRect, to: DOMRect, spinDeg = 0): void {
    const ghost = document.createElement('div');
    ghost.className = 'flight';
    ghost.append(cardFace(defId));
    ghost.style.width = `${from.width.toFixed(1)}px`;
    ghost.style.height = `${from.height.toFixed(1)}px`;
    layer.append(ghost);

    const offsetX = to.left - from.left;
    const offsetY = to.top - from.top;
    const scale = from.width === 0 ? 1 : to.width / from.width;

    const animation = ghost.animate([
        { transform: `translate(0px, 0px) rotate(${spinDeg}deg) scale(1)`, opacity: 1 },
        { transform: `translate(${offsetX * 0.5}px, ${offsetY * 0.5 - 40}px) rotate(${spinDeg / 2}deg) scale(1.06)`, opacity: 1 },
        { transform: `translate(${offsetX}px, ${offsetY}px) rotate(0deg) scale(${scale})`, opacity: 0 }
    ], { duration: DURATION, easing: 'cubic-bezier(0.2, 1.2, 0.35, 1)' });

    ghost.style.left = `${from.left.toFixed(1)}px`;
    ghost.style.top = `${from.top.toFixed(1)}px`;

    animation.finished.catch(() => undefined).finally(() => ghost.remove());
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
