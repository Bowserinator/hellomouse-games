import type { CardView, GameEvent, Zone } from '../types.js';
import { createCardElement } from './card-element.js';
import { eventGroups, groupDuration } from './timing.js';
export type Boxes = Map<string, DOMRect>;
export function snapshot(): Boxes {
    const boxes: Boxes = new Map();
    document.querySelectorAll<HTMLElement>('[data-iid], [data-place]').forEach(node => {
        if (node.dataset.iid) boxes.set(node.dataset.iid, node.getBoundingClientRect());
        if (node.dataset.place) boxes.set(`place:${node.dataset.place}`, node.getBoundingClientRect());
    });
    return boxes;
}
const place = (zone: Zone): string => typeof zone === 'string' ? zone : String(zone.hand);
const waitAnimation = (animation: Animation): Promise<void> => new Promise(resolve => {
    animation.onfinish = animation.oncancel = () => resolve();
});
export async function animate(events: Array<GameEvent>, before: Boxes,
    landing: (group: Array<GameEvent>) => void): Promise<void> {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
        for (const group of eventGroups(events)) landing(group);
        return;
    }
    const after = snapshot();
    const layer = document.getElementById('flight-layer')!;
    const destinations = new Map<string, Array<HTMLElement>>();
    const lastEvent = new Map<string, number>();
    for (const event of events) {
        const cards = event.group === 'reveal' ? event.cards : [event.card];
        for (const card of cards) {
            const nodes = [...document.querySelectorAll<HTMLElement>(`[data-iid="${card.iid}"]`)];
            destinations.set(card.iid, nodes);
            lastEvent.set(card.iid, event.seq);
            for (const node of nodes) node.style.visibility = 'hidden';
        }
    }
    const reveal = (iid: string, seq = lastEvent.get(iid)): void => {
        if (seq !== lastEvent.get(iid)) return;
        for (const node of destinations.get(iid) ?? []) node.style.visibility = '';
    };
    for (const [iid, box] of before) {
        if (iid.startsWith('place:') || destinations.has(iid)) continue;
        const node = document.querySelector<HTMLElement>(`[data-iid="${iid}"]`);
        const end = after.get(iid);
        if (node && end) node.animate([
            { transform: `translate(${box.x - end.x}px, ${box.y - end.y}px)` }, { transform: 'translate(0, 0)' }
        ], { duration: 350, easing: 'ease-out' });
    }
    const positions = new Map(before);
    const fly = async (card: CardView, from: DOMRect | undefined, to: DOMRect | undefined,
        delay: number, flip: boolean, faceDown: boolean, seq: number, inPlace = false): Promise<void> => {
        if (!from || !to || !from.width || !to.width) {
            reveal(card.iid, seq); return;
        }
        const ghost = document.createElement('div');
        ghost.className = 'flight';
        const inner = document.createElement('div'); inner.className = 'flight-flipper';
        const face = createCardElement(card, faceDown);
        face.classList.add('flight-face');
        inner.append(face);
        if (flip) {
            const back = createCardElement(card, true); back.classList.add('flight-back'); inner.append(back);
            inner.animate([{ transform: 'rotateY(180deg)' }, { transform: 'rotateY(180deg)', offset: .55 },
                { transform: 'rotateY(0)' }], { duration: 450, delay, fill: 'both' });
        }
        ghost.append(inner); layer.append(ghost);
        const transform = (box: DOMRect): string =>
            `translate(${box.x}px, ${box.y}px) scale(${Math.min(box.width, 100) / 100})`;
        await waitAnimation(ghost.animate([
            { transform: transform(from) },
            { transform: `translate(${(from.x + to.x) / 2}px, ${(from.y + to.y) / 2 - (inPlace ? 0 : 55)}px) scale(${inPlace ? Math.min(to.width, 100) / 100 : .9})` },
            { transform: transform(to) }
        ], { duration: 450, delay, easing: 'ease-out', fill: 'both' }));
        ghost.remove(); reveal(card.iid, seq);
    };
    for (const group of eventGroups(events)) {
        const kind = group[0].group;
        if (kind === 'shuffle') {
            const deck = document.querySelector<HTMLElement>('[data-place="deck"]');
            if (deck) await waitAnimation(deck.animate([
                { transform: 'rotate(0)' }, { transform: 'translateX(-12px) rotate(-8deg)' },
                { transform: 'translateX(12px) rotate(8deg)' }, { transform: 'rotate(0)' }
            ], { duration: groupDuration(group) }));
            for (const event of group) if (event.group !== 'reveal')
                positions.set(event.card.iid, after.get('place:deck')!);
        } else await Promise.all(group.flatMap((event, i) => {
            if (event.group === 'reveal') return event.cards.map((card, j) => {
                const box = after.get(card.iid) ?? after.get(`place:${event.seat}`);
                return fly(card, box, box, j * 30, true, false, event.seq, true);
            });
            const from = positions.get(event.card.iid) ?? before.get(`place:${place(event.from)}`) ??
                after.get(`place:${place(event.from)}`);
            const to = (event.to === 'deck' ? undefined : after.get(event.card.iid)) ??
                after.get(`place:${place(event.to)}`);
            if (to) positions.set(event.card.iid, to);
            const faceDown = ['gather', 'recycle'].includes(kind);
            const flip = !faceDown && !!event.card.rank && ['deal', 'draw', 'steal'].includes(kind);
            const stagger = kind === 'gather' || kind === 'recycle' ? 15 : 30;
            return [fly(event.card, from, to, i * stagger + (kind === 'draw' ? 150 : 0),
                flip, faceDown, event.seq)];
        }));
        landing(group);
    }
    for (const iid of destinations.keys()) reveal(iid);
}
