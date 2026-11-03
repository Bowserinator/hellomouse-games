import { makeDeck, shuffle, strength, TITLES } from './cards.js';
import type { CardView, EventGroup, Move, MoveEvent, Phase, PlaySet, RuleState, TCard, Title, View, Zone } from './types.js';

export function checkPlay(
    state: RuleState, seat: number, iids: unknown
): { ok: true; set: PlaySet } | { error: string } {
    if (state.phase !== 'play' || state.turn !== seat || !state.hands[seat]) return { error: 'Not your turn' };
    if (!Array.isArray(iids) || iids.length < 1 || iids.length > 4 || new Set(iids).size !== iids.length)
        return { error: 'Choose 1–4 distinct cards' };
    const cards: Array<CardView> = [];
    for (const id of iids) {
        const card = state.hands[seat].find(c => c.iid === id);
        if (!card || card.value === null || (card.joker && !state.options.jokers)) return { error: 'Card is not in your hand' };
        cards.push(card);
    }
    const naturals = cards.filter(c => !c.joker);
    if (naturals.some(c => c.value !== naturals[0].value) || (!naturals.length && cards.length > 2))
        return { error: 'All natural cards must have the same rank' };
    const rank = naturals[0]?.value ?? 0;
    const set: PlaySet = {
        cards, count: cards.length, strength: naturals.length ? strength(naturals[0]) : 13,
        owner: seat, loneJoker: !naturals.length, spade2OverJoker: false, rank
    };
    const table = state.table;
    if (!table) return { ok: true, set };
    if (table.count !== set.count) return { error: 'Match the number of cards on the table' };
    if (table.spade2OverJoker) return { error: 'That 2 of spades cannot be beaten' };
    if (table.loneJoker) {
        if (state.options.jokers && table.count === 1 && cards[0].value === 2 && cards[0].suit === 'Spades') {
            set.spade2OverJoker = true;
            return { ok: true, set };
        }
        return { error: 'Only 2♠ can beat a single joker' };
    }
    if (set.loneJoker || (state.revolution ? set.strength < table.strength : set.strength > table.strength))
        return { ok: true, set };
    return { error: 'Your set must beat the table' };
}

export function legalPlays(state: RuleState, seat: number): Array<Array<string>> {
    if (state.phase !== 'play' || state.turn !== seat) return [];
    const hand = state.hands[seat] ?? [];
    const jokers = hand.filter(c => c.joker);
    const groups = new Map<number, Array<CardView>>();
    for (const c of hand) if (!c.joker && c.value !== null) {
        if (!groups.has(c.value)) groups.set(c.value, []);
        groups.get(c.value)?.push(c);
    }
    const candidates: Array<Array<string>> = [];
    // A rank has at most four naturals and two jokers, so exhaustive subsets stay small.
    for (const group of [...groups.values(), []]) {
        const pool = [...group, ...jokers];
        for (let mask = 1; mask < 2 ** pool.length; mask++) {
            const ids = pool.filter((_, i) => mask & (1 << i)).map(c => c.iid);
            if (ids.length <= 4 && 'ok' in checkPlay(state, seat, ids)) candidates.push(ids);
        }
    }
    return [...new Map(candidates.map(ids => [ids.slice().sort().join(','), ids])).values()];
}

export class Engine implements RuleState {
    hands: Array<Array<TCard>> = [[], [], [], []];
    deck: Array<TCard>;
    discard: Array<TCard> = [];
    tableCards: Array<TCard> = [];
    table: PlaySet | null = null;
    previous: PlaySet | null = null;
    phase: Phase = 'play';
    turn = 0;
    leader = 0;
    passed = new Set<number>();
    revolution = false;
    out: Array<number> = [];
    bankrupt: number | null = null;
    titles: Array<Title | null> = [null, null, null, null];
    scores = [0, 0, 0, 0];
    round = 0;
    totalRounds: number;
    options: { jokers: boolean };
    pendingExchange = new Map<number, { count: number; to: number; received: Array<string> }>();
    log: Array<string> = [];
    events: Array<MoveEvent> = [];
    winnerSeats: Array<number> = [];
    private seq = 0;
    private rng: () => number;
    private exchangeChoices = new Map<number, Array<TCard>>();

    constructor({ jokers = true, rounds = 3, rng = Math.random }: {
        jokers?: boolean; rounds?: number; rng?: () => number;
    } = {}) {
        if (typeof jokers !== 'boolean' || !Number.isInteger(rounds) || rounds < 1 || rounds > 20)
            throw new Error('Use a joker toggle and 1–20 integer rounds');
        this.options = { jokers }; this.totalRounds = rounds; this.rng = rng;
        this.deck = makeDeck(jokers, rng);
        this.newRound();
    }
    private zone(zone: Zone): Array<TCard> {
        return typeof zone === 'object' ? this.hands[zone.hand] : zone === 'table' ? this.tableCards : this[zone];
    }
    private move(card: TCard, from: Zone, to: Zone, group: EventGroup): void {
        const source = this.zone(from);
        const index = source.findIndex(c => c.iid === card.iid);
        if (index === -1) throw new Error('Card is missing from its source zone');
        source.splice(index, 1); this.zone(to).push(card);
        this.events.push({ seq: ++this.seq, card: { ...card }, from, to, group });
    }
    private say(text: string): void {
        this.log.push(text);
    }
    private newRound(): void {
        for (const zone of ['table', 'discard', ...this.hands.map((_, hand) => ({ hand }))] as Array<Zone>)
            for (const card of [...this.zone(zone)]) this.move(card, zone, 'deck', 'gather');
        this.round++; this.revolution = false; this.passed.clear(); this.out = []; this.bankrupt = null;
        this.table = this.previous = null; this.pendingExchange.clear(); this.exchangeChoices.clear();
        this.say(`Round ${this.round} / ${this.totalRounds}`);
        for (const card of shuffle(this.deck, this.rng)) this.move(card, 'deck', 'deck', 'shuffle');
        const extra = this.round === 1 ? shuffle([0, 1, 2, 3], this.rng).slice(0, 2)
            : [this.titles.indexOf('tycoon'), this.titles.indexOf('rich')];
        for (let lap = 0; lap < 14; lap++) for (let seat = 0; seat < 4; seat++)
            if (lap < 13 || (this.options.jokers && extra.includes(seat)))
                this.move(this.deck[0], 'deck', { hand: seat }, 'deal');
        if (this.round === 1) {
            const holder = this.hands.findIndex(h => h.some(c => c.value === 3 && c.suit === 'Diamonds'));
            const card = this.hands[holder].find(c => c.value === 3 && c.suit === 'Diamonds') as TCard;
            this.move(card, { hand: holder }, 'table', 'reveal');
            this.move(card, 'table', { hand: holder }, 'reveal');
            this.leader = this.turn = holder; this.phase = 'play';
            this.say(`Player ${holder + 1} reveals 3♦ and leads`);
        } else {
            this.phase = 'exchange';
            for (const [fromTitle, toTitle, count] of [['beggar', 'tycoon', 2], ['poor', 'rich', 1]] as const) {
                const from = this.titles.indexOf(fromTitle), to = this.titles.indexOf(toTitle);
                const highest = shuffle(this.hands[from], this.rng)
                    .sort((a, b) => strength(b) - strength(a)).slice(0, count);
                for (const card of highest) this.move(card, { hand: from }, { hand: to }, 'exchange');
                this.pendingExchange.set(to, { count, to: from, received: highest.map(c => c.iid) });
            }
            this.leader = this.turn = this.titles.indexOf('beggar');
            this.say('Class exchange in progress');
        }
    }
    dispatch(seat: number, move: Move): string | null {
        if (!Number.isInteger(seat) || seat < 0 || seat > 3) return 'Invalid seat';
        if (!move || typeof move.action !== 'string') return 'Invalid move';
        if (move.action === 'CONTINUE') {
            if (this.phase !== 'roundEnd') return 'No round to continue';
            this.newRound(); return null;
        }
        if (move.action === 'EXCHANGE') {
            const prompt = this.pendingExchange.get(seat);
            if (this.phase !== 'exchange' || !prompt || this.exchangeChoices.has(seat)) return 'No exchange choice due';
            const ids = move.iids;
            if (!Array.isArray(ids) || ids.length !== prompt.count || new Set(ids).size !== ids.length ||
                ids.some(id => typeof id !== 'string' || !this.hands[seat].some(c => c.iid === id)))
                return `Choose ${prompt.count} distinct cards from your hand`;
            this.exchangeChoices.set(seat, ids.map(id => this.hands[seat].find(c => c.iid === id) as TCard));
            if (this.exchangeChoices.size === this.pendingExchange.size) {
                for (const [from, cards] of this.exchangeChoices) for (const card of cards)
                    this.move(card, { hand: from }, { hand: (this.pendingExchange.get(from) as { to: number }).to }, 'exchange');
                this.pendingExchange.clear(); this.exchangeChoices.clear(); this.phase = 'play';
                this.say('Class exchange complete');
            }
            return null;
        }
        if (this.phase !== 'play' || this.turn !== seat) return 'Not your turn';
        if (move.action === 'PASS') {
            if (!this.table) return 'The leader must play';
            this.passed.add(seat); this.say(`Player ${seat + 1} passes`);
            this.advance(false); return null;
        }
        if (move.action !== 'PLAY') return 'Unknown move';
        const result = checkPlay(this, seat, move.iids);
        if ('error' in result) return result.error;
        this.previous = this.table; this.table = result.set;
        for (const card of result.set.cards) this.move(card as TCard, { hand: seat }, 'table', 'play');
        this.say(`Player ${seat + 1} plays ${result.set.count} ${result.set.loneJoker ? 'joker(s)' : `of rank ${result.set.rank === 1 ? 'A' : result.set.rank}`}`);
        if (result.set.count === 4) {
            this.revolution = !this.revolution;
            this.say(this.revolution ? '革命 — Revolution' : '革命返し — Counter-Revolution');
        }
        if (!this.hands[seat].length) {
            this.out.push(seat);
            const previousTycoon = this.titles.indexOf('tycoon');
            if (this.out.length === 1 && previousTycoon !== -1 && previousTycoon !== seat) {
                this.bankrupt = previousTycoon;
                for (const card of [...this.hands[previousTycoon]])
                    this.move(card, { hand: previousTycoon }, 'discard', 'discard');
                this.say(`Player ${previousTycoon + 1} — 都落ち Bankruptcy`);
            }
        }
        if (result.set.rank === 8) this.say('八切り — Eight Cut');
        this.advance(result.set.rank === 8 || result.set.spade2OverJoker);
        return null;
    }
    private next(after: number, skipPassed: boolean): number {
        for (let step = 1; step <= 4; step++) {
            const seat = (after + step) % 4;
            if (this.hands[seat].length && (!skipPassed || !this.passed.has(seat))) return seat;
        }
        return -1;
    }
    private clearTable(): void {
        for (const card of [...this.tableCards]) this.move(card, 'table', 'discard', 'clear');
        this.table = this.previous = null; this.passed.clear();
    }
    private advance(instant: boolean): void {
        const active = this.hands.map((h, i) => h.length ? i : -1).filter(i => i !== -1);
        if (active.length <= 1) {
            const order = [...this.out, ...active, ...(this.bankrupt === null ? [] : [this.bankrupt])];
            this.clearTable();
            for (const seat of active) for (const card of [...this.hands[seat]])
                this.move(card, { hand: seat }, 'discard', 'discard');
            this.out = order;
            for (let i = 0; i < 4; i++) {
                this.titles[order[i]] = TITLES[i]; this.scores[order[i]] += 3 - i;
            }
            this.phase = this.round === this.totalRounds ? 'gameEnd' : 'roundEnd';
            if (this.phase === 'gameEnd') this.winnerSeats = this.scores.map((n, i) => n === Math.max(...this.scores) ? i : -1).filter(i => i !== -1);
            this.say(`Round ${this.round} complete`); return;
        }
        const owner = (this.table as PlaySet).owner;
        if (instant || active.every(i => i === owner || this.passed.has(i))) {
            this.clearTable();
            this.leader = this.turn = this.hands[owner].length ? owner : this.next(owner, false);
        } else this.turn = this.next(this.turn, true);
    }
    legalPlays(seat: number): Array<Array<string>> {
        return legalPlays(this, seat);
    }
    view(seat: number, sinceSeq = 0): View {
        const hidden = (card: CardView): CardView => ({ iid: card.iid, value: null, suit: null, joker: null });
        const events = this.events.filter(e => e.seq > sinceSeq).map(e => {
            const involved = [e.from, e.to].some(z => typeof z === 'object' && z.hand === seat);
            const publicCard = ['play', 'clear', 'discard', 'reveal'].includes(e.group);
            return { ...e, card: publicCard || (involved && ['exchange', 'deal'].includes(e.group)) ? { ...e.card } : hidden(e.card) };
        });
        const prompt = this.pendingExchange.get(seat);
        return {
            youAre: seat, hands: this.hands.map((h, i) => h.map(c => i === seat ? { ...c } : hidden(c))),
            counts: this.hands.map(h => h.length), deckCount: this.deck.length,
            discard: this.discard.map(c => ({ ...c })),
            table: this.table ? { ...this.table, cards: this.table.cards.map(c => ({ ...c })) } : null,
            tablePile: this.tableCards.map(c => ({ ...c })), previous: this.previous,
            phase: this.phase, turn: this.turn, leader: this.leader,
            passed: [...this.passed], revolution: this.revolution,
            options: { ...this.options }, titles: [...this.titles], scores: [...this.scores], round: this.round,
            totalRounds: this.totalRounds, out: [...this.out], bankrupt: this.bankrupt, winners: [...this.winnerSeats],
            playable: [...new Set(this.legalPlays(seat).flat())],
            exchange: prompt && !this.exchangeChoices.has(seat) ? { ...prompt, received: [...prompt.received] } : null,
            pendingExchange: [...this.pendingExchange.keys()].filter(i => !this.exchangeChoices.has(i)),
            log: this.log.slice(-80), events
        };
    }
}
