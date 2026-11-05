import { createDeck, MONEY } from './rules.js';
import { results } from './scoring.js';
import type { Phase, StatusCard, MoneyCard, GameEvent, Move, View, Result } from './types.js';

export class Engine {
    deck: Array<StatusCard>;
    current: StatusCard | null = null;
    phase: Phase = 'auction';
    endCardsRevealed = 0;
    turn = 0;
    starter = 0;
    round = 0;
    hands: Array<Array<MoneyCard>>;
    table: Array<Array<MoneyCard>>;
    status: Array<Array<StatusCard>>;
    spent: Array<number>;
    passed: Array<boolean>;
    pendingFauxPas: Array<boolean>;
    highest = 0;
    highestBidder = -1;
    events: Array<GameEvent> = [];
    result?: Result;

    constructor({ seats = 4, rng = Math.random }: { seats?: number; rng?: () => number } = {}) {
        if (!Number.isInteger(seats) || seats < 3 || seats > 5) throw new Error('Choose 3–5 seats');
        this.deck = createDeck();
        for (let i = this.deck.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
        }
        this.hands = Array.from({ length: seats }, () => MONEY.map(value => ({ id: value, value })));
        this.table = Array.from({ length: seats }, () => []);
        this.status = Array.from({ length: seats }, () => []);
        this.spent = Array(seats).fill(0);
        this.passed = Array(seats).fill(false);
        this.pendingFauxPas = Array(seats).fill(false);
        this.reveal();
    }
    private emit(event: Omit<GameEvent, 'seq'>): void {
        this.events.push({ ...event, seq: this.events.length + 1 });
    }
    private reveal(): void {
        this.current = this.deck.pop() ?? null;
        this.round++;
        this.turn = this.starter;
        this.highest = 0;
        this.highestBidder = -1;
        this.passed.fill(false);
        if (this.current?.end) {
            this.endCardsRevealed++;
            this.emit({ type: 'endCard', card: this.current });
        }
        this.emit({ type: 'reveal', ...(this.current ? { card: this.current } : {}) });
        if (!this.current || this.endCardsRevealed === 4) {
            this.phase = 'gameEnd';
            this.result = results(this.status, this.hands);
            this.emit({ type: 'finish' });
        } else this.phase = ['luxury', 'prestige'].includes(this.current.kind) ? 'auction' : 'disgrace';
    }
    dispatch(seat: number, move: Move, auto = false): string | null {
        if (!Number.isInteger(seat) || seat < 0 || seat >= this.hands.length) return 'You are watching';
        if (!move || typeof move.action !== 'string') return 'Invalid move';
        if (this.phase === 'gameEnd') return 'The game has ended';
        if (seat !== this.turn) return 'Wait for your turn';
        if (this.phase === 'fauxPas') {
            if (move.action !== 'CHOOSE_DISCARD') return 'Choose a luxury to discard';
            const card = this.status[seat].find(c => c.id === move.id && c.kind === 'luxury');
            if (!card) return 'Choose one of your luxury cards';
            this.discardLuxury(seat, card);
            this.reveal();
            return null;
        }
        if (move.action === 'BID') {
            if (!Array.isArray(move.cards) || !move.cards.length || new Set(move.cards).size !== move.cards.length)
                return 'Select at least one distinct money card';
            const cards: Array<MoneyCard> = [];
            for (const id of move.cards) {
                const card = this.hands[seat].find(c => c.id === id);
                if (!card) return 'Money card is not in your hand';
                cards.push(card);
            }
            const total = [...this.table[seat], ...cards].reduce((sum, c) => sum + c.value, 0);
            if (total <= this.highest) return 'Your total bid must exceed the highest bid';
            this.hands[seat] = this.hands[seat].filter(c => !move.cards!.includes(c.id));
            this.table[seat].push(...cards);
            this.highest = total;
            this.highestBidder = seat;
            this.emit({ type: 'bid', seat, cards });
            this.next();
            return null;
        }
        if (move.action !== 'PASS') return 'Invalid auction action';
        this.emit({ type: 'pass', seat, ...(auto && isForcedPass(this, seat) ? { auto: true } : {}) });
        if (this.table[seat].length) this.emit({ type: 'returnMoney', seat, cards: [...this.table[seat]] });
        this.hands[seat].push(...this.table[seat]);
        this.hands[seat].sort((a, b) => a.value - b.value);
        this.table[seat] = [];
        if (this.phase === 'disgrace') this.award(seat);
        else {
            this.passed[seat] = true;
            const active = this.passed.map((p, i) => p ? -1 : i).filter(i => i >= 0);
            if (active.length === 1) this.award(active[0]);
            else this.next();
        }
        return null;
    }
    private next(): void {
        do this.turn = (this.turn + 1) % this.hands.length;
        while (this.passed[this.turn]);
    }
    private discardLuxury(seat: number, card: StatusCard): void {
        this.status[seat] = this.status[seat].filter(c => c.id !== card.id);
        this.pendingFauxPas[seat] = false;
        this.emit({ type: 'fauxPasDiscard', seat, card });
    }
    private award(seat: number): void {
        const card = this.current!;
        this.emit({ type: this.phase === 'disgrace' ? 'disgrace' : 'award', seat, card });
        for (let i = 0; i < this.table.length; i++) {
            // Spent denominations are not included in events or views.
            if (this.table[i].length) this.emit({ type: 'discardMoney', seat: i });
            this.spent[i] += this.table[i].reduce((sum, c) => sum + c.value, 0);
            this.table[i] = [];
        }
        this.starter = this.turn = seat;
        if (card.kind === 'faux-pas') {
            const luxuries = this.status[seat].filter(c => c.kind === 'luxury');
            this.pendingFauxPas[seat] = true;
            if (luxuries.length > 1) {
                this.phase = 'fauxPas';
                return;
            }
            if (luxuries.length === 1) this.discardLuxury(seat, luxuries[0]);
        } else if (card.kind === 'luxury' && this.pendingFauxPas[seat]) {
            this.emit({ type: 'fauxPasDiscard', seat, card });
            this.pendingFauxPas[seat] = false;
        } else this.status[seat].push(card);
        this.reveal();
    }
    view(seat: number, seen = 0): View {
        const mine = this.hands[seat] ?? [];
        const canPass = seat === this.turn && !this.passed[seat] && ['auction', 'disgrace'].includes(this.phase);
        return {
            phase: this.phase, current: this.current ? { ...this.current } : null,
            deckRemaining: this.deck.length, endCardsRevealed: this.endCardsRevealed,
            turn: this.turn, starter: this.starter, round: this.round,
            highest: this.highest, highestBidder: this.highestBidder,
            players: this.hands.map((hand, i) => ({
                status: this.status[i].map(c => ({ ...c })), table: this.table[i].map(c => ({ ...c })),
                tableTotal: this.table[i].reduce((sum, c) => sum + c.value, 0),
                passed: this.passed[i], handCount: hand.length, pendingFauxPas: this.pendingFauxPas[i]
            })),
            myHand: mine.map(c => ({ ...c })),
            legal: { canPass, minNewTotal: this.highest + 1,
                canBid: canPass && canBid(this, seat), forcedPass: isForcedPass(this, seat) },
            autoPass: null,
            events: this.events.filter(e => e.seq > seen).map(e => ({ ...e,
                ...(e.cards ? { cards: e.cards.map(c => ({ ...c })) } : {}) })),
            ...(this.result ? { result: this.result } : {})
        };
    }
}

export function canBid(state: Pick<Engine, 'hands' | 'table' | 'highest'>, seat: number): boolean {
    const hand = state.hands[seat];
    return !!hand?.length && [...hand, ...state.table[seat]].reduce((sum, c) => sum + c.value, 0) > state.highest;
}

export function isForcedPass(state: Pick<Engine, 'hands' | 'table' | 'highest' | 'phase' | 'turn' | 'passed'>,
    seat: number): boolean {
    return seat === state.turn && ['auction', 'disgrace'].includes(state.phase) && !state.passed[seat] && !canBid(state, seat);
}
