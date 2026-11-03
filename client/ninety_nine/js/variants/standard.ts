import { variant, add, choice, setTotal } from './schema.js';
export const STANDARD = variant('standard', 'Standard', '9 sets 99; 4 reverses; 10 swings ±10.', 'A', {}, [
    choice(['A'], [1, 11], 'Ace: 1 or 11'),
    add(['3'], 3, '3 · skip', [{ type: 'skip' }]),
    add(['4'], 0, '4 · reverse', [{ type: 'reverse' }]),
    setTotal(['9'], 99, '9 · sets 99'),
    choice(['10'], [-10, 10], '10: −10 or +10'),
    add(['J', 'Q'], 10, 'J/Q · 10'), add(['K'], 0, 'K · pass')
]);
