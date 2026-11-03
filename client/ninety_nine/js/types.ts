import type { PhysicalCard, ResolvedDef, Variant } from './variants/schema.js';
export interface Card extends PhysicalCard {
    iid: string;
}
export interface CardView {
    iid: string; rank?: Card['rank']; suit?: Card['suit']; def?: ResolvedDef;
}
export type Zone = 'deck' | 'discard' | { hand: number };
export type EventGroup = 'gather' | 'shuffle' | 'deal' | 'play' | 'draw' | 'recycle' | 'steal' | 'combine' | 'reveal';
export interface MoveEvent {
    seq: number; card: CardView; from: Zone; to: Zone; group: Exclude<EventGroup, 'reveal'>;
}
export interface RevealEvent {
    seq: number; seat: number; cards: Array<CardView>; group: 'reveal';
}
export type GameEvent = MoveEvent | RevealEvent;
export interface Prompt {
    id: number; seat: number; kind: 'chooseNext' | 'steal'; text: string; options: Array<number>;
}
export interface LegalPlay {
    iid: string; choice?: number;
}
export interface LastPlay {
    seat: number; card: CardView; def: ResolvedDef; delta: number;
}
export interface View {
    variant: Variant; options: { seats: number; tokens: number };
    players: Array<{ hand: Array<CardView>; count: number; tokens: number; eliminated: boolean; revealed: boolean }>;
    deckCount: number; discardCount: number; top: CardView | null; discard: Array<CardView>;
    total: number; direction: 1 | -1; turn: number; dealer: number; handNumber: number;
    lastPlay: LastPlay | null; prompt: Prompt | null; skipped: Array<number>;
    phase: 'play' | 'bust' | 'gameEnd'; winner: number | null;
    log: Array<string>; events: Array<GameEvent>; playable: Array<string>;
    legal: Array<LegalPlay>; combinations: Array<Array<string>>;
}
export interface Move {
    action: string; iid?: string; choice?: number; targets?: Array<number>;
    iids?: Array<string>; promptId?: number; value?: number;
}
export interface Settings {
    variantId: string; seats: number; tokens: number;
}
export interface Sync {
    type: 'SYNC'; started: boolean; youAre: number; isHost: boolean;
    seats: Array<{ username: string; ready: boolean; connected: boolean; ai: boolean; eliminated: boolean }>;
    settings: Settings; variants?: Array<Variant>; token?: string; view?: View;
}
