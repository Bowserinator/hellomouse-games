import { card } from './cardEffects.js';

export default [
    card('C01', 'Head to Boardwalk.', { kind: 'advance', destination: 'boardwalk' }),
    card('C02', 'Head to GO and collect salary.', { kind: 'advance', destination: 'go' }),
    card('C03', 'Head to Illinois Avenue.', { kind: 'advance', destination: 'illinois_avenue' }),
    card('C04', 'Head to St. Charles Place.', { kind: 'advance', destination: 'st_charles_place' }),
    card('C05', 'Next railroad. Pay double rent if owned.', { kind: 'nearest', type: 'railroad' }),
    card('C06', 'Next railroad. Pay double rent if owned.', { kind: 'nearest', type: 'railroad' }),
    card('C07', 'Next utility. Roll again for 10× rent if owned.', { kind: 'nearest', type: 'utility' }),
    card('C08', 'Investment payout. Collect $50.', { kind: 'bank', amount: 50 }),
    card('C09', 'Get out of hell. Keep this card until used.', { kind: 'escape' }),
    card('C10', 'Move back three spaces.', { kind: 'back', steps: 3 }),
    card('C11', 'Go straight to Hell.', { kind: 'hell' }),
    card('C12', 'Repairs cost $25 per house and $100 per hotel.', { kind: 'repairs', house: 25, hotel: 100 }),
    card('C13', 'Pay a $15 fine.', { kind: 'bank', amount: -15 }),
    card('C14', 'Head to Reading Railroad.', { kind: 'advance', destination: 'reading_railroad' }),
    card('C15', 'Pay each opponent $50.', { kind: 'opponents', amount: -50 }),
    card('C16', 'Loan matures. Collect $150.', { kind: 'bank', amount: 150 })
];
