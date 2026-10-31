import type { CardEvent, Effect, EventType, Place } from './dsl/ast.js';
import type { EventLog } from './events.js';
import type { Iid } from './ids.js';
import type { CardInstance, GameState, Zone } from './state.js';
import { ownerOfZone, zoneList } from './zones.js';
import type { World } from './query/modifiers.js';
import { blocksOtherPlay, blocksTriggers, isUnicorn, protectedFrom } from './query/modifiers.js';
import { holds } from './dsl/cond.js';
import { condCtx } from './query/active.js';
import { findReplacements } from './query/replacements.js';
import type { ReplacementPlan } from './query/replacements.js';

export type Destination = Zone | { zone: Zone; owner?: number };

export interface MoveCtx extends World {
    log: EventLog;
    runReplacement(player: number, source: Iid, effect: Effect, event: CardEvent): void;
    order?: Array<Iid>;
    ignoredReplacements?: Array<Iid>;
}

export interface MoveOutcome {
    moved: boolean;
    from: Zone;
    to: Zone;
    replaced: boolean;
    shielded: boolean;
}

function destZone(dest: Destination): Zone {
    return typeof dest === 'string' ? dest : dest.zone;
}

function destOwner(card: CardInstance, dest: Destination): number {
    if (typeof dest === 'string' || dest.owner === undefined) return card.owner;
    return dest.owner;
}

function isShielded(ctx: MoveCtx, iid: Iid, cause: EventType, to: Zone): boolean {
    if (to === 'stable') return false;
    if (cause !== 'destroy' && cause !== 'sacrifice') return false;
    return protectedFrom(ctx, iid, cause);
}

function orderedPlans(plans: Array<ReplacementPlan>, order: Array<Iid> | undefined): Array<ReplacementPlan> {
    if (!order || order.length < 2) return plans;
    const rank = (plan: ReplacementPlan) => {
        if (plan.kind !== 'effect') return -1;
        const index = order.indexOf(plan.source);
        return index === -1 ? order.length : index;
    };
    return [...plans].sort((a, b) => rank(a) - rank(b));
}

export function placeOf(zone: Zone, owner: number): Place {
    return ownerOfZone(zone) ? { zone, owner } : { zone };
}

export function recordMove(log: EventLog, iid: Iid, from: Place, to: Place): void {
    log.record({ type: 'move', card: iid, from, to });
}

export function bulkMove(state: GameState, iids: Array<Iid>, to: Zone, owner?: number, log?: EventLog): void {
    for (const iid of iids) {
        const card = state.cards[iid];
        if (!card) continue;
        const from = placeOf(card.zone, card.owner);
        const source = zoneList(state, card.zone, card.owner);
        const index = source.indexOf(iid);
        if (index >= 0) source.splice(index, 1);
        card.zone = to;
        if (owner !== undefined) card.owner = owner;
        zoneList(state, to, card.owner).push(iid);
        if (log) recordMove(log, iid, from, placeOf(to, card.owner));
    }
}

export function moveCard(ctx: MoveCtx, iid: Iid, dest: Destination, cause: EventType): MoveOutcome {
    const card = ctx.state.cards[iid];
    if (!card) throw new Error(`Cannot move unknown card ${iid}`);

    const from = card.zone;
    const previousOwner = card.owner;
    let to = destZone(dest);
    const owner = destOwner(card, dest);

    if (isShielded(ctx, iid, cause, to)) return { moved: false, from, to, replaced: false, shielded: true };

    const def = ctx.defOf(iid);
    if (to === 'stable' && def &&
        (blocksOtherPlay(ctx, owner, previousOwner, def.kind, iid) ||
            !holds(def.playIf, condCtx(ctx, owner, iid))))
        return { moved: false, from, to, replaced: false, shielded: true };

    const event: CardEvent = { type: cause, card: iid, player: card.owner };
    const plans = orderedPlans(findReplacements(ctx, iid, event, ctx.ignoredReplacements), ctx.order);
    for (const plan of plans) {
        if (plan.kind === 'redirect') {
            to = plan.zone;
            break;
        }
        ctx.runReplacement(plan.player, plan.source, plan.effect, event);
        return { moved: false, from, to, replaced: true, shielded: false };
    }

    const wasUnicorn = from === 'stable' && isUnicorn(ctx, iid);
    const suppressed = wasUnicorn && blocksTriggers(ctx, previousOwner);
    const source = zoneList(ctx.state, from, card.owner);
    const index = source.indexOf(iid);
    if (index >= 0) source.splice(index, 1);

    card.zone = to;
    card.owner = owner;
    if (to === 'deck') zoneList(ctx.state, to).unshift(iid);
    else zoneList(ctx.state, to, owner).push(iid);

    const played = cause === 'play' && from === 'hand' && to === 'stable';
    ctx.log.emit({ type: cause, card: iid, player: from === 'stable' || played ? previousOwner : owner,
        from: placeOf(from, previousOwner), to: placeOf(to, owner),
        publicDefId: played ? def?.id : undefined,
        ...played && owner !== previousOwner ? { targetPlayer: owner } : {},
        unicorn: wasUnicorn, suppressed });
    if (from === 'stable' && (to !== 'stable' || owner !== previousOwner))
        ctx.log.emit({ type: 'leaveStable', card: iid, player: previousOwner, unicorn: wasUnicorn, suppressed });
    if (to === 'stable' && (from !== 'stable' || owner !== previousOwner))
        ctx.log.emit({ type: 'enterStable', card: iid, player: owner, unicorn: isUnicorn(ctx, iid) });

    return { moved: true, from, to, replaced: false, shielded: false };
}
