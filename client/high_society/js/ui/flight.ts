import type { GameEvent } from '../types.js';

export function snapshot(scale = 1): Map<string, {
    rect: DOMRect; node: HTMLElement; angle: number; width: number; height: number;
}> {
    const nodes = new Map<string, { rect: DOMRect; node: HTMLElement; angle: number; width: number; height: number }>();
    document.querySelectorAll<HTMLElement>('[data-seat] [data-money], #hand [data-money], .seat__backs img').forEach(node => {
        const seat = node.closest<HTMLElement>('[data-seat]')?.dataset.seat ?? 'hand';
        const zone = node.closest<HTMLElement>('[data-zone]') ?? node;
        const angle = parseFloat(node.closest<HTMLElement>('[data-seat]')?.style.getPropertyValue('--seat-angle') ?? '0');
        nodes.set(`${seat}:${node.dataset.money ?? 'back'}`, { rect: zone.getBoundingClientRect(), node, angle,
            width: node.offsetWidth * (seat === 'hand' ? 1 : scale),
            height: node.offsetHeight * (seat === 'hand' ? 1 : scale) });
    });
    const auction = document.querySelector<HTMLElement>('#auction-card .status-card');
    if (auction) nodes.set('auction', { rect: auction.getBoundingClientRect(), node: auction, angle: 0,
        width: auction.offsetWidth * scale, height: auction.offsetHeight * scale });
    return nodes;
}
export async function animate(events: Array<GameEvent>, before: ReturnType<typeof snapshot>,
    mySeat: number): Promise<void> {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const flights: Array<Promise<unknown>> = [];
    for (const event of events) {
        if (!['bid', 'returnMoney', 'discardMoney', 'award', 'disgrace'].includes(event.type)) continue;
        const awarded = event.type === 'award' || event.type === 'disgrace';
        const origin = event.type === 'bid' && event.seat === mySeat ? 'hand' : String(event.seat);
        const entries = awarded ? [before.get('auction')]
            : event.cards ? event.cards.map(c => before.get(`${origin}:${c.id}`) ?? before.get(`${origin}:back`))
                : [...before].filter(([key]) => key.startsWith(`${origin}:`) && !key.endsWith(':back'))
                    .map(([, value]) => value);
        for (const entry of entries) {
            if (!entry) continue;
            const target = event.type === 'discardMoney' ? document.getElementById('center')
                : document.querySelector<HTMLElement>(`[data-zone="${
                    awarded ? 'status' : event.type === 'returnMoney' ? 'hand' : 'bid'}-${event.seat}"]`);
            const rect = target?.getBoundingClientRect();
            if (!rect) continue;
            const clone = entry.node.cloneNode(true) as HTMLElement;
            clone.classList.add('card-flight'); clone.setAttribute('aria-hidden', 'true');
            const angle = parseFloat(target?.closest<HTMLElement>('[data-seat]')?.style.getPropertyValue('--seat-angle') ?? '0');
            Object.assign(clone.style, { left: `${entry.rect.x + entry.rect.width / 2}px`,
                top: `${entry.rect.y + entry.rect.height / 2}px`, width: `${entry.width}px`, height: `${entry.height}px` });
            document.body.append(clone);
            const animation = clone.animate([{ transform: `translate(-50%, -50%) rotate(${entry.angle}deg)`, opacity: 1 }, {
                left: `${rect.x + rect.width / 2}px`, top: `${rect.y + rect.height / 2}px`,
                transform: `translate(-50%, -50%) rotate(${angle}deg)`,
                opacity: event.type === 'discardMoney' ? 0 : 1
            }], { duration: 450, easing: 'ease-in-out' });
            flights.push(animation.finished.catch(() => {}).finally(() => clone.remove()));
        }
    }
    if (events.some(e => e.type === 'reveal')) {
        const card = document.getElementById('auction-card');
        const animation = card?.animate([{ transform: 'rotateY(90deg)', opacity: 0 },
            { transform: 'rotateY(0)', opacity: 1 }], { duration: 500 });
        if (animation) flights.push(animation.finished.catch(() => {}));
    }
    await Promise.all(flights);
}
