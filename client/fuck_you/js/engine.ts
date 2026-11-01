import { CARDS, CARD_BY_ID, COLORS } from './cards.js';
import type { CardDef, Color } from './cards.js';

export interface Card {
    iid: string; defId: string;
}
export type Place = 'deck' | 'discard' | number;
export interface MoveEvent {
    seq: number; card: Card; from: Place; to: Place;
}
export interface Prompt {
    id: number;
    player: number;
    kind: 'player' | 'cards' | 'color' | 'play' | 'rps';
    text: string;
    options: Array<string>;
    count: number;
}
export interface Move {
    action?: unknown; iid?: unknown; color?: unknown;
    selection?: unknown; promptId?: unknown; uno?: unknown;
}
export interface CardView {
    iid: string; defId: string | null;
}
export interface View {
    seat: number; turn: number; direction: number; color: Color; top: Card;
    players: Array<{ hand: Array<CardView>; count: number; revealed: boolean }>;
    deckCount: number; discardCount: number; playable: Array<string>;
    drawn: string | null; prompt: Prompt | null; waiting: string | null;
    winner: number | null; vulnerable: number | null; log: Array<string>;
    events: Array<{ seq: number; card: CardView; from: Place; to: Place }>;
}
type Resolution = Generator<Prompt, void, Array<string>>;

export class Engine {
    hands: Array<Array<Card>>;
    deck: Array<Card> = [];
    discard: Array<Card> = [];
    turn = 0;
    direction = 1;
    color: Color = 'red';
    drawn: string | null = null;
    winner: number | null = null;
    revealed = new Set<number>();
    vulnerable: number | null = null;
    prompt: Prompt | null = null;
    log: Array<string> = [];
    events: Array<MoveEvent> = [];
    private seq = 0;
    private promptSeq = 0;
    private resolution: Resolution | null = null;
    private announced = false;
    private skip = 0;
    private force = false;
    private duel: { players: [number, number]; choices: Map<number, string>; scores: [number, number] } | null = null;

    constructor(count: number, private rng: () => number = Math.random) {
        if (!Number.isInteger(count) || count < 2 || count > 8) throw new Error('Use 2 to 8 players');
        this.hands = Array.from({ length: count }, () => []);
        let serial = 0;
        for (const def of CARDS) for (let n = 0; n < def.copies; n++) this.deck.push({ iid: `c${++serial}`, defId: def.id });
        this.shuffle();
        for (let n = 0; n < 7; n++) for (let seat = 0; seat < count; seat++) this.draw(seat, 1);
        // Start with a number so setup never silently consumes a special effect.
        const first = this.deck.findIndex(card => CARD_BY_ID[card.defId].effect.op === 'number');
        const top = this.deck.splice(first, 1)[0];
        this.discard.push(top);
        this.color = CARD_BY_ID[top.defId].color as Color;
        this.events = [];
        this.say('Player 1 starts. Match the color, number, or symbol.');
    }

    private say(text: string): void {
        this.log.push(text); if (this.log.length > 100) this.log.shift();
    }
    private next(seat: number, distance = 1): number {
        return ((seat + this.direction * distance) % this.hands.length + this.hands.length) % this.hands.length;
    }
    private shuffle(): void {
        for (let i = this.deck.length - 1; i > 0; i--) {
            const j = Math.floor(this.rng() * (i + 1));
            [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
        }
    }
    private move(card: Card, from: Place, to: Place): void {
        this.events.push({ seq: ++this.seq, card, from, to });
        if (this.events.length > 512) this.events.shift();
    }
    private refill(): void {
        if (this.deck.length || this.discard.length < 2) return;
        this.deck = this.discard.splice(0, this.discard.length - 1);
        this.shuffle();
        this.say('The discard pile was shuffled into the draw deck.');
    }
    private draw(seat: number, count: number): Array<Card> {
        const result: Array<Card> = [];
        for (let n = 0; n < count; n++) {
            this.refill();
            const card = this.deck.pop();
            if (!card) break;
            this.hands[seat].push(card);
            this.move(card, 'deck', seat);
            result.push(card);
        }
        return result;
    }
    private transfer(from: number, to: number, cards: Array<Card>): void {
        for (const card of cards) {
            this.hands[from].splice(this.hands[from].indexOf(card), 1);
            this.hands[to].push(card);
            this.move(card, from, to);
        }
    }
    private returnToDeck(seat: number, cards: Array<Card>): void {
        for (const card of cards) {
            this.hands[seat].splice(this.hands[seat].indexOf(card), 1);
            this.deck.push(card);
            this.move(card, seat, 'deck');
        }
        this.shuffle();
    }
    private affordable(seat: number, def: CardDef): boolean {
        const remaining = this.hands[seat].length - 1;
        if (def.effect.op === 'gift') return remaining >= 5;
        if (def.effect.op === 'philanthropist') return remaining >= this.hands.length + 1;
        return true;
    }
    legal(seat: number, card: Card, unrestricted = false): boolean {
        const def = CARD_BY_ID[card.defId];
        if (!def || !this.affordable(seat, def)) return false;
        if (unrestricted) return true;
        if (card.defId === 'draw-four' && this.hands[seat].some(other => CARD_BY_ID[other.defId].color === this.color)) return false;
        const top = CARD_BY_ID[this.discard[this.discard.length - 1].defId];
        return def.color === null || def.color === this.color ||
            (def.effect.op === 'number' && top.effect.op === 'number' && def.effect.value === top.effect.value) ||
            (def.effect.op !== 'number' && def.effect.op === top.effect.op &&
                (def.effect.op !== 'draw' || top.effect.op !== 'draw' || def.effect.count === top.effect.count));
    }
    private makePrompt(player: number, kind: Prompt['kind'], text: string, options: Array<string>, count = 1): Prompt {
        return { id: ++this.promptSeq, player, kind, text, options, count };
    }
    private* chooseColor(seat: number, options: Array<string> = [...COLORS]): Resolution {
        const answer = yield this.makePrompt(seat, 'color', 'Choose the active color', options);
        this.color = answer[0] as Color;
    }
    private put(seat: number, card: Card): void {
        this.hands[seat].splice(this.hands[seat].indexOf(card), 1);
        this.discard.push(card);
        this.move(card, seat, 'discard');
        const def = CARD_BY_ID[card.defId];
        if (def.color) this.color = def.color;
        this.say(`Player ${seat + 1} played ${def.name}.`);
    }
    private* effect(seat: number, card: Card): Resolution {
        const def = CARD_BY_ID[card.defId];
        const next = this.next(seat);
        const others = this.hands.map((_, i) => i).filter(i => i !== seat);
        switch (def.effect.op) {
            case 'number': case 'wild': break;
            case 'draw': this.draw(next, def.effect.count); this.skip++; break;
            case 'skip': this.skip++; break;
            case 'reverse': this.direction *= -1; if (this.hands.length === 2) this.skip++; break;
            case 'reveal': this.revealed.add(next); break;
            case 'swap': {
                const answer = yield this.makePrompt(seat, 'player', 'Choose a player to swap hands with', others.map(String));
                const target = Number(answer[0]);
                const own = [...this.hands[seat]], theirs = [...this.hands[target]];
                this.transfer(seat, target, own);
                this.transfer(target, seat, theirs);
                break;
            }
            case 'duel': {
                const previous = this.next(seat, -1);
                this.duel = { players: [seat, previous], choices: new Map(), scores: [0, 0] };
                while (this.duel.scores.every(score => score < 2)) {
                    yield this.makePrompt(seat, 'rps', `Rock, Paper, Scissors — ${this.duel.scores.join(' : ')}`, ['rock', 'paper', 'scissors']);
                    const a = this.duel.choices.get(seat) as string;
                    const b = this.duel.choices.get(previous) as string;
                    const win = a === b ? -1 : ({ rock: 'scissors', paper: 'rock', scissors: 'paper' }[a] === b ? 0 : 1);
                    if (win !== -1) this.duel.scores[win]++;
                    this.say(`Duel: Player ${seat + 1} chose ${a}; Player ${previous + 1} chose ${b}. ${this.duel.scores.join(' : ')}.`);
                    this.duel.choices.clear();
                }
                const loser = this.duel.players[this.duel.scores[0] === 2 ? 1 : 0];
                this.draw(loser, 6);
                this.say(`Player ${loser + 1} lost the duel and drew 6 cards.`);
                this.duel = null;
                break;
            }
            case 'lightning': {
                const placed: Array<Color> = [];
                for (let n = 0; n < 2 && this.hands[seat].length && this.winner === null; n++) {
                    const options = this.hands[seat].filter(c => this.legal(seat, c, true)).map(c => c.iid);
                    if (!options.length) break;
                    const answer = yield this.makePrompt(seat, 'play', `Lightning Bolt: play extra card ${n + 1} of 2 (no matching required)`, options);
                    const extra = this.hands[seat].find(c => c.iid === answer[0]) as Card;
                    this.put(seat, extra);
                    const extraDef = CARD_BY_ID[extra.defId];
                    if (extraDef.color) placed.push(extraDef.color);
                    else {
                        placed.push(...COLORS); yield* this.chooseColor(seat);
                    }
                    yield* this.effect(seat, extra);
                }
                if (this.winner === null)
                    yield* this.chooseColor(seat, placed.length ? [...new Set(placed)] : [...COLORS]);
                break;
            }
            case 'gift': {
                const target = yield this.makePrompt(seat, 'player', 'Choose who receives your gift', others.map(String));
                const answer = yield this.makePrompt(seat, 'cards', 'Choose 3 cards to give away', this.hands[seat].map(c => c.iid), 3);
                this.transfer(seat, Number(target[0]), this.hands[seat].filter(c => answer.includes(c.iid)));
                break;
            }
            case 'god': this.returnToDeck(seat, [...this.hands[seat]]); this.draw(seat, 2); break;
            case 'force': this.force = true; break;
            case 'burglar':
                for (const target of others) {
                    const hand = this.hands[target];
                    if (hand.length) this.transfer(target, seat, [hand[Math.floor(this.rng() * hand.length)]]);
                }
                break;
            case 'philanthropist':
                for (const target of others) {
                    const hand = this.hands[seat];
                    this.transfer(seat, target, [hand[Math.floor(this.rng() * hand.length)]]);
                }
                break;
            case 'bottle': {
                const target = others[Math.floor(this.rng() * others.length)];
                this.draw(target, 6);
                this.say(`The bottle picked Player ${target + 1}: draw 6.`);
                break;
            }
            case 'chain': [4, 2, 1].forEach((count, i) => this.draw(this.next(seat, i + 1), count)); break;
            case 'sacrifice':
                if (!this.hands[seat].length) {
                    this.winner = seat; break;
                }
                this.draw(seat, this.hands.length);
                for (const target of others) this.draw(target, 1);
                break;
            case 'allergy': this.returnToDeck(seat, this.hands[seat].filter(c => CARD_BY_ID[c.defId].color === def.color)); break;
            case 'bomb': {
                const min = Math.min(...this.hands.map(hand => hand.length));
                const leaders = this.hands.map((hand, i) => hand.length === min ? i : -1).filter(i => i !== -1);
                const target = leaders[Math.floor(this.rng() * leaders.length)];
                this.say(`Bomb targets Player ${target + 1}: draw until blue.`);
                this.drawUntil(target, c => CARD_BY_ID[c.defId].color === 'blue');
                break;
            }
        }
    }
    private drawUntil(seat: number, predicate: (card: Card) => boolean): void {
        // Search only the finite drawable pool; never loop on a missing color or special.
        const limit = this.deck.length + this.discard.length - 1;
        for (let i = 0; i < limit; i++) {
            const card = this.draw(seat, 1)[0];
            if (!card || predicate(card)) break;
        }
    }
    private* resolve(seat: number, card: Card): Resolution {
        yield* this.effect(seat, card);
        this.finish(seat);
        if (this.force && this.winner === null) {
            this.force = false;
            const target = this.turn;
            const isSpecial = (c: Card) => CARD_BY_ID[c.defId].effect.op !== 'number' && this.affordable(target, CARD_BY_ID[c.defId]);
            if (!this.hands[target].some(isSpecial)) this.drawUntil(target, isSpecial);
            const options = this.hands[target].filter(isSpecial).map(c => c.iid);
            if (options.length) {
                const answer = yield this.makePrompt(target, 'play', 'Force Update: play a special card (no matching required)', options);
                const forced = this.hands[target].find(c => c.iid === answer[0]) as Card;
                this.vulnerable = null;
                this.skip = 0;
                this.put(target, forced);
                if (CARD_BY_ID[forced.defId].color === null) yield* this.chooseColor(target);
                yield* this.resolve(target, forced);
            } else {
                this.say('No playable special cards remain. Force Update passes.');
                this.finish(target);
            }
        }
    }
    private finish(seat: number): void {
        if (this.winner === null) {
            const empty = this.hands.findIndex(hand => hand.length === 0);
            if (empty !== -1) this.winner = empty;
        }
        if (this.winner !== null) {
            this.say(`Player ${this.winner + 1} wins!`); return;
        }
        this.vulnerable = this.hands[seat].length === 1 && !this.announced ? seat : null;
        this.revealed.delete(seat);
        this.turn = this.next(seat, 1 + this.skip);
        this.skip = 0;
        this.drawn = null;
    }
    private advance(answer?: Array<string>): void {
        if (!this.resolution) return;
        const result = this.resolution.next(answer as Array<string>);
        this.prompt = result.done ? null : result.value;
        if (result.done) this.resolution = null;
    }
    dispatch(seat: number, move: Move): string | null {
        if (!Number.isInteger(seat) || !this.hands[seat]) return 'Not seated';
        if (this.winner !== null) return 'The game is over';
        if (move.action === 'UNO') {
            if (this.hands[seat].length !== 1) return 'You do not have one card';
            if (this.vulnerable === seat) this.vulnerable = null;
            if (seat === this.turn && this.resolution) this.announced = true;
            this.say(`Player ${seat + 1} called UNO!`);
            return null;
        }
        if (move.action === 'CATCH') {
            if (this.vulnerable === null || this.vulnerable === seat) return 'Nobody can be caught';
            this.draw(this.vulnerable, 2);
            this.say(`Player ${this.vulnerable + 1} missed UNO and drew 2 cards.`);
            this.vulnerable = null;
            return null;
        }
        if (this.prompt) {
            const p = this.prompt;
            if (move.action !== 'RESPOND' || move.promptId !== p.id) return 'Resolve the current prompt first';
            const allowedSeat = p.kind === 'rps' ? this.duel?.players.includes(seat) : seat === p.player;
            if (!allowedSeat) return 'This prompt is for another player';
            if (!Array.isArray(move.selection) || move.selection.length !== p.count ||
                new Set(move.selection).size !== p.count || !move.selection.every(s => typeof s === 'string' && p.options.includes(s))) return 'Invalid selection';
            if (p.kind === 'rps' && this.duel) {
                if (this.duel.choices.has(seat)) return 'You already chose this round';
                this.duel.choices.set(seat, move.selection[0]);
                if (this.duel.choices.size < 2) return null;
            }
            if (p.kind === 'play') this.announced = move.uno === true;
            this.advance(move.selection);
            return null;
        }
        if (seat !== this.turn) return 'It is not your turn';
        if (move.action === 'DRAW') {
            if (this.drawn !== null) return 'You already drew; play that card or pass';
            this.vulnerable = null;
            const card = this.draw(seat, 1)[0];
            this.say(`Player ${seat + 1} drew a card.`);
            if (card && this.legal(seat, card)) this.drawn = card.iid;
            else this.finish(seat);
            return null;
        }
        if (move.action === 'PASS') {
            if (this.drawn === null) return 'Draw before passing';
            this.vulnerable = null;
            this.finish(seat);
            return null;
        }
        if (move.action !== 'PLAY') return 'Unknown action';
        const card = this.hands[seat].find(c => c.iid === move.iid);
        if (!card || !this.legal(seat, card) || (this.drawn !== null && this.drawn !== card.iid)) return 'That card cannot be played';
        const def = CARD_BY_ID[card.defId];
        if (def.color === null && !COLORS.includes(move.color as Color)) return 'Choose a color';
        this.vulnerable = null;
        this.announced = move.uno === true;
        this.skip = 0;
        this.put(seat, card);
        if (def.color === null) this.color = move.color as Color;
        this.drawn = null;
        this.resolution = this.resolve(seat, card);
        this.advance();
        return null;
    }
    view(seat: number, since = 0): View {
        const p = this.prompt;
        const canAnswer = p && (p.kind === 'rps' ? this.duel?.players.includes(seat) && !this.duel.choices.has(seat) : p.player === seat);
        return {
            seat, turn: this.turn, direction: this.direction, color: this.color,
            top: this.discard[this.discard.length - 1],
            players: this.hands.map((hand, owner) => ({
                count: hand.length, revealed: this.revealed.has(owner),
                hand: hand.map((card, i) => owner === seat || this.revealed.has(owner) ? { ...card } : { iid: `hidden-${owner}-${i}`, defId: null })
            })),
            deckCount: this.deck.length, discardCount: this.discard.length,
            playable: !p && this.winner === null && seat === this.turn
                ? this.hands[seat].filter(c => this.legal(seat, c) &&
                    (this.drawn === null || c.iid === this.drawn)).map(c => c.iid) : [],
            drawn: seat === this.turn ? this.drawn : null,
            prompt: canAnswer ? { ...p as Prompt, options: [...(p as Prompt).options] } : null,
            waiting: p ? p.text : null, winner: this.winner, vulnerable: this.vulnerable, log: [...this.log],
            events: this.events.filter(e => e.seq > since).map(e => ({
                seq: e.seq, from: e.from, to: e.to,
                card: e.to === 'discard' || e.from === 'discard' || e.from === seat || e.to === seat ||
                    (typeof e.from === 'number' && this.revealed.has(e.from)) || (typeof e.to === 'number' && this.revealed.has(e.to))
                    ? { ...e.card } : { iid: 'hidden', defId: null }
            }))
        };
    }
}
