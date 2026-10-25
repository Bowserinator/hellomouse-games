import type { CardEvent, Filter, OwnerRef } from '../dsl/ast.js';
import type { CondCtx } from '../dsl/cond.js';
import type { FilterCtx } from '../dsl/filter.js';
import { isOwnerRef, matches } from '../dsl/filter.js';
import type { Iid } from '../ids.js';
import type { GameState, Zone } from '../state.js';
import { zoneOf } from '../zones.js';
import type { World } from './modifiers.js';
import { isUnicorn, unicornType } from './modifiers.js';

export function ownerOf(world: World, iid: Iid): number {
    const card = world.state.cards[iid];
    return card ? card.owner : -1;
}

export function filterCtx(world: World, self: number): FilterCtx {
    return {
        self,
        active: world.state.turn.player,
        defOf: iid => world.defOf(iid),
        isUnicorn: (iid, type) => isUnicorn(world, iid, type),
        ownerOf: iid => ownerOf(world, iid)
    };
}

function candidatesIn(state: GameState, zone: Zone): Array<Iid> {
    const out: Array<Iid> = [];
    if (zone === 'hand' || zone === 'stable') {
        for (const p of state.players) out.push(...(zone === 'hand' ? p.hand : p.stable));
        return out;
    }
    out.push(...state[zone]);
    return out;
}

export function countZone(
    world: World,
    self: number,
    zone: Zone,
    owner: OwnerRef,
    filter: Filter | undefined,
    event?: CardEvent
): number {
    const ctx = filterCtx(world, self);
    let total = 0;
    for (const iid of candidatesIn(world.state, zone)) {
        if (!isOwnerRef(owner, ownerOf(world, iid), ctx)) continue;
        if (matches(filter, iid, ctx)) total++;
    }
    return total;
}

export function condCtx(world: World, self: number, source: Iid | null, event?: CardEvent): CondCtx {
    return {
        ...filterCtx(world, self),
        event,
        source,
        zoneOf: iid => zoneOf(world.state, iid),
        countZone: (zone, owner, filter) => countZone(world, self, zone, owner, filter, event)
    };
}

export { unicornType };
