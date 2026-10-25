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

export function stampNeighed(anchor: DOMRect, label = 'Neighed!'): void {
    const node = document.createElement('div');
    node.className = 'stamp';
    node.textContent = label;
    node.style.left = `${(anchor.left + anchor.width / 2).toFixed(0)}px`;
    node.style.top = `${(anchor.top + anchor.height / 2).toFixed(0)}px`;
    document.body.append(node);
    node.animate([
        { transform: 'translate(-50%, -50%) rotate(-12deg) scale(0.6)', opacity: 0 },
        { transform: 'translate(-50%, -50%) rotate(-12deg) scale(1.08)', opacity: 1, offset: 0.35 },
        { transform: 'translate(-50%, -50%) rotate(-12deg) scale(1)', opacity: 1, offset: 0.8 },
        { transform: 'translate(-50%, -50%) rotate(-12deg) scale(1)', opacity: 0 }
    ], { duration: 900, easing: 'ease-out' }).finished.catch(() => undefined)
        .finally(() => node.remove());
}
