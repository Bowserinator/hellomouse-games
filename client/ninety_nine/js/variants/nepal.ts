import { variant, add, choice, setTotal } from './schema.js';
export const NEPAL = variant('nepal', 'Nepal', 'Twos set 99; nines pass; all faces add 10.', 'A', {}, [
    choice(['A'], [1, 11]), setTotal(['2'], 99),
    add(['4'], 0, '4 · reverse', [{ type: 'reverse' }]), add(['9'], 0),
    choice(['10'], [-10, 10]), add(['J', 'Q', 'K'], 10)
]);
