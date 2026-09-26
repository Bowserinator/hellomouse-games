export default class Card {
    static SUITS = ['Diamonds', 'Hearts', 'Spades', 'Clubs'];

    value: number;
    suit: string;

    /**
     * Construct a card
     * @param {number} val Value, 1 (ace) - 13 (king)
     * @param {string} suit One of Card.SUITS
     */
    constructor(val: number, suit: string) {
        this.value = val;
        this.suit = suit;
    }

    toString() {
        return `${this.value} of ${this.suit}`;
    }
}
