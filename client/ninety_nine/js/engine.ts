import Deck from '../../bullshit/js/game/deck.js';
import { EFFECTS } from './effects/index.js';
import type { PlayContext } from './effects/index.js';
import { resolveCard, RANKS } from './variants/schema.js';
import type { ResolvedDef, Variant, ValueDef, Suit } from './variants/schema.js';
import type { Card, CardView, Zone, MoveEvent, GameEvent, View, Move, Prompt, LastPlay, LegalPlay } from './types.js';

export class Engine {
    readonly variant: Variant;
    readonly options: { seats: number; tokens: number };
    hands: Array<Array<Card>>;
    deck: Array<Card> = [];
    discard: Array<Card> = [];
    total = 0;
    direction: 1 | -1 = 1;
    turn = 0;
    dealer = 0;
    tokens: Array<number>;
    eliminated: Array<boolean>;
    handNumber = 0;
    playsThisHand = 0;
    lastPlay: LastPlay | null = null;
    pending: Prompt | null = null;
    phase: View['phase'] = 'play';
    winner: number | null = null;
    log: Array<string> = [];
    events: Array<GameEvent> = [];
    skipped: Array<number> = [];
    private revealed = new Set<number>();
    private rng: () => number;
    private seq = 0;
    private promptSeq = 0;
    private context: PlayContext | null = null;
    private effectQueue: ResolvedDef['effects'] = [];
    private replacementCount = 1;
    private chosenNext: number | null = null;

    constructor(options: { variant: Variant; seats: number; tokens: number; rng?: () => number }) {
        if (!Number.isInteger(options.seats) || options.seats < 2 || options.seats > 8 ||
            !Number.isInteger(options.tokens) || options.tokens < 1 || options.tokens > 10)
            throw new Error('Seats must be 2–8 and tokens 1–10');
        this.variant = options.variant;
        this.options = { seats: options.seats, tokens: options.tokens };
        this.rng = options.rng ?? Math.random;
        this.hands = Array.from({ length: options.seats }, () => []);
        this.tokens = Array(options.seats).fill(options.tokens);
        this.eliminated = Array(options.seats).fill(false);
        const cards: Array<Omit<Card, 'iid'>> = [];
        for (let d = 0; d < (options.seats > 6 ? 2 : 1); d++) {
            for (const card of Deck.generateDefaultDeck().cards)
                cards.push({ rank: RANKS[card.value - 1], suit: card.suit as Suit });
            for (let j = 0; j < this.variant.rules.jokers; j++) cards.push({ rank: 'JOKER', suit: 'Clubs' });
        }
        // Opaque identities must not encode a hidden card's rank or suit.
        for (let i = cards.length - 1; i > 0; i--) {
            const j = Math.floor(this.rng() * (i + 1));
            [cards[i], cards[j]] = [cards[j], cards[i]];
        }
        this.deck = cards.map((card, i) => ({ ...card, iid: `c${i}` }));
        this.startHand(false);
    }
    private zone(place: Zone): Array<Card> {
        return typeof place === 'string' ? this[place] : this.hands[place.hand];
    }
    private cardView(card: Card, visible: boolean): CardView {
        return visible ? { ...card, def: resolveCard(this.variant, card) } : { iid: card.iid };
    }
    private move(card: Card, from: Zone, to: Zone, group: MoveEvent['group']): void {
        const source = this.zone(from);
        const index = source.indexOf(card);
        if (index === -1) throw new Error('Card is not in its source zone');
        source.splice(index, 1);
        this.zone(to).push(card);
        this.events.push({ seq: ++this.seq, card: this.cardView(card, true), from, to, group });
    }
    private shuffle(): void {
        for (let i = this.deck.length - 1; i > 0; i--) {
            const j = Math.floor(this.rng() * (i + 1));
            [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
        }
        // Record the resulting order so event replay also reproduces the deck.
        for (const card of [...this.deck]) this.move(card, 'deck', 'deck', 'shuffle');
    }
    private next(seat: number, direction = this.direction): number {
        do seat = (seat + direction + this.hands.length) % this.hands.length; while (this.eliminated[seat]);
        return seat;
    }
    private message(text: string): void {
        this.log.push(text);
        if (this.log.length > 80) this.log.shift();
    }
    private startHand(rotate = true): void {
        for (let i = 0; i < this.hands.length; i++)
            for (const card of [...this.hands[i]]) this.move(card, { hand: i }, 'deck', 'gather');
        for (const card of [...this.discard]) this.move(card, 'discard', 'deck', 'gather');
        if (rotate) this.dealer = this.next(this.dealer, 1);
        this.direction = 1;
        this.total = 0;
        this.handNumber++;
        this.playsThisHand = 0;
        this.lastPlay = null;
        this.pending = null;
        this.context = null;
        this.revealed.clear();
        this.skipped = [];
        this.phase = 'play';
        this.shuffle();
        const first = this.next(this.dealer, 1);
        for (let round = 0; round < this.variant.rules.handSize; round++) {
            let seat = first;
            do {
                this.draw(seat, 'deal');
                seat = this.next(seat, 1);
            } while (seat !== first);
        }
        this.turn = first;
        this.message(`Hand ${this.handNumber} · Player ${first + 1} starts`);
    }
    private draw(seat: number, group: 'deal' | 'draw' = 'draw'): void {
        if (!this.deck.length && this.discard.length > 1) {
            for (const card of this.discard.slice(0, -1)) this.move(card, 'discard', 'deck', 'recycle');
            this.shuffle();
        }
        const card = this.deck.at(-1);
        if (card) this.move(card, 'deck', { hand: seat }, group);
    }
    private resolve(card: Card): ResolvedDef {
        const def = resolveCard(this.variant, card);
        if (def.value.type !== 'copy') return def;
        return this.lastPlay?.def ?? { ...def, value: { type: 'add', n: 0 }, effects: [] };
    }
    private applied(value: ValueDef, selection?: number): number {
        if (value.type === 'set') return value.total;
        const delta = value.type === 'add' ? value.n : value.type === 'choice' ? selection ?? NaN : 0;
        return Math.max(this.variant.rules.floor, this.total + delta);
    }
    legalPlays(seat: number): Array<LegalPlay> {
        if (this.phase !== 'play' || this.pending || this.turn !== seat) return [];
        return this.hands[seat].flatMap(card => {
            const def = this.resolve(card);
            const choices: Array<number | undefined> = def.value.type === 'choice' ? def.value.options : [undefined];
            return choices.filter(option => this.applied(def.value, option) <= this.variant.rules.totalLimit)
                .map(option => ({ iid: card.iid, ...(option !== undefined ? { choice: option } : {}) }));
        });
    }
    private combinations(seat: number): Array<Array<string>> {
        if (this.phase !== 'play' || this.pending || seat !== this.turn) return [];
        const result: Array<Array<string>> = [];
        for (const rule of this.variant.rules.combine ?? []) {
            if (this.total + rule.value > this.variant.rules.totalLimit) continue;
            const cards = this.hands[seat].filter(card => rule.ranks.includes(card.rank));
            if (rule.size === 2)
                for (let i = 0; i < cards.length; i++)
                    for (let j = i + 1; j < cards.length; j++) result.push([cards[i].iid, cards[j].iid]);
        }
        return result;
    }
    dispatch(seat: number, move: Move): string | null {
        if (!Number.isInteger(seat) || seat < 0 || seat >= this.hands.length) return 'Invalid seat';
        if (move.action === 'CONTINUE') {
            if (this.phase !== 'bust') return 'No hand to continue';
            this.startHand();
            return null;
        }
        if (this.phase !== 'play' || seat !== (this.pending?.seat ?? this.turn)) return 'Wait for your turn';
        if (this.pending) {
            if (move.action !== 'CHOOSE' || move.promptId !== this.pending.id ||
                !this.pending.options.includes(move.value as number)) return 'Choose a valid target';
            this.applyTarget(this.pending.kind, move.value as number);
            this.pending = null;
            this.continueEffects();
            return null;
        }
        if (move.action === 'COMBINE') {
            const iids = move.iids;
            if (!Array.isArray(iids) || !this.combinations(seat).some(ids =>
                ids.length === iids.length && ids.every(id => iids.includes(id)))) return 'Invalid combination';
            const cards = iids.map(id => this.hands[seat].find(card => card.iid === id)!);
            const rule = this.variant.rules.combine!
                .find(entry => cards.every(card => entry.ranks.includes(card.rank)))!;
            const def: ResolvedDef = { id: 'combine', label: 'Combined faces', match: { ranks: cards.map(card => card.rank) },
                value: { type: 'add', n: rule.value } };
            this.beginPlay(cards, def, undefined, rule.draw, 'combine');
            return null;
        }
        if (move.action !== 'PLAY') return 'Unknown move';
        const card = this.hands[seat].find(entry => entry.iid === move.iid);
        if (!card) return 'Card is not in your hand';
        const def = this.resolve(card);
        if (def.value.type === 'choice' && !def.value.options.includes(move.choice as number)) return 'Choose a legal value';
        if (this.applied(def.value, move.choice) > this.variant.rules.totalLimit) return 'That card would bust';
        this.beginPlay([card], def, move.choice, 1, 'play');
        return null;
    }
    private beginPlay(cards: Array<Card>, def: ResolvedDef, selection: number | undefined, draws: number,
        group: 'play' | 'combine'): void {
        const previous = this.total;
        this.total = this.applied(def.value, selection);
        this.skipped = [];
        this.chosenNext = null;
        this.replacementCount = draws;
        this.context = { direction: this.direction, skip: 0, extraTurn: false,
            twoPlayer: this.tokens.filter(n => n > 0).length === 2 && this.variant.rules.twoPlayerExtraTurn,
            targets: this.tokens.flatMap((n, i) => n > 0 && i !== this.turn ? [i] : []) };
        for (const card of cards) this.move(card, { hand: this.turn }, 'discard', group);
        // Copy stores a resolved delta, not a fresh choice prompt.
        const appliedDef = def.value.type === 'choice' ? { ...def, value: { type: 'add' as const, n: selection! } } : def;
        this.lastPlay = { seat: this.turn, card: this.cardView(cards[cards.length - 1], true), def: appliedDef,
            delta: this.total - previous };
        this.message(`Player ${this.turn + 1} played ${cards.map(card => card.rank).join(' + ')} → ${this.total - previous >= 0 ? '+' : ''}${this.total - previous}`);
        this.effectQueue = [...(def.effects ?? [])];
        this.continueEffects();
    }
    private applyTarget(kind: 'chooseNext' | 'steal', target: number): void {
        if (kind === 'chooseNext') this.chosenNext = target;
        else {
            const hand = this.hands[target];
            const card = hand[Math.floor(this.rng() * hand.length)];
            if (card) {
                this.move(card, { hand: target }, { hand: this.turn }, 'steal');
                this.draw(target);
            }
        }
    }
    private continueEffects(): void {
        const ctx = this.context!;
        while (this.effectQueue?.length) {
            const effect = this.effectQueue.shift()!;
            const handler = EFFECTS[effect.type];
            handler.apply(ctx, effect);
            if (handler.prompt && ctx.targets.length) {
                this.pending = { id: ++this.promptSeq, seat: this.turn, kind: handler.prompt,
                    text: handler.prompt === 'steal' ? 'Choose an opponent to steal from' : 'Choose who plays next',
                    options: [...ctx.targets] };
                return;
            }
        }
        this.direction = ctx.direction;
        for (let i = 0; i < this.replacementCount; i++) this.draw(this.turn);
        let next = this.next(this.turn);
        for (let i = 0; i < ctx.skip; i++) {
            this.skipped.push(next);
            next = this.next(next);
        }
        if (ctx.extraTurn) next = this.turn;
        this.turn = this.chosenNext ?? next;
        this.playsThisHand++;
        this.context = null;
        if (!this.legalPlays(this.turn).length && !this.combinations(this.turn).length) this.bust();
        else if (this.playsThisHand >= 300) {
            this.phase = 'bust';
            this.message('Stalemate · hand voided after 300 plays');
        }
    }
    private bust(): void {
        this.revealed.add(this.turn);
        this.events.push({ seq: ++this.seq, group: 'reveal', seat: this.turn,
            cards: this.hands[this.turn].map(card => this.cardView(card, true)) });
        this.tokens[this.turn]--;
        this.eliminated[this.turn] = this.tokens[this.turn] === 0;
        this.message(`Player ${this.turn + 1} cannot play · loses a token${this.eliminated[this.turn] ? ' · OUT' : ''}`);
        const remaining = this.tokens.flatMap((n, i) => n > 0 ? [i] : []);
        this.phase = remaining.length === 1 ? 'gameEnd' : 'bust';
        if (remaining.length === 1) this.winner = remaining[0];
    }
    view(seat: number, since = 0): View {
        const legal = this.legalPlays(seat);
        const party = (zone: Zone): boolean => typeof zone !== 'string' && zone.hand === seat;
        const events = this.events.filter(event => event.seq > since).map(event => {
            if (event.group === 'reveal') return event;
            const visible = event.group === 'play' || event.group === 'combine' ||
                ((event.group === 'draw' || event.group === 'deal' || event.group === 'steal') &&
                    (party(event.from) || party(event.to)));
            return { ...event, card: visible ? event.card : { iid: event.card.iid } };
        });
        return {
            variant: this.variant, options: this.options,
            players: this.hands.map((hand, i) => ({
                hand: hand.map(card => this.cardView(card, i === seat || this.revealed.has(i))),
                count: hand.length, tokens: this.tokens[i], eliminated: this.eliminated[i],
                revealed: this.revealed.has(i)
            })),
            deckCount: this.deck.length, discardCount: this.discard.length,
            discard: this.discard.map(card => this.cardView(card, true)),
            top: this.discard.length ? this.cardView(this.discard[this.discard.length - 1], true) : null,
            total: this.total, direction: this.direction, turn: this.turn,
            dealer: this.dealer, handNumber: this.handNumber,
            lastPlay: this.lastPlay, prompt: this.pending?.seat === seat ? this.pending : null,
            skipped: this.skipped, phase: this.phase, winner: this.winner, log: [...this.log], events,
            legal, playable: [...new Set(legal.map(play => play.iid))], combinations: this.combinations(seat)
        };
    }
}
