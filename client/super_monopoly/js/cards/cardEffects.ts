export type Effect =
    { kind: 'advance'; destination: string } |
    { kind: 'nearest'; type: 'railroad' | 'utility' } |
    { kind: 'back'; steps: number } |
    { kind: 'bank'; amount: number } |
    { kind: 'opponents'; amount: number } |
    { kind: 'repairs'; house: number; hotel: number } |
    { kind: 'escape' | 'hell' };

export interface Card {
    id: string;
    text: string;
    effect: Effect;
}

export function card(id: string, text: string, effect: Effect): Card {
    return { id, text, effect };
}
