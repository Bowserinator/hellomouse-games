import { variant, add, setTotal, suited, copyLast } from './schema.js';
export const BALTIMORE = variant('baltimore', 'Baltimore', 'Sevens copy; sixes steal; combine two kings or queens for +10.', 'B',
    { combine: [{ ranks: ['K', 'Q'], size: 2, value: 10, draw: 2 }] }, [
        add(['A'], 1), add(['3', '4'], 0, '3/4 · reverse', [{ type: 'reverse' }]),
        add(['6'], 6, '6 · steal a random card; victim draws', [{ type: 'steal' }]), copyLast(['7']), add(['8'], 2),
        add(['9'], 0), add(['10'], -10),
        suited(setTotal(['J'], 99, 'One-eyed jack · sets 99'), ['Spades', 'Hearts']), add(['J', 'Q', 'K'], 10)
    ]);
