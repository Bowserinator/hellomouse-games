import type { Property } from '../boards/index.js';
import type { Deed } from '../types.js';
import { completeGroup } from './rent.js';

export const interest = (principal: number): number => Math.ceil(principal / 10);

export function management(property: Property, group: ReadonlyArray<Property>, deeds: Record<string, Deed>,
    owner: number, cash: number, houses: number, hotels: number, debt: boolean): Array<string> {
    const deed = deeds[property.id];
    if (deed.owner !== owner || deed.destroyed) return [];
    const { buildingCost, mortgageValue } = property.deed;
    const levels = group.map(({ id }) => deeds[id].level);
    const actions: Array<string> = [];
    if (deed.mortgaged) {
        if (!debt && cash >= mortgageValue + interest(mortgageValue)) actions.push('UNMORTGAGE');
    } else if (!levels.some(Boolean)) actions.push('MORTGAGE');
    if (!buildingCost) return actions;
    if (!debt && !group.some(({ id }) => deeds[id].mortgaged) && completeGroup(group, deeds, owner) &&
        deed.level === Math.min(...levels) && cash >= buildingCost &&
        (deed.level < 4 ? houses > 0 : deed.level === 4 && hotels > 0)) actions.push('BUILD');
    if (deed.level && deed.level === Math.max(...levels))
        if (deed.level < 5 || houses >= 4) actions.push('SELL');
        else actions.push('LIQUIDATE');

    return actions;
}
