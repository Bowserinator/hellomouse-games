import type { CardView, MoveEvent, View, Zone } from '../types.js';
import { createCardElement } from './card-element.js';
import { groupDuration } from './timing.js';

type Zones = Map<string, Array<CardView>>;
export function zoneKey(zone: Zone): string {
    return typeof zone === 'string' ? zone : `hand-${zone.hand}`;
}
const hidden = (iid: string): CardView => ({ iid, value: null, suit: null, joker: null });

export function rewind(view: View): Zones {
    const zones: Zones = new Map([
        ['deck', []], ['discard', [...view.discard]], ['table', [...view.tablePile]],
        ...view.hands.map((hand, seat): [string, Array<CardView>] => [`hand-${seat}`, [...hand]])
    ]);
    const present = new Set([...zones.values()].flat().map(c => c.iid));
    for (const e of view.events) if (!present.has(e.card.iid)) {
        zones.get('deck')?.push(hidden(e.card.iid)); present.add(e.card.iid);
    }
    for (const e of [...view.events].reverse()) {
        const to = zones.get(zoneKey(e.to)) ?? [];
        const index = to.findIndex(c => c.iid === e.card.iid);
        if (index !== -1) to.splice(index, 1);
        const masked = typeof e.from === 'object' && e.from.hand !== view.youAre;
        zones.get(zoneKey(e.from))?.push(masked ? hidden(e.card.iid) : e.card);
    }
    return zones;
}
export function applyEvent(zones: Zones, e: MoveEvent, ownSeat = -1): void {
    const source = zones.get(zoneKey(e.from)) ?? [];
    const index = source.findIndex(c => c.iid === e.card.iid);
    if (index !== -1) source.splice(index, 1);
    const masked = typeof e.to === 'object' && e.to.hand !== ownSeat;
    zones.get(zoneKey(e.to))?.push(masked ? hidden(e.card.iid) : e.card);
}
function visualView(view: View, zones: Zones): View {
    const hands = view.hands.map((_, seat) => [...(zones.get(`hand-${seat}`) ?? [])]);
    return { ...view, hands, counts: hands.map(h => h.length), deckCount: zones.get('deck')?.length ?? 0,
        discard: [...(zones.get('discard') ?? [])], tablePile: [...(zones.get('table') ?? [])] };
}
function element(iid: string): HTMLElement | null {
    return document.querySelector<HTMLElement>(`#table-world [data-iid="${iid}"], #local-hand [data-iid="${iid}"]`);
}
function target(zone: Zone): DOMRect {
    const area = document.querySelector(`[data-zone="${zoneKey(zone)}"]`) ?? document.body;
    const rect = area.getBoundingClientRect(), world = area.closest<HTMLElement>('#table-world');
    const scale = world ? world.getBoundingClientRect().width / world.offsetWidth : 1;
    const width = 65 * scale, height = 91 * scale;
    return new DOMRect(rect.x + (rect.width - width) / 2, rect.y + (rect.height - height) / 2, width, height);
}
function rects(): Map<string, DOMRect> {
    return new Map([...document.querySelectorAll<HTMLElement>('#table-world [data-iid], #local-hand [data-iid]')]
        .map(el => [el.dataset.iid ?? '', el.getBoundingClientRect()]));
}
export class FlightQueue {
    private queue: Array<View> = [];
    private running = false;
    private generation = 0;
    busy = false;
    blocksInput = false;
    private animations = new Set<Animation>();
    constructor(private render: (view: View) => void, private gate: (busy: boolean) => void) {}
    reset(): void {
        this.generation++; this.queue = []; this.busy = this.blocksInput = false;
        for (const animation of this.animations) animation.cancel();
        this.animations.clear(); this.gate(false);
    }
    enqueue(view: View): void {
        this.queue.push(view); void this.run();
    }
    private async run(): Promise<void> {
        if (this.running) return;
        this.running = true;
        try {
            while (this.queue.length) {
                const view = this.queue.shift(); if (!view) break;
                const generation = this.generation;
                if (!view.events.length || matchMedia('(prefers-reduced-motion: reduce)').matches) {
                    this.render(view); continue;
                }
                this.busy = true; this.gate(true);
                const zones = rewind(view); this.render(visualView(view, zones));
                const groups: Array<Array<MoveEvent>> = [];
                for (const event of view.events) {
                    const group = groups.at(-1);
                    if (group?.[0].group === event.group && event.group !== 'reveal') group.push(event);
                    else groups.push([event]);
                }
                for (const group of groups) {
                    if (generation !== this.generation) break;
                    this.blocksInput = ['deal', 'exchange', 'gather', 'shuffle', 'reveal'].includes(group[0].group);
                    this.gate(true);
                    await this.animate(view, zones, group);
                }
                if (generation === this.generation) {
                    this.render(view); this.busy = this.blocksInput = false; this.gate(false);
                }
            }
        } finally {
            this.running = false; this.busy = this.blocksInput = false; this.gate(false);
        }
    }
    private async animate(view: View, zones: Zones, events: Array<MoveEvent>): Promise<void> {
        const before = rects(), sourceRects = events.map(e => before.get(e.card.iid) ?? target(e.from));
        const group = events[0].group;
        const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
        const total = reduced ? 80 : groupDuration(group, events.length);
        const duration = reduced ? 80 : group === 'reveal' ? 650 : group === 'shuffle' ? 500 : 460;
        const stagger = events.length > 1 ? Math.max(0, total - duration) / (events.length - 1) : 0;
        for (const event of events) applyEvent(zones, event, view.youAre);
        this.render(visualView(view, zones));
        if (group === 'play' && events.some(e => e.card.value === 8 && !e.card.joker))
            document.querySelector('[data-zone="table"]')?.animate([
                { filter: 'drop-shadow(0 0 0 #f2c200)' },
                { filter: 'drop-shadow(0 0 24px #f2c200)' }, { filter: 'drop-shadow(0 0 0 #f2c200)' }
            ], { duration: total });
        const moved = new Set(events.map(e => e.card.iid));
        const animations: Array<Promise<unknown>> = [];
        for (const [iid, old] of before) {
            const el = element(iid); if (!el || moved.has(iid)) continue;
            const next = el.getBoundingClientRect();
            animations.push(el.animate([
                { transform: `translate(${old.x - next.x}px, ${old.y - next.y}px)` }, { transform: 'translate(0, 0)' }
            ], { duration: reduced ? 80 : 300, easing: 'ease-out' }).finished.catch(() => undefined));
        }
        const counts = [...document.querySelectorAll<HTMLElement>('[data-count]')];
        const previousCounts = new Map<string, number>();
        for (const count of counts) {
            const key = count.dataset.count ?? '', finalCount = Number(count.textContent);
            const net = events.filter(e => zoneKey(e.to) === key).length -
                events.filter(e => zoneKey(e.from) === key).length;
            previousCounts.set(key, finalCount - net); count.textContent = String(finalCount - net);
        }
        for (const [i, event] of events.entries()) {
            const destination = element(event.card.iid);
            const end = destination?.getBoundingClientRect() ?? target(event.to), start = sourceRects[i];
            if (destination) destination.style.visibility = 'hidden';
            const sourceHidden = group === 'gather' || event.from === 'deck' || event.from === 'discard' ||
                (typeof event.from === 'object' && event.from.hand !== view.youAre);
            const targetHidden = group === 'gather' || event.to === 'deck' || event.to === 'discard' ||
                (typeof event.to === 'object' && event.to.hand !== view.youAre && group !== 'exchange');
            const ghost = document.createElement('div');
            ghost.className = 'flight'; ghost.setAttribute('aria-hidden', 'true');
            const flipper = document.createElement('div'); flipper.className = 'flight-flipper';
            const front = createCardElement(event.card); front.classList.add('flight-front');
            const back = createCardElement(hidden(event.card.iid)); back.classList.add('flight-back');
            flipper.append(front, back); ghost.append(flipper);
            const flip = flipper.animate(group === 'discard' ? [
                { transform: 'rotateY(180deg)' }, { transform: 'rotateY(0)', offset: .4 },
                { transform: 'rotateY(0)', offset: .7 }, { transform: 'rotateY(180deg)' }
            ] : [
                { transform: `rotateY(${sourceHidden ? 180 : 0}deg)` },
                { transform: `rotateY(${targetHidden ? 180 : 0}deg)` }
            ], { duration, delay: stagger * i, fill: 'both', easing: 'ease-in-out' });
            this.animations.add(flip);
            const width = end.width || 65, height = end.height || 91;
            const startX = start.width / width, startY = start.height / height;
            const lift = group === 'reveal' ? 1.8 : 1.08;
            ghost.style.cssText = `left:${start.x}px;top:${start.y}px;width:${width}px;height:${height}px;--card-w:${width}px`;

            document.body.append(ghost);
            const dx = end.x - start.x, dy = end.y - start.y;
            const animation = ghost.animate([
                { transform: `translate(0, 0) rotate(-8deg) scale(${startX}, ${startY})` },
                { transform: `translate(${dx * .5 + (group === 'shuffle' ? (i % 3 - 1) * 40 : 0)}px, ${dy * .5 - (reduced ? 0 : 65)}px) rotate(4deg) scale(${(startX + 1) / 2 * lift}, ${(startY + 1) / 2 * lift})` },
                { transform: `translate(${dx}px, ${dy}px) rotate(0) scale(1)` }
            ], { duration, delay: stagger * i, easing: 'cubic-bezier(.2,.65,.3,1)', fill: 'both' });
            this.animations.add(animation);
            animations.push(animation.finished.catch(() => undefined).then(() => {
                this.animations.delete(animation); this.animations.delete(flip); ghost.remove(); if (destination) destination.style.visibility = '';
                for (const [key, delta] of [[zoneKey(event.from), -1], [zoneKey(event.to), 1]] as const) {
                    previousCounts.set(key, (previousCounts.get(key) ?? 0) + delta);
                    document.querySelectorAll<HTMLElement>('[data-count]').forEach(el => {
                        if (el.dataset.count === key) el.textContent = String(previousCounts.get(key));
                    });
                }
            }));
        }
        await Promise.all(animations);
    }
}
