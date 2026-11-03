import { variant, add, choice, setTotal, suited } from './schema.js';
export const TAIWANESE = variant('taiwanese', 'Taiwanese', 'Five cards; fives choose the next player; queens swing ±20.', 'B',
    { handSize: 5 }, [
        suited(setTotal(['A'], 0, 'Ace of spades · resets to 0'), ['Spades']), add(['A'], 1),
        add(['4'], 0, '4 · reverse', [{ type: 'reverse' }]),
        add(['5'], 0, '5 · choose next player', [{ type: 'chooseNext' }]),
        add(['9'], 9), choice(['10'], [-10, 10]), add(['J'], 0), choice(['Q'], [-20, 20]), setTotal(['K'], 99)
    ]);
