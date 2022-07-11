
export enum TURN {
    NORTH = 0, SOUTH
}

export enum GAME_STATE {
    LOBBY, PLACING, FIRING
}

export enum ROTATION {
    R0 = 0, R90, R180, R270
}

export enum DRAWN_BOARD {
    FIRING = 0, SELF = 1
}

export enum MOVE_TYPE {
    PLACE, FIRE
}

export enum WINNER {
    UNKNOWN = 0, P1, P2, TIE
}

export enum MarkerType {
    HIT_MARKER, MISS_MARKER, MAYBE_HIT_MARKER, MAYBE_MISS_MARKER, UNKNOWN,
    MISSILE_SHOTDOWN, AA_SHOTDOWN
}

export interface MoveMessage {
    type: string;
    action: MOVE_TYPE;
    placements: Array<[number, number, number]>; // Ship placements, [x, y, rot]
    abilityName: string;                         // Identifier for what is fired
    firePos: [number, number];
}
