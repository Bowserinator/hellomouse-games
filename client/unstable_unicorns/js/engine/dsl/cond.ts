import type { CardEvent, Cmp, Cond, EventType, Filter } from './ast.js';
import type { FilterCtx } from './filter.js';
import type { Iid } from '../ids.js';
import type { Zone } from '../state.js';

export interface CondCtx extends FilterCtx {
    event?: CardEvent;
    source: Iid | null;
    zoneOf(iid: Iid): Zone | null;
    countZone(zone: Zone, owner: import('./ast.js').OwnerRef, filter?: Filter): number;
}

export function compare(cmp: Cmp, value: number, n: number): boolean {
    switch (cmp) {
        case 'lt': return value < n;
        case 'lte': return value <= n;
        case 'eq': return value === n;
        case 'gte': return value >= n;
        case 'gt': return value > n;
        default: return false;
    }
}

export function holds(cond: Cond | undefined, ctx: CondCtx): boolean {
    if (!cond) return true;
    switch (cond.c) {
        case 'event':
            return ctx.event?.type === cond.type;
        case 'count':
            return compare(cond.cmp, ctx.countZone(cond.zone, cond.owner, cond.filter), cond.n);
        case 'selfInStable': {
            if (!ctx.source) return false;
            return ctx.zoneOf(ctx.source) === 'stable' && ctx.ownerOf(ctx.source) === ctx.self;
        }
        case 'and':
            return cond.all.every(sub => holds(sub, ctx));
        case 'or':
            return cond.any.some(sub => holds(sub, ctx));
        case 'not':
            return !holds(cond.not, ctx);
        default:
            return false;
    }
}

export function eventMatches(type: EventType, event: CardEvent | undefined): boolean {
    return !!event && event.type === type;
}
