import Game from '../game.js';
import Client from '../client.js';

/**
 * Lines drawn between the 21 points of the board.
 * Point 0 is the center, 1-4 are the inner ring, 5-8 are the
 * centers of the four arcs, and 9-20 are the outer ring.
 */
const ADJACENCY: Array<Array<number>> = [
    [1, 2, 3, 4],          // 0
    [0, 2, 4, 5],          // 1
    [0, 1, 3, 6],          // 2
    [0, 2, 4, 7],          // 3
    [0, 1, 3, 8],          // 4
    [1, 9, 10, 20],        // 5
    [2, 11, 12, 13],       // 6
    [3, 14, 15, 16],       // 7
    [4, 17, 18, 19],       // 8
    [5, 10, 20],           // 9
    [5, 9, 11],            // 10
    [6, 10, 12],           // 11
    [6, 11, 13],           // 12
    [6, 12, 14],           // 13
    [7, 13, 15],           // 14
    [7, 14, 16],           // 15
    [7, 15, 17],           // 16
    [8, 16, 18],           // 17
    [8, 17, 19],           // 18
    [8, 18, 20],           // 19
    [5, 19, 9]             // 20
];

/**
 * Starting points for each player. Player 0 starts on the
 * south points and player 1 on the north points.
 */
const OPENING: Array<Array<number>> = [
    [16, 17, 18, 19, 20, 8],
    [10, 11, 12, 13, 14, 6]
];

/** Pieces the losing player is reduced to */
const LOSS_PIECE_COUNT = 2;

/** Times a position must repeat to be a draw */
const REPEAT_LIMIT = 3;

/**
 * How far a chain of pieces that free each other is followed. A deeper
 * chain needs a longer trade than the game ever sees
 */
/**
 * Is every point next to this one occupied?
 * @param {Array<number>} board
 * @param {number} point
 * @return {boolean}
 */
function isTrapped(board: Array<number>, point: number) {
    return ADJACENCY[point].every(x => board[x] !== 0);
}

/**
 * Can a piece of the player next to this point step away to an empty point?
 * @param {Array<number>} board
 * @param {number} player
 * @param {number} point
 * @return {boolean}
 */
function canStepAway(board: Array<number>, player: number, point: number) {
    for (let from of ADJACENCY[point]) {
        if (board[from] !== player + 1) continue;
        if (ADJACENCY[from].some(x => board[x] === 0)) return true;
    }
    return false;
}

enum Winner {
    NONE, RED, YELLOW, DRAW
}

interface WatermelonChessMessage {
    type?: string;
    restart?: boolean;
    from?: number;
    to?: number;
    capture?: number;
}

class WatermelonChessGame extends Game {
    turn: number;
    winner: Winner;
    round: number;
    board: Array<number>;
    lastMove: Array<number> | null;
    pendingCapture: Array<number>;
    positions: Map<string, number>;

    constructor() {
        super();
        this.turn = 0;           // 0 = red, 1 = yellow
        this.winner = Winner.NONE;
        this.round = 0;
        this.board = [];
        this.lastMove = null;    // [from, to] of the last move
        this.pendingCapture = []; // Points the mover may capture from
        this.positions = new Map();
    }

    onRoomCreate() {
        this.turn = 0;
        this.winner = Winner.NONE;
        this.round = 0;
        this.lastMove = null;
        this.pendingCapture = [];
        this.positions = new Map();
        this.board = ADJACENCY.map(() => 0);

        for (let player = 0; player < OPENING.length; player++)
            for (let point of OPENING[player])
                this.board[point] = player + 1;

        this.countPosition();
    }

    /**
     * Can the player whose turn it is move from one point to another?
     * @param {number} from Point to move from
     * @param {number} to Point to move to
     * @return {boolean}
     */
    isLegalMove(from: number, to: number) {
        if (!ADJACENCY[from]) return false;
        if (this.board[from] !== this.turn + 1) return false;
        if (this.board[to] !== 0) return false;
        return ADJACENCY[from].includes(to);
    }

    /**
     * @param {number} player
     * @return {Array<number>} Points holding a piece of the player
     * with every neighbouring point occupied
     */
    trappedPieces(player: number) {
        let trapped: Array<number> = [];
        for (let point = 0; point < this.board.length; point++) {
            if (this.board[point] !== player + 1) continue;
            if (isTrapped(this.board, point)) trapped.push(point);
        }
        return trapped;
    }

    /**
     * @param {number} player
     * @return {Array<number>} Trapped points the player has no move to free
     */
    capturablePieces(player: number) {
        return this.trappedPieces(player)
            .filter(point => !canStepAway(this.board, player, point));
    }

    /**
     * @param {number} player
     * @return {boolean} Can any piece of the player move?
     */
    hasLegalMove(player: number) {
        for (let point = 0; point < this.board.length; point++) {
            if (this.board[point] !== player + 1) continue;
            if (ADJACENCY[point].some(x => this.board[x] === 0))
                return true;
        }
        return false;
    }

    /**
     * @param {number} player
     * @return {number} Pieces the player has on the board
     */
    pieceCount(player: number) {
        return this.board.filter(x => x === player + 1).length;
    }

    /**
     * Record the current position, used for the repetition draw
     * @return {number} Times the position has been reached
     */
    countPosition() {
        let key = `${this.turn}|${this.board.join('')}`;
        let count = (this.positions.get(key) || 0) + 1;
        this.positions.set(key, count);
        return count;
    }

    /**
     * Remove a captured piece, then continue or end the game
     * @param {number} point Point holding the captured piece
     */
    capture(point: number) {
        let victim = this.board[point] - 1;
        this.board[point] = 0;
        this.pendingCapture = [];

        if (this.pieceCount(victim) <= LOSS_PIECE_COUNT) {
            this.winner = victim === 0 ? Winner.YELLOW : Winner.RED;
            return;
        }
        this.advanceTurn();
    }

    /** Give the turn to the other player, checking for a draw */
    advanceTurn() {
        this.round++;
        this.turn = (this.turn + 1) % 2;

        if (this.countPosition() >= REPEAT_LIMIT) {
            this.winner = Winner.DRAW;
            return;
        }
        if (!this.hasLegalMove(this.turn))
            this.winner = Winner.DRAW;
    }

    globalStateSync(player: Client) {
        return {
            type: 'SYNC',
            players: this.players.slice(0, 2).map(x => {
                if (!x) return null;
                return {
                    username: x.username,
                    ready: x.ready
                };
            }),
            board: this.board,
            turn: this.turn,
            round: this.round,
            youAre: this.players.indexOf(player),
            winner: this.winner,
            lastMove: this.lastMove,
            pendingCapture: this.pendingCapture
        };
    }

    onDisconnect(client: Client) {
        super.onDisconnect(client);

        // The player who has to pick a capture left, pick for them
        if (this.pendingCapture.length && this.players[this.turn] === null)
            this.capture(this.pendingCapture[0]);
    }

    onMove(client: Client, message: WatermelonChessMessage) {
        // Message format:
        // { type: 'MOVE', from: <point>, to: <point> }
        // { type: 'MOVE', capture: <point> }

        // Restart (Only if game is over)
        if (message.restart && this.winner) {
            this.onRoomCreate();
            return;
        }

        // Capture choice (Only while a capture is pending)
        if (message.capture !== undefined) {
            if (!this.pendingCapture.includes(message.capture)) return;
            if (client !== this.players[this.turn]) return;

            this.capture(message.capture);
            return;
        }

        // Not enough players
        if (this.playerCount < 2) return;
        // Game is over
        if (this.winner) return;
        // Waiting for a capture to be picked
        if (this.pendingCapture.length) return;
        // Not your turn
        if (client !== this.players[this.turn]) return;
        // Missing or illegal move
        if (message.from === undefined || message.to === undefined) return;
        if (!this.isLegalMove(message.from, message.to)) return;

        this.board[message.from] = 0;
        this.board[message.to] = this.turn + 1;
        this.lastMove = [message.from, message.to];

        let victims = this.capturablePieces(1 - this.turn);
        if (victims.length === 0)
            this.advanceTurn();
        else if (victims.length === 1)
            this.capture(victims[0]);
        else
            this.pendingCapture = victims; // The mover picks one
    }

}

export default WatermelonChessGame;
