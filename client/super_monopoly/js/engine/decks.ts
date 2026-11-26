import type { Rng } from '../../../shared/ts/seeded-random.js';
import type { Deck } from '../types.js';
import chance from '../cards/chance_us.js';
import chest from '../cards/community_chest_us.js';

export const cards = { chance, chest };

export function deckOf(id: string): Deck {
    return id.startsWith('CC') ? 'chest' : 'chance';
}

export function shuffle<T>(items: ReadonlyArray<T>, rng: Rng): Array<T> {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
        const j = rng.int(0, i);
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}
