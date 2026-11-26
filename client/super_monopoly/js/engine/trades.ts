import type { Property } from '../boards/index.js';
import type { Deed, TradeSide } from '../types.js';
import { interest } from './propertyManagement.js';
import type { Player } from './state.js';

function ids(value: unknown): value is Array<string> {
    return Array.isArray(value) && value.length <= 32 && value.every(id => typeof id === 'string') &&
        new Set(value).size === value.length;
}

export function tradeSide(value: unknown): TradeSide | null {
    if (!value || typeof value !== 'object') return null;
    const { cash, deeds, cards, release } = value as Record<string, unknown>;
    if (typeof cash !== 'number' || !Number.isSafeInteger(cash) || cash < 0 ||
        !ids(deeds) || !ids(cards) || !ids(release)) return null;
    return { cash, deeds, cards, release };
}

export function ownsOffer(side: TradeSide, player: Player, seat: number, deeds: Record<string, Deed>,
    properties: ReadonlyArray<Property>): boolean {
    return player.cash - player.reserved >= side.cash && side.cards.every(id => player.cards.includes(id)) &&
        side.release.every(id => side.deeds.includes(id) && deeds[id]?.mortgaged) && side.deeds.every(id => {
        const property = properties.find(item => item.id === id);
        return property && deeds[id].owner === seat && !deeds[id].destroyed && !properties.some(item =>
            item.deed.groupId === property.deed.groupId && deeds[item.id].level > 0);
    });
}

export function mortgageFee(property: Property, release: boolean): number {
    const principal = property.deed.mortgageValue;
    return interest(principal) + (release ? principal : 0);
}
