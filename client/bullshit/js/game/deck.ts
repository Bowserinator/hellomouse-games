import random from './random.js';
import Card from './card.js';

export default class Deck {
    cards: Array<Card>;

    /**
     * Constructs a deck, optionally with
     * a list of cards. Top of deck is end
     * @param {Array<Card>} cards
     */
    constructor(cards: Array<Card> = []) {
        this.cards = cards;
    }

    /**
     * Shuffles the deck what do you expect
     * this to do
     */
    shuffle() {
        for (let i = 0; i < this.cards.length; i++) {
            let a = random.randInt(0, this.cards.length);
            let b = random.randInt(0, this.cards.length);
            let temp = this.cards[a];
            this.cards[a] = this.cards[b];
            this.cards[b] = temp;
        }
    }

    /**
     * Remove an array of cards
     * @param {Array<Card>} cards
     */
    removeCards(cards: Array<Card>) {
        this.cards = this.cards.filter(card => {
            return !cards.some(c =>
                c.value === card.value &&
                c.suit === card.suit);
        });
    }

    /**
     * Adds multiple cards
     * @param {Array<Card>} cards
     */
    addCards(cards: Array<Card>) {
        for (let card of cards)
            this.cards.push(card);
    }

    /**
     * Returns sorted default (52 card) deck
     * @return {Deck}
     */
    static generateDefaultDeck(): Deck {
        let returned = new Deck();
        for (let i = 1; i <= 13; i++)
            for (let j = 0; j < Card.SUITS.length; j++)
                returned.cards.push(new Card(i, Card.SUITS[j]));
        return returned;
    }
}
