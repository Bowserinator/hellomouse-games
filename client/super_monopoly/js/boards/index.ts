import type { Card } from '../cards/cardEffects.js';
import { deckOf } from '../engine/decks.js';
import type { BoardDefinition, Deck, DeedTerms, Space } from '../types.js';
import chance from '../cards/chance_us.js';
import chest from '../cards/community_chest_us.js';
import classicUs from './classic_us.js';

export type Property = Space & { deed: DeedTerms };
export const isProperty = (space: Space): space is Property => !!space.deed;

const decks = new Map([['chance_us', chance], ['community_chest_us', chest]]);

type RegisteredBoard = BoardDefinition & { cards: Readonly<Record<Deck, ReadonlyArray<Card>>> };

export function register(board: BoardDefinition): RegisteredBoard {
    const { hell } = board;
    if (hell.spaces.length < 2 || hell.spaces[0]?.type !== 'visiting' ||
        !Number.isSafeInteger(hell.initialBail) || !Number.isSafeInteger(hell.minBail) ||
        hell.minBail < 0 || hell.initialBail < hell.minBail ||
        !Number.isSafeInteger(hell.reductionPerLap) || hell.reductionPerLap < 0) throw new Error(`Invalid Hell configuration for ${board.id}`);
    if (!board.terms.railroad || !board.terms.utility) throw new Error(`Invalid terms for ${board.id}`);

    const spaces = [...board.spaces, ...hell.spaces];
    const deeds = spaces.filter(isProperty);
    if (new Set(spaces.map(space => space.id)).size !== spaces.length ||
        board.spaces[0]?.id !== board.destinations.go || board.spaces[0]?.type !== 'go' ||
        !board.spaces.some(space => space.type === 'visiting' && space.id === board.destinations.gate))
        throw new Error(`Invalid spaces for ${board.id}`);

    const resolveDeck = (slot: Deck): ReadonlyArray<Card> => {
        const name = board.decks[slot];
        const deck = decks.get(name);
        if (!deck) throw new Error(`Unknown deck ${name} for ${board.id}`);
        for (const { id, effect } of deck) {
            if (deckOf(id) !== slot) throw new Error(`Invalid ${slot} deck ${name} for ${board.id}`);
            if ((effect.kind === 'advance' && !board.spaces.some(space => space.id === effect.destination)) ||
                (effect.kind === 'nearest' && !board.spaces.some(space => space.type === effect.type)))
                throw new Error(`Invalid destination for ${id} on ${board.id}`);
        }
        return Object.freeze(deck.map(card => {
            const { effect } = card;
            const destination = effect.kind === 'advance'
                ? board.spaces.find(space => space.id === effect.destination)?.name : undefined;
            const text = card.text.replace('{destination}', destination ?? '')
                .replace('{railroad}', board.terms.railroad).replace('{utility}', board.terms.utility);
            return Object.freeze({ ...card, text, effect: Object.freeze({ ...effect }) });
        }));
    };
    const cards = Object.freeze({ chance: resolveDeck('chance'), chest: resolveDeck('chest') });

    for (const { id, type, deed, tax } of spaces) {
        if (type === 'tax' && (tax === undefined || !Number.isSafeInteger(tax) || tax < 0))
            throw new Error(`Invalid tax on ${id} for ${board.id}`);
        const requiresDeed = type === 'street' || type === 'railroad' || type === 'utility';
        if (requiresDeed !== !!deed) throw new Error(`Invalid deed on ${id} for ${board.id}`);
        if (!deed) continue;
        const { price, mortgageValue, buildingCost, rent, groupId } = deed;
        if (typeof groupId !== 'string' || !groupId || !Number.isSafeInteger(price) || price <= 0 ||
            !Number.isSafeInteger(mortgageValue) || mortgageValue < 0 || mortgageValue > price ||
            !Number.isSafeInteger(buildingCost) || buildingCost % 2 !== 0 ||
            (type === 'street' ? buildingCost <= 0 : buildingCost !== 0) ||
            !Array.isArray(rent) || [...rent].some(value => !Number.isSafeInteger(value) || value < 0))
            throw new Error(`Invalid deed on ${id} for ${board.id}`);
    }
    const hellGroups = new Set(board.hell.spaces.filter(isProperty).map(space => space.deed.groupId));
    if (board.spaces.some(space => isProperty(space) && hellGroups.has(space.deed.groupId)))
        throw new Error(`Deed group crosses boards for ${board.id}`);

    for (const { type, deed } of deeds) {
        const { groupId, buildingCost, rent } = deed;
        const group = deeds.filter(space => space.deed.groupId === groupId);
        if (group.length < 2 || group.some(space => space.type !== type ||
            space.deed.buildingCost !== buildingCost) || rent.length !== (type === 'street' ? 6 : group.length) ||
            (type === 'street' && !Object.hasOwn(board.colors, groupId))) throw new Error(`Invalid group ${groupId}`);
        Object.freeze(deed.rent);
        Object.freeze(deed);
    }
    spaces.forEach(space => Object.freeze(space));
    Object.freeze(board.spaces);
    Object.freeze(board.hell.spaces);
    Object.freeze(board.hell);
    Object.freeze(board.colors);
    Object.freeze(board.dimensions);
    Object.freeze(board.destinations);
    Object.freeze(board.decks);
    return Object.freeze({ ...board, cards });
}

export const boards = Object.freeze({ classicUs: register(classicUs) });
