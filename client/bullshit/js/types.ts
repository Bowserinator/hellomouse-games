// Wire types shared by server/games/bullshit.ts and client/bullshit/js/game.ts.
// Identical shape on both sides, so they live here instead of being declared twice.

export interface CardLike {
    value: number;
    suit: string;
}

/** Currently staged (not yet buried) play: what the next BS challenge judges */
export interface LastPlay {
    player: number;
    count: number;
}

export interface PlayerSync {
    username: string;
    ready: boolean;
    numCards: number;
    disconnected: boolean;
    graceSecondsRemaining: number;
    profilePicture: string;
}

export interface LastEvent {
    seq: number;
    type: 'SUBMIT' | 'BS' | 'REVEAL';
    player?: number;
    count?: number;
    loser?: number;
    correct?: boolean;
    caller?: number;
    /** REVEAL only: pile contents, bottom of pile first */
    cards?: Array<CardLike>;
}
