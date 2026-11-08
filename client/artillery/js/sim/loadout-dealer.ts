import { Rng } from '../../../shared/ts/seeded-random.js';
import { defaultWeaponIdentifier, weaponDeckShuffleForkLabel, weaponRoundShuffleForkLabel } from '../config.js';

export function dealWeapons(weaponIdentifiers: ReadonlyArray<string>, seatIndices: ReadonlyArray<number>,
    weaponsPerPlayer: number, matchRandom: Rng, sandbox = false): Map<number, Map<string, number>> {
    if (!weaponIdentifiers.length || new Set(weaponIdentifiers).size !== weaponIdentifiers.length ||
        weaponIdentifiers.some(identifier => typeof identifier !== 'string' || !identifier.length) ||
        !Number.isInteger(weaponsPerPlayer) || weaponsPerPlayer <= 0 ||
        !seatIndices.length || new Set(seatIndices).size !== seatIndices.length ||
        seatIndices.some(seat => !Number.isInteger(seat) || seat < 0))
        throw new RangeError('Invalid weapon pool, seat list or loadout size');
    const hasDefault = weaponIdentifiers.includes(defaultWeaponIdentifier);
    const defaultCount = hasDefault ? 1 : 0;
    const pool = weaponIdentifiers.filter(identifier => identifier !== defaultWeaponIdentifier)
        .sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
    const seats = seatIndices.slice().sort((left, right) => left - right);
    const result = new Map<number, Map<string, number>>(seats.map(seat => [seat,
        new Map<string, number>(hasDefault ? [[defaultWeaponIdentifier, Infinity]] : [])]));
    if (sandbox) {
        for (const ammunition of result.values())
            for (const identifier of pool) ammunition.set(identifier, Infinity);
        return result;
    }
    if (!pool.length) return result;
    const shuffled = <Value>(items: ReadonlyArray<Value>, random: Rng): Array<Value> => {
        const values = items.slice();
        for (let index = values.length - 1; index > 0; index--) {
            const other = random.int(0, index);
            [values[index], values[other]] = [values[other], values[index]];
        }
        return values;
    };
    const deckRandom = matchRandom.fork(weaponDeckShuffleForkLabel);
    const roundRandom = matchRandom.fork(weaponRoundShuffleForkLabel);
    let deck = shuffled(pool, deckRandom);
    for (let round = 0; round < weaponsPerPlayer; round++)
        for (const seat of shuffled(seats, roundRandom.fork(round))) {
            const ammunition = result.get(seat) as Map<string, number>;
            const acceptable = (identifier: string): boolean => ammunition.size - defaultCount === pool.length ||
                !ammunition.has(identifier);
            let card = deck.findIndex(acceptable);
            if (card < 0) {
                deck = shuffled(pool, deckRandom);
                card = deck.findIndex(acceptable);
            }
            const identifier = deck.splice(card, 1)[0];
            ammunition.set(identifier, (ammunition.get(identifier) || 0) + 1);
        }
    return result;
}
