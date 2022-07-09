
export enum TURN {
    NORTH = 0, SOUTH
}

export enum GAME_STATE {
    LOBBY, PLACING, FIRING, BATTLE, END
}

export enum ROTATION {
    R0 = 0, R90, R180, R270
}

export enum DRAWN_BOARD {
    FIRING = 0, SELF = 1
}

export interface MoveMessage {
    
}
