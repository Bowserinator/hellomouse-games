import Game from '../game.js';
import Client from '../client.js';

const BOARD_SIZE = 19;
const BLITZ_TIMES = [60, 180, 300, 600];
const CLOCK_INTERVAL = 250;

enum Turn {
    BLACK, WHITE
}
enum Winner {
    NONE, BLACK, WHITE, DRAW
}

interface Connect6Message {
    type?: string;
    restart?: boolean;
    moves?: Array<Array<number>>;
    mode?: string;
    highlight?: boolean;
    blitzTime?: number;
}

class Connect6Game extends Game {
    turn: number;
    winner: Winner;
    round: number;
    winningLine: Array<Array<number>>;
    board: Array<Array<number>>;
    lastMoves: Array<Array<number>>;
    mode: string;
    highlight: boolean;
    blitzTime: number;
    clocks: Array<number>;
    interval: ReturnType<typeof setInterval> | null;
    lastClockTick: number;

    constructor() {
        super();
        this.turn = Turn.BLACK;    // 0 = player 1, 1 = player 2
        this.winner = Winner.NONE; // 0 = no winner, 1 = black, 2 = white, 3 = draw
        this.round = 0;            // Current turn, increments
        this.winningLine = [];     // [[x, y], [x, y]]
        this.lastMoves = [];       // [[x, y], ...]
        this.board = [];           // 2D array of 0, 1 or 2 (empty, black or white)
        this.mode = 'normal';
        this.highlight = false;
        this.blitzTime = 300;
        this.clocks = [300000, 300000];
        this.interval = null;
        this.lastClockTick = Date.now();
    }

    /**
     * Check for wins along a given direction, checks along
     * vector <x,y> starting at move. The vector extends in both
     * directions (so -<x, y> also checked)
     * @param {Array<number>} move Where a move was made
     * @param {number} x x component of vector to check
     * @param {number} y y component of vector to check
     * @return {boolean} Is there a win/
     */
    checkForWinDir(move: Array<number>, x: number, y: number) {
        if (y < 0) {
            y *= -1;
            x *= -1;
        }
        let [mx, my] = move;
        let c = 1;
        let board = this.board;

        let end1 = move;
        let end2 = move;

        // Positive dy
        for (let step = 1; step <= BOARD_SIZE; step++) {
            if (!board[my + step * y]) break;
            if (board[my + step * y][mx + step * x] !== this.turn + 1)
                break;
            c++;
            end1 = [mx + step * x, my + step * y];
        }
        for (let step = -1; step >= -BOARD_SIZE; step--) {
            if (!board[my + step * y]) break;
            if (board[my + step * y][mx + step * x] !== this.turn + 1)
                break;
            c++;
            end2 = [mx + step * x, my + step * y];
        }
        if (c >= 6) this.winningLine = [end1, end2];
        return c >= 6;
    }

    checkForWin(move: Array<number>) {
        return this.checkForWinDir(move, 1, 1) || this.checkForWinDir(move, 1, -1) ||
            this.checkForWinDir(move, 0, 1) || this.checkForWinDir(move, 1, 0);
    }

    onRoomCreate() {
        this.turn = Turn.BLACK;
        this.winner = Winner.NONE;
        this.round = 0;
        this.winningLine = [];
        this.lastMoves = [];
        this.clocks = [this.blitzTime * 1000, this.blitzTime * 1000];

        this.board = [];
        for (let row = 0; row < BOARD_SIZE; row++) {
            this.board.push([]);
            for (let col = 0; col < BOARD_SIZE; col++)
                this.board[row].push(0);
        }

        this.updateClockTimer();
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
            winningLine: this.winningLine,
            lastMoves: this.lastMoves,
            mode: this.mode,
            highlight: this.highlight,
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
            this.winner = this.turn === 0 ? Winner.WHITE : Winner.BLACK;
            this.broadcastClock();
            this.syncAll();
            this.updateClockTimer();
            return;
        }

        this.broadcastClock();
    }

    onMessage(client: Client, message: Connect6Message) {
        if (message.type !== 'SETTINGS') return;
        if (client !== this.players[0] || this.round !== 0) return;

        this.mode = message.mode === 'blitz' ? 'blitz' : 'normal';
        this.highlight = !!message.highlight;
        if (message.blitzTime !== undefined && BLITZ_TIMES.includes(message.blitzTime))
            this.blitzTime = message.blitzTime;
        this.clocks = [this.blitzTime * 1000, this.blitzTime * 1000];
        this.updateClockTimer();

        this.broadcast({
            type: 'SETTINGS',
            mode: this.mode,
            highlight: this.highlight,
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

    onMove(client: Client, message: Connect6Message) {
        // Message format:
        // { type: 'MOVE', moves: [[x, y], [x, y]] }

        // Restart (Only if game is over)
        if (message.restart && this.winner) {
            this.onRoomCreate();
            return;
        }

        // Not enough players
        if (this.playerCount < 2) return;
        // Not your turn
        if (client !== this.players[this.turn]) return;
        // Missing move
        if (!message.moves) return;
        // Not enough moves
        let moveCount = this.round === 0 ? 1 : 2; // First player only places 1 piece
        if (message.moves.length !== moveCount) return;

        for (let move of message.moves) {
            // Invalid move / out of bounds / occupied
            let [mx, my] = move;
            if (!this.board[my] || this.board[my][mx] !== 0) return;
        }

        // Make move
        for (let i = 0; i < moveCount; i++) {
            let move = message.moves[i];
            this.board[move[1]][move[0]] = this.turn + 1;
        }

        this.lastMoves = message.moves;

        // Check for wins
        // Only need to check areas around the two moves
        for (let move of message.moves)
            if (this.checkForWin(move)) {
                this.winner = this.turn + 1;
                this.updateClockTimer();
                return;
            }
        // Draw, if entire board is filled and previous win check
        // hasn't passed
        if (!this.board.some(x => x.some(y => y))) {
            this.winner = Winner.DRAW;
            this.updateClockTimer();
            return;
        }

        // Post changes
        this.round++;
        this.turn = (this.turn + 1) % 2;
    }
}

export default Connect6Game;
