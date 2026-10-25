import type { Effect, Filter, OwnerRef, Primitive, Selector, CountSpec } from './ast.js';
import type { Zone } from '../state.js';

export function prim(p: Primitive): Effect {
    return { e: 'prim', prim: p };
}

export function seq(...steps: Array<Effect>): Effect {
    return { e: 'seq', steps };
}

export function sel(
    zone: Zone | 'any',
    owner: OwnerRef,
    count: CountSpec,
    extra: Partial<Selector> = {}
): Selector {
    return { zone, owner, count, ...extra };
}

export function allOf(...all: Array<Filter>): Filter {
    return { f: 'and', all };
}

export function anyOf(...any: Array<Filter>): Filter {
    return { f: 'or', any };
}

export function not(filter: Filter): Filter {
    return { f: 'not', not: filter };
}
