import Game from '../game.js';
import Client from '../client.js';

const BOARD_SIZE = 9;
const SQUARES = BOARD_SIZE * BOARD_SIZE;
const BLITZ_TIMES = [60, 180, 300, 600];
const CLOCK_INTERVAL = 250;
const MOVE_TIME_BONUS = 5000;

/** Moves without a capture that end the game in a draw */
const DRAW_MOVE_LIMIT = 100;

enum Piece {
    ROCK, PAPER, SCISSORS
}

/** Type of piece each piece captures */
const BEATS = [Piece.SCISSORS, Piece.ROCK, Piece.PAPER];

enum Winner {
    NONE, BLUE, RED, DRAW
}

/**
 * Square each player wins by reaching, in player order.
 * Player 0 starts on A1 and wins on I9, player 1 is the reverse.
 */
const GOAL = [SQUARES - 1, 0];

/**
 * Starting pieces for each player, as [x, y, type].
 * x runs 0-8 from column A to I, y runs 0-8 from row 1 to 9.
 */
const OPENING: Array<Array<Array<number>>> = [
    [
        [1, 3, Piece.ROCK], [2, 2, Piece.ROCK], [3, 1, Piece.ROCK],
        [1, 4, Piece.PAPER], [2, 3, Piece.PAPER], [3, 2, Piece.PAPER],
        [4, 1, Piece.PAPER],
        [2, 4, Piece.SCISSORS], [3, 3, Piece.SCISSORS], [4, 2, Piece.SCISSORS]
    ],
    [
        [4, 6, Piece.SCISSORS], [5, 5, Piece.SCISSORS], [6, 4, Piece.SCISSORS],
        [4, 7, Piece.PAPER], [5, 6, Piece.PAPER], [6, 5, Piece.PAPER],
        [7, 4, Piece.PAPER],
        [5, 7, Piece.ROCK], [6, 6, Piece.ROCK], [7, 5, Piece.ROCK]
    ]
];

/**
 * A square holds 0 when empty, else a piece of
 * `owner * 3 + type + 1`, so a player owns values
 * `player * 3 + 1` through `player * 3 + 3`
 * @param {number} value Square value
 * @return {number} Player owning the piece
 */
function ownerOf(value: number) {
    return Math.floor((value - 1) / 3);
}

/**
 * @param {number} value Square value
 * @return {number} Type of the piece
 */
function typeOf(value: number) {
    return (value - 1) % 3;
}

interface IntransitiveMessage {
    type?: string;
    restart?: boolean;
    from?: number;
    to?: number;
    mode?: string;
    blitzTime?: number;
}

class IntransitiveGame extends Game {
    turn: number;
    winner: Winner;
    round: number;
    board: Array<number>;
    lastMove: Array<number> | null;
    movesSinceCapture: number;
    mode: string;
    blitzTime: number;
    clocks: Array<number>;
    interval: ReturnType<typeof setInterval> | null;
    lastClockTick: number;

    constructor() {
        super();
        this.turn = 0;            // 0 = blue, 1 = red
        this.winner = Winner.NONE;
        this.round = 0;           // Current turn, increments
        this.board = [];          // 0 empty, else owner * 3 + type + 1
        this.lastMove = null;     // [from, to] of the last move
        this.movesSinceCapture = 0;
        this.mode = 'normal';
        this.blitzTime = 300;
        this.clocks = [300000, 300000];
        this.interval = null;
        this.lastClockTick = Date.now();
    }

    onRoomCreate() {
        this.turn = 0;
        this.winner = Winner.NONE;
        this.round = 0;
        this.lastMove = null;
        this.movesSinceCapture = 0;
        this.clocks = [this.blitzTime * 1000, this.blitzTime * 1000];
        this.board = new Array<number>(SQUARES).fill(0);

        for (let player = 0; player < OPENING.length; player++)
            for (let [x, y, type] of OPENING[player])
                this.board[y * BOARD_SIZE + x] = player * 3 + type + 1;

        this.updateClockTimer();
    }

    /**
     * Squares a piece can move to. A piece moves like a king in
     * chess, and takes an enemy piece it beats.
     * @param {number} square Square holding the piece
     * @return {Array<number>} Squares the piece can move to
     */
    movesFrom(square: number) {
        let moves: Array<number> = [];
        let value = this.board[square];
        if (!value) return moves;

        let x = square % BOARD_SIZE;
        let y = Math.floor(square / BOARD_SIZE);
        let owner = ownerOf(value);
        let type = typeOf(value);

        for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) continue;
                let nx = x + dx;
                let ny = y + dy;
                if (nx < 0 || nx >= BOARD_SIZE) continue;
                if (ny < 0 || ny >= BOARD_SIZE) continue;

                let target = ny * BOARD_SIZE + nx;
                let other = this.board[target];
                // An empty square, or an enemy piece this one beats
                if (other === 0) moves.push(target);
                else if (ownerOf(other) !== owner && BEATS[type] === typeOf(other))
                    moves.push(target);
            }

        return moves;
    }

    /**
     * @param {number} from Square to move from
     * @param {number} to Square to move to
     * @return {boolean} Can the player whose turn it is make this move?
     */
    isLegalMove(from: number, to: number) {
        if (from < 0 || from >= SQUARES) return false;
        if (to < 0 || to >= SQUARES) return false;
        let value = this.board[from];
        if (value === 0 || ownerOf(value) !== this.turn) return false;
        return this.movesFrom(from).includes(to);
    }

    /**
     * @param {number} player
     * @return {boolean} Can any piece of the player move?
     */
    hasLegalMove(player: number) {
        for (let square = 0; square < SQUARES; square++) {
            let value = this.board[square];
            if (value === 0 || ownerOf(value) !== player) continue;
            if (this.movesFrom(square).length) return true;
        }
        return false;
    }

    /**
     * @param {number} player
     * @return {number} Pieces the player has on the board
     */
    pieceCount(player: number) {
        let count = 0;
        for (let value of this.board)
            if (value !== 0 && ownerOf(value) === player) count++;
        return count;
    }

    /**
     * End the game and stop the clock
     * @param {Winner} winner
     */
    finish(winner: Winner) {
        this.winner = winner;
        this.updateClockTimer();
    }

    /** Give the turn to the other player, checking for a draw */
    advanceTurn() {
        this.round++;
        this.turn = (this.turn + 1) % 2;

        if (!this.hasLegalMove(this.turn))
            this.finish(Winner.DRAW);
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
            movesSinceCapture: this.movesSinceCapture,
            mode: this.mode,
            blitzTime: this.blitzTime,
            clocks: this.clocks
        };
    }

    syncAll() {
        for (let player of this.players) {
            if (!player) continue;
            let msg = this.globalStateSync(player);
            msg.type = 'SYNC';
            player.connection.sendUTF(JSON.stringify(msg));
        }
    }

    broadcastClock() {
        this.broadcast({
            type: 'CLOCK',
            clocks: this.clocks,
            turn: this.turn
        });
    }

    updateClockTimer() {
        let shouldRun = this.mode === 'blitz' && !this.winner;

        if (shouldRun && this.interval === null) {
            this.lastClockTick = Date.now();
            this.interval = setInterval(() => this.clockTick(), CLOCK_INTERVAL);
        } else if (!shouldRun && this.interval !== null) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }

    clockTick() {
        let now = Date.now();
        let dt = now - this.lastClockTick;
        this.lastClockTick = now;

        if (this.mode !== 'blitz' || this.winner || this.round === 0 ||
            !this.players[0] || !this.players[1]) return;

        this.clocks[this.turn] -= dt;
        if (this.clocks[this.turn] <= 0) {
            this.clocks[this.turn] = 0;
            this.finish(this.turn === 0 ? Winner.RED : Winner.BLUE);
            this.broadcastClock();
            this.syncAll();
            return;
        }

        this.broadcastClock();
    }

    onMessage(client: Client, message: IntransitiveMessage) {
        if (message.type !== 'SETTINGS') return;
        if (client !== this.players[0] || this.round !== 0) return;

        this.mode = message.mode === 'blitz' ? 'blitz' : 'normal';
        if (message.blitzTime !== undefined && BLITZ_TIMES.includes(message.blitzTime))
            this.blitzTime = message.blitzTime;
        this.clocks = [this.blitzTime * 1000, this.blitzTime * 1000];
        this.updateClockTimer();

        this.broadcast({
            type: 'SETTINGS',
            mode: this.mode,
            blitzTime: this.blitzTime
        });
        this.broadcastClock();
    }

    onRemove() {
        if (this.interval !== null) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }

    onMove(client: Client, message: IntransitiveMessage) {
        // Message format:
        // { type: 'MOVE', from: <square>, to: <square> }

        // Restart (Only if game is over)
        if (message.restart && this.winner) {
            this.onRoomCreate();
            return;
        }

        // Not enough players
        if (this.playerCount < 2) return;
        // Game is over
        if (this.winner) return;
        // Not your turn
        if (client !== this.players[this.turn]) return;
        // Missing or illegal move
        if (message.from === undefined || message.to === undefined) return;
        if (!this.isLegalMove(message.from, message.to)) return;

        // Make move
        let captured = this.board[message.to] !== 0;
        this.board[message.to] = this.board[message.from];
        this.board[message.from] = 0;
        this.lastMove = [message.from, message.to];

        // Each move adds time back to the clock of the player who made it.
        // This runs before the turn changes, so this.turn is still the mover
        if (this.mode === 'blitz')
            this.clocks[this.turn] += MOVE_TIME_BONUS;

        if (captured) this.movesSinceCapture = 0;
        else this.movesSinceCapture++;

        // A piece reached the enemy goal
        if (message.to === GOAL[this.turn]) {
            this.finish(this.turn === 0 ? Winner.BLUE : Winner.RED);
            return;
        }
        // The other player has no pieces left
        if (this.pieceCount(1 - this.turn) === 0) {
            this.finish(this.turn === 0 ? Winner.BLUE : Winner.RED);
            return;
        }
        // No capture for too long
        if (this.movesSinceCapture >= DRAW_MOVE_LIMIT) {
            this.finish(Winner.DRAW);
            return;
        }

        this.advanceTurn();
    }
}

export default IntransitiveGame;
