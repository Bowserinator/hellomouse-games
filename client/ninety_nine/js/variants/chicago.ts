import { variant, add, choice, setTotal } from './schema.js';
export const CHICAGO = variant('chicago', 'Chicago', 'Threes and nines skip; kings set 99.', 'A', {}, [
    choice(['A'], [1, 11]), add(['3'], 3, '3 · skip', [{ type: 'skip' }]),
    add(['4'], 0, '4 · reverse', [{ type: 'reverse' }]),
    add(['9'], 0, '9 · skip', [{ type: 'skip' }]), add(['10'], -10),
    add(['J', 'Q'], 10), setTotal(['K'], 99)
]);
