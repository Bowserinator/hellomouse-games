export type Phase = 'auction' | 'disgrace' | 'fauxPas' | 'gameEnd';
export interface StatusCard {
    id: string;
    kind: 'luxury' | 'prestige' | 'faux-pas' | 'passe' | 'scandale';
    value: number;
    label: string;
    end: boolean;
}
export interface MoneyCard {
    id: number;
    value: number;
}
export interface Move {
    action: string;
    cards?: Array<number>;
    id?: string;
    seats?: number;
    seat?: number;
    token?: string;
}
export interface GameEvent {
    seq: number;
    auto?: boolean;
    type: 'reveal' | 'bid' | 'pass' | 'returnMoney' | 'discardMoney' | 'award' | 'disgrace' |
    'fauxPasDiscard' | 'endCard' | 'finish';
    seat?: number;
    card?: StatusCard;
    cards?: Array<MoneyCard>;
}
export interface Score {
    luxury: number;
    penalty: number;
    multiplier: number;
    divisor: number;
    score: number;
    money: number;
    bestLuxury: number;
    castOut: boolean;
}
export interface Result {
    scores: Array<Score>;
    winners: Array<number>;
    hands: Array<Array<MoneyCard>>;
    tiebreak: string;
}
export interface PlayerView {
    status: Array<StatusCard>;
    table: Array<MoneyCard>;
    tableTotal: number;
    passed: boolean;
    handCount: number;
    pendingFauxPas: boolean;
}
export interface View {
    phase: Phase;
    current: StatusCard | null;
    deckRemaining: number;
    endCardsRevealed: number;
    turn: number;
    starter: number;
    round: number;
    highest: number;
    highestBidder: number;
    players: Array<PlayerView>;
    myHand: Array<MoneyCard>;
    legal: { canPass: boolean; minNewTotal: number; canBid: boolean; forcedPass: boolean };
    autoPass: { seat: number; remainingMs: number } | null;
    events: Array<GameEvent>;
    result?: Result;
}
export interface Settings {
    seats: number;
}
export interface SeatInfo {
    username: string;
    ready: boolean;
    ai: boolean;
    connected: boolean;
}
export interface Sync {
    type: 'SYNC';
    started: boolean;
    youAre: number;
    isHost: boolean;
    settings: Settings;
    seats: Array<SeatInfo>;
    token?: string;
    view?: View;
}
