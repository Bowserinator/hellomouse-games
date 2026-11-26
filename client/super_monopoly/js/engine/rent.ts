import type { Property } from '../boards/index.js';
import type { Deed } from '../types.js';

export function completeGroup(group: ReadonlyArray<Property>, deeds: Record<string, Deed>, owner: number): boolean {
    return group.every(({ id }) => !deeds[id].destroyed && deeds[id].owner === owner);
}

export function calculateRent(property: Property, group: ReadonlyArray<Property>, deeds: Record<string, Deed>,
    payer: number, dice: number, override?: 'railroad' | 'utility'): number {
    const { owner, level, mortgaged, destroyed } = deeds[property.id];
    if (owner === null || owner === payer || mortgaged || destroyed) return 0;
    const owned = group.filter(({ id }) => !deeds[id].destroyed && deeds[id].owner === owner).length;
    const { rent } = property.deed;
    if (property.type === 'railroad') return rent[owned - 1] * (override === 'railroad' ? 2 : 1);
    if (property.type === 'utility') return dice * (override === 'utility' ? 10 : rent[owned - 1]);
    return rent[level] * (level === 0 && owned === group.length ? 2 : 1);
}
