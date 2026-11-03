import { variant, add, choice, setTotal } from './schema.js';
export const HAWAIIAN = variant('hawaiian', 'Hawaiian', 'Fives reduce; nines and jacks set 99.', 'A', {}, [
    choice(['A'], [1, 11]), add(['3'], 3, '3 · skip', [{ type: 'skip' }]),
    add(['4'], 0, '4 · reverse', [{ type: 'reverse' }]), add(['5'], -5),
    setTotal(['9', 'J'], 99), add(['10'], -10), add(['Q'], 10), add(['K'], 0)
]);
