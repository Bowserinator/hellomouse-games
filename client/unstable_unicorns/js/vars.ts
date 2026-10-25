export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 8;

export const HAND_LIMIT = 7;
export const ACTIONS_PER_TURN = 1;
export const DRAWS_PER_TURN = 1;

export function winTarget(playerCount: number): number {
    return playerCount >= 6 ? 6 : 7;
}

export const WILDCARD = '__wildcard';
