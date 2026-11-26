import { card } from './cardEffects.js';

export default [
    card('CC01', 'Head to {destination} and collect salary.', { kind: 'advance', destination: 'go' }),
    card('CC02', 'Bank correction. Collect $200.', { kind: 'bank', amount: 200 }),
    card('CC03', 'Pay $50 for a checkup.', { kind: 'bank', amount: -50 }),
    card('CC04', 'Stock sale. Collect $50.', { kind: 'bank', amount: 50 }),
    card('CC05', 'Get out of hell. Keep this card until used.', { kind: 'escape' }),
    card('CC06', 'Go straight to Hell.', { kind: 'hell' }),
    card('CC07', 'Holiday savings mature. Collect $100.', { kind: 'bank', amount: 100 }),
    card('CC08', 'Tax refund. Collect $20.', { kind: 'bank', amount: 20 }),
    card('CC09', 'Birthday gift. Collect $10 from each opponent.', { kind: 'opponents', amount: 10 }),
    card('CC10', 'Life insurance pays $100.', { kind: 'bank', amount: 100 }),
    card('CC11', 'Hospital bill: pay $100.', { kind: 'bank', amount: -100 }),
    card('CC12', 'Tuition bill: pay $50.', { kind: 'bank', amount: -50 }),
    card('CC13', 'Consulting fee. Collect $25.', { kind: 'bank', amount: 25 }),
    card('CC14', 'Street repairs cost $40 per house and $115 per hotel.', { kind: 'repairs', house: 40, hotel: 115 }),
    card('CC15', 'Contest prize. Collect $10.', { kind: 'bank', amount: 10 }),
    card('CC16', 'Inheritance. Collect $100.', { kind: 'bank', amount: 100 })
];
