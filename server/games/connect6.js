const Game = require('../game.js');

const BOARD_SIZE = 19;

class Connect6Game extends Game {
    constructor() {
        super();
    }

    checkForWinDir(move, x, y) {
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

    checkForWin(move) {
        return this.checkForWinDir(move, 1, 1) || this.checkForWinDir(move, 1, -1) ||
            this.checkForWinDir(move, 0, 1) || this.checkForWinDir(move, 1, 0);
    }

    onRoomCreate() {
        this.turn = 0; // 0 = player 1, 1 = player 2
        this.win = 0; // 1 = player 1, 2 = player 2
        this.round = 0;
        this.winner = 0;
        this.winningLine = [];

        this.board = [];
        for (let row = 0; row < BOARD_SIZE; row++) {
            this.board.push([]);
            for (let col = 0; col < BOARD_SIZE; col++)
                this.board[row].push(0);
        }
    }

    globalStateSync(player) {
        return {
            players: this.players.map(x => {
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
            winningLine: this.winningLine
        };
    }

    onMove(client, message) {
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

        // Check for wins
        // Only need to check areas around the two moves
        for (let move of message.moves) {
            if (this.checkForWin(move)) {
                this.winner = this.turn + 1;
                return;
            }
        }

        // Post changes
        this.round++;
        this.turn = (this.turn + 1) % 2;
    }
}

module.exports = Connect6Game;
