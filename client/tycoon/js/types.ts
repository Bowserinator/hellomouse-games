export type Suit = 'Clubs' | 'Diamonds' | 'Hearts' | 'Spades';
export interface TCard {
    iid: string; value: number; suit: Suit | null; joker: boolean;
}
export interface CardView {
    iid: string; value: number | null; suit: Suit | null; joker: boolean | null;
}
export type Title = 'tycoon' | 'rich' | 'poor' | 'beggar';
export type Phase = 'exchange' | 'play' | 'roundEnd' | 'gameEnd';
export type Zone = 'deck' | 'discard' | 'table' | { hand: number };
export type EventGroup = 'gather' | 'shuffle' | 'deal' | 'reveal' | 'exchange' | 'play' | 'clear' | 'discard';
export interface MoveEvent {
    seq: number; card: CardView; from: Zone; to: Zone; group: EventGroup;
}
export interface PlaySet {
    cards: Array<CardView>; count: number; strength: number; owner: number;
    loneJoker: boolean; spade2OverJoker: boolean; rank: number;
}
export interface Move {
    action: string; iids?: unknown;
}
export interface RuleState {
    hands: Array<Array<CardView>>; phase: Phase; turn: number; table: PlaySet | null;
    revolution: boolean; options: { jokers: boolean };
}
export interface View extends RuleState {
    youAre: number; counts: Array<number>; deckCount: number; discard: Array<CardView>;
    tablePile: Array<CardView>; previous: PlaySet | null; passed: Array<number>; leader: number;
    titles: Array<Title | null>; scores: Array<number>; round: number; totalRounds: number;
    out: Array<number>; bankrupt: number | null; winners: Array<number>; playable: Array<string>;
    exchange: { count: number; to: number; received: Array<string> } | null;
    pendingExchange: Array<number>; log: Array<string>; events: Array<MoveEvent>;
}
export interface Seat {
    username: string; ready: boolean; connected: boolean; ai: boolean;
}
export interface Sync {
    type: 'SYNC'; started: boolean; youAre: number; isHost: boolean; seats: Array<Seat>;
    settings: { rounds: number; jokers: boolean }; token?: string; view?: View;
}
