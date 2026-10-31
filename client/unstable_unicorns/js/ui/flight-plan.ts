import type { Place } from '../engine/dsl/ast.js';
import type { LoggedEvent } from '../engine/events.js';

export const FLIGHT_MS = 448;

const STAGGER_MS = 98;
const MAX_TOTAL_STAGGER_MS = 1800;
const MAX_STEPS = 40;
const MAX_PER_ROUTE = 12;

export interface FlightStep {
    iid: string;
    from: Place;
    to: Place;
    first: boolean;
    last: boolean;
    delay: number;
}

export function samePlace(a: Place, b: Place): boolean {
    return a.zone === b.zone && a.owner === b.owner;
}

function routeKey(step: { from: Place; to: Place }): string {
    return `${step.from.zone}:${step.from.owner ?? ''}>${step.to.zone}:${step.to.owner ?? ''}`;
}

// Turns logged card movements into a staggered flight schedule.
// A card that moves several times flies each leg in order.
export function planFlights(events: Array<LoggedEvent>): Array<FlightStep> {
    const moves = events.filter(event => event.card !== undefined && event.from && event.to &&
        !samePlace(event.from, event.to));

    const perRoute = new Map<string, number>();
    const kept: Array<{ iid: string; from: Place; to: Place }> = [];
    for (const event of moves) {
        const step = { iid: event.card as string, from: event.from as Place, to: event.to as Place };
        const key = routeKey(step);
        const used = perRoute.get(key) ?? 0;
        if (used >= MAX_PER_ROUTE || kept.length >= MAX_STEPS) continue;
        perRoute.set(key, used + 1);
        kept.push(step);
    }

    const firstSeen = new Set<string>();
    const lastIndex = new Map<string, number>();
    kept.forEach((step, index) => lastIndex.set(step.iid, index));

    const stagger = Math.min(STAGGER_MS, MAX_TOTAL_STAGGER_MS / Math.max(kept.length, 1));
    const landsAt = new Map<string, number>();
    return kept.map((step, index) => {
        const first = !firstSeen.has(step.iid);
        firstSeen.add(step.iid);
        const delay = Math.max(index * stagger, landsAt.get(step.iid) ?? 0);
        landsAt.set(step.iid, delay + FLIGHT_MS);
        return { ...step, first, last: lastIndex.get(step.iid) === index, delay };
    });
}
