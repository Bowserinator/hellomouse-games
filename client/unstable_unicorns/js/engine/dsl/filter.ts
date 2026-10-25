import type { Filter, Kind, OwnerRef, UnicornType } from './ast.js';
import type { Iid } from '../ids.js';
import { WILDCARD } from '../../vars.js';

export interface FilterCtx {
    self: number;
    active: number;
    defOf(iid: Iid): { id?: string; kind: Kind; tags?: Array<string>; unicornType?: UnicornType } | undefined;
    isUnicorn(iid: Iid, type?: UnicornType): boolean;
    ownerOf(iid: Iid): number;
}

export function isOwnerRef(ref: OwnerRef, owner: number, ctx: FilterCtx): boolean {
    if (ref === 'any') return true;
    if (ref === 'self') return owner === ctx.self;
    if (ref === 'active') return owner === ctx.active;
    return owner !== ctx.self;
}

export function matches(filter: Filter | undefined, iid: Iid, ctx: FilterCtx): boolean {
    if (!filter) return true;
    if (ctx.defOf(iid)?.id === WILDCARD) return true;
    switch (filter.f) {
        case 'type': {
            const def = ctx.defOf(iid);
            return !!def && def.kind === filter.type;
        }
        case 'tag': {
            const def = ctx.defOf(iid);
            return !!def && !!def.tags && def.tags.includes(filter.tag);
        }
        case 'unicorn':
            return ctx.isUnicorn(iid, filter.unicorn);
        case 'owner':
            return isOwnerRef(filter.owner, ctx.ownerOf(iid), ctx);
        case 'and':
            return filter.all.every(sub => matches(sub, iid, ctx));
        case 'or':
            return filter.any.some(sub => matches(sub, iid, ctx));
        case 'not':
            return !matches(filter.not, iid, ctx);
        default:
            return false;
    }
}
