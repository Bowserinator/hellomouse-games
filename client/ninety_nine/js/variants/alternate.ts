import { variant, add, choice, setTotal } from './schema.js';
export const ALTERNATE = variant('alternate', 'Alternate', 'Kings set 99; nines pass; tens reduce.', 'A', {}, [
    choice(['A'], [1, 11]), add(['4'], 0, '4 · reverse', [{ type: 'reverse' }]),
    add(['9'], 0), add(['10'], -10), add(['J', 'Q'], 10), setTotal(['K'], 99)
]);
