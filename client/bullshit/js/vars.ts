// Tuning constants shared by server/games/bullshit.ts and
// client/bullshit/js/game.ts. Single source of truth: neither side defines
// its own copy, so the two can't drift apart.

import Deck from './game/deck.js';

// Values taken from the original bullshit/config.js
export const MIN_PLAYERS = 2;
export const TURN_TIME_SECONDS = 30;

export const EMOTE_RATE_MAX = 4;
export const EMOTE_RATE_WINDOW_MS = 1000;

// Full deck size, derived from the same deck the server deals from. The
// client clamps its card pool / avatar fans to this so they can never
// exceed what actually exists (server: Deck.generateDefaultDeck().length)
export const DECK_SIZE = Deck.generateDefaultDeck().cards.length;

// Client reveal animation timings. The server builds its settle deadline
// from these (BullshitGame.REVEAL_SETTLE_MS), so they live here: the game
// may only resume once the client has flipped the cards and reached its
// payout flight.
export const BS_FLIP_MS = 500;            // must equal the .fx-card-flip transition in css
export const REVEAL_DELAY_MS = 1200;      // pause between the flip and cards flying to the loser

export const EMOJI_IMAGES = [
    '/bullshit/img/emoji/AYAYA.png',
    '/bullshit/img/emoji/aughghh.png',
    '/bullshit/img/emoji/auuughh.png',
    '/bullshit/img/emoji/card.png',
    '/bullshit/img/emoji/clown.png',
    '/bullshit/img/emoji/kms.png',
    '/bullshit/img/emoji/ksussy.png',
    '/bullshit/img/emoji/lobotomy.png',
    '/bullshit/img/emoji/mercy.png',
    '/bullshit/img/emoji/ptsd.png',
    '/bullshit/img/emoji/sip.png',
    '/bullshit/img/emoji/sly-fox.png',
    '/bullshit/img/emoji/sus.png',
    '/bullshit/img/emoji/think.png'
];

export const PROFILE_PICTURES = [
    '/bullshit/img/pfps/1.png',
    '/bullshit/img/pfps/2.png',
    '/bullshit/img/pfps/3.png',
    '/bullshit/img/pfps/4.png',
    '/bullshit/img/pfps/5.png',
    '/bullshit/img/pfps/6.png',
    '/bullshit/img/pfps/7.png',
    '/bullshit/img/pfps/8.png',
    '/bullshit/img/pfps/9.png',
    '/bullshit/img/pfps/10.png',
    '/bullshit/img/pfps/11.png'
];
