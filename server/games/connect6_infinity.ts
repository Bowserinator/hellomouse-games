import Game from '../game.js';
import Client from '../client.js';

const BLITZ_TIMES = [60, 180, 300, 600];
const CLOCK_INTERVAL = 250;
const MOVE_TIME_BONUS = 5000;

// Furthest a stone may be placed from the origin along either axis
const MAX_COORD = 1_000_000;
const KEY_SPAN = 2 * MAX_COORD + 1;

enum Turn {
    BLACK, WHITE
}
enum Winner {
    NONE, BLACK, WHITE
}

interface Connect6Message {
    type?: string;
    restart?: boolean;
    moves?: Array<Array<number>>;
    mode?: string;
    highlight?: boolean;
    blitzTime?: number;
}

/**
 * Is this a coordinate pair a stone can be placed at?
 * @param {number} x
 * @param {number} y
 * @return {boolean}
 */
function inRange(x: number, y: number): boolean {
    return Number.isInteger(x) && Number.isInteger(y) &&
        Math.abs(x) <= MAX_COORD && Math.abs(y) <= MAX_COORD;
}

/**
 * Unique number for an in-range coordinate pair
 * @param {number} x
 * @param {number} y
 * @return {number}
 */
function stoneKey(x: number, y: number): number {
    return (x + MAX_COORD) * KEY_SPAN + (y + MAX_COORD);
}

class Connect6InfinityGame extends Game {
    turn: number;
    winner: Winner;
    round: number;
    winningLine: Array<Array<number>>;
    stones: Map<number, number>;
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
        this.winner = Winner.NONE; // 0 = no winner, 1 = black, 2 = white
        this.round = 0;            // Current turn, increments
        this.winningLine = [];     // [[x, y], [x, y]]
        this.lastMoves = [];       // [[x, y], ...]
        this.stones = new Map();   // Occupied spaces, 1 = black, 2 = white
        this.mode = 'normal';
        this.highlight = false;
        this.blitzTime = 300;
        this.clocks = [300000, 300000];
        this.interval = null;
        this.lastClockTick = Date.now();
    }

    /**
     * Color of the stone at a position
     * @param {number} x
     * @param {number} y
     * @return {number} 0 if empty (or out of range), 1 = black, 2 = white
     */
    stoneAt(x: number, y: number): number {
        if (!inRange(x, y)) return 0;
        return this.stones.get(stoneKey(x, y)) ?? 0;
    }

    /**
     * Check for wins along a given direction, checks along
     * vector <x,y> starting at move. The vector extends in both
     * directions (so -<x, y> also checked)
     * @param {Array<number>} move Where a move was made
     * @param {number} x x component of vector to check
     * @param {number} y y component of vector to check
     * @return {boolean} Is there a win?
     */
    checkForWinDir(move: Array<number>, x: number, y: number) {
        let [mx, my] = move;
        let color = this.turn + 1;
        let c = 1;

        let end1 = move;
        let end2 = move;

        for (let step = 1; this.stoneAt(mx + step * x, my + step * y) === color; step++) {
            c++;
            end1 = [mx + step * x, my + step * y];
        }
        for (let step = 1; this.stoneAt(mx - step * x, my - step * y) === color; step++) {
            c++;
            end2 = [mx - step * x, my - step * y];
        }
        if (c >= 6) this.winningLine = [end1, end2];
        return c >= 6;
    }

    checkForWin(move: Array<number>) {
        return this.checkForWinDir(move, 1, 1) || this.checkForWinDir(move, 1, -1) ||
            this.checkForWinDir(move, 0, 1) || this.checkForWinDir(move, 1, 0);
    }

    /**
     * Every stone on the board as a full board message
     * @return {object}
     */
    boardMessage() {
        let stones: Array<number> = []; // Flat list of x, y, color
        for (let [key, color] of this.stones)
            stones.push(Math.floor(key / KEY_SPAN) - MAX_COORD, (key % KEY_SPAN) - MAX_COORD, color);
        return { type: 'BOARD', stones };
    }

    onRoomCreate() {
        this.turn = Turn.BLACK;
        this.winner = Winner.NONE;
        this.round = 0;
        this.winningLine = [];
        this.lastMoves = [];
        this.clocks = [this.blitzTime * 1000, this.blitzTime * 1000];
        this.stones = new Map();

        this.broadcast(this.boardMessage());
        this.updateClockTimer();
    }

    onJoin(client: Client): boolean {
        if (!super.onJoin(client))
            return false;
        client.connection.sendUTF(JSON.stringify(this.boardMessage()));
        return true;
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
        if (!Array.isArray(message.moves)) return;
        // Not enough moves
        let moveCount = this.round === 0 ? 1 : 2; // First player only places 1 piece
        if (message.moves.length !== moveCount) return;

        for (let move of message.moves) {
            // Malformed / out of range / occupied
            if (!Array.isArray(move) || move.length !== 2) return;
            let [mx, my] = move;
            if (!inRange(mx, my) || this.stoneAt(mx, my) !== 0) return;
        }
        // Both stones must be on different spaces
        if (moveCount === 2 && message.moves[0][0] === message.moves[1][0] &&
                message.moves[0][1] === message.moves[1][1]) return;

        // Make move
        let moves = message.moves.map(move => [move[0], move[1]]);
        for (let [mx, my] of moves)
            this.stones.set(stoneKey(mx, my), this.turn + 1);

        this.lastMoves = moves;
        this.broadcast({ type: 'STONES', color: this.turn + 1, moves });

        // Each move adds time back to the clock of the player who made it.
        // This runs before the turn changes, so this.turn is still the mover
        if (this.mode === 'blitz')
            this.clocks[this.turn] += MOVE_TIME_BONUS;

        // Check for wins
        // Only need to check areas around the two moves
        for (let move of moves)
            if (this.checkForWin(move)) {
                this.winner = this.turn + 1;
                this.updateClockTimer();
                return;
            }

        // Post changes
        this.round++;
        this.turn = (this.turn + 1) % 2;
    }
}

export default Connect6InfinityGame;
