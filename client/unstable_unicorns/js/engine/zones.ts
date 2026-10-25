import type { Iid } from './ids.js';
import type { GameState, Zone } from './state.js';

export const ZONES: Array<Zone> = ['hand', 'stable', 'deck', 'discard', 'nursery', 'limbo'];

export function zoneList(state: GameState, zone: Zone, owner = 0): Array<Iid> {
    if (zone === 'hand') return state.players[owner].hand;
    if (zone === 'stable') return state.players[owner].stable;
    return state[zone];
}

export function ownerOfZone(zone: Zone): boolean {
    return zone === 'hand' || zone === 'stable';
}

export function iidsIn(state: GameState, zone: Zone, owner?: number): Array<Iid> {
    if (ownerOfZone(zone)) {
        if (owner !== undefined) return [...zoneList(state, zone, owner)];
        const out: Array<Iid> = [];
        for (const p of state.players) out.push(...zoneList(state, zone, p.id));
        return out;
    }
    return [...zoneList(state, zone)];
}

export function zoneOf(state: GameState, iid: Iid): Zone | null {
    const card = state.cards[iid];
    return card ? card.zone : null;
}

export function assertInvariant(state: GameState) {
    const seen = new Set<Iid>();
    const listed: Array<{ iid: Iid; zone: Zone; owner?: number }> = [];
    const visit = (zone: Zone, list: Array<Iid>, owner?: number) => {
        for (const iid of list) {
            if (seen.has(iid)) throw new Error(`Invariant: ${iid} appears in more than one zone`);
            seen.add(iid);
            listed.push({ iid, zone, owner });
        }
    };

    for (const p of state.players) {
        visit('hand', p.hand, p.id);
        visit('stable', p.stable, p.id);
    }
    visit('deck', state.deck);
    visit('discard', state.discard);
    visit('nursery', state.nursery);
    visit('limbo', state.limbo);

    for (const { iid, zone, owner } of listed) {
        const card = state.cards[iid];
        if (!card) throw new Error(`Invariant: unknown card ${iid}`);
        if (card.zone !== zone)
            throw new Error(`Invariant: ${iid} is in ${zone} but marked ${card.zone}`);
        if (owner !== undefined && card.owner !== owner)
            throw new Error(`Invariant: ${iid} sits in player ${owner} but is owned by ${card.owner}`);
    }

    for (const iid of Object.keys(state.cards))
        if (!seen.has(iid)) throw new Error(`Invariant: ${iid} is in no zone`);
}
