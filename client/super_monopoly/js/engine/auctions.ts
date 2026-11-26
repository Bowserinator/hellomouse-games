import type { Property } from '../boards/index.js';
import type { Deed } from '../types.js';

export const BID_GRACE_MS = 500;

export function eligible(property: Property, group: ReadonlyArray<Property>, deeds: Record<string, Deed>): boolean {
    const deed = deeds[property.id];
    if (deed.owner !== null || deed.destroyed) return false;
    const others = group.filter(candidate => candidate.id !== property.id);
    const owner = deeds[others[0].id].owner;
    return owner === null || !others.every(({ id }) => !deeds[id].destroyed && deeds[id].owner === owner);
}
