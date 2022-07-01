import Game from '../game.js';
import Client from '../client.js';


class BattlecruiserGame extends Game {
    turn: number;
    winner: Winner;
    round: number;
    winningLine: Array<Array<number>>;
    board: Array<Array<number>>;
    lastMoves: Array<Array<number>>;

    constructor() {
        super();
        this.turn = Turn.BLACK;    // 0 = player 1, 1 = player 2
        this.winner = Winner.NONE; // 0 = no winner, 1 = black, 2 = white, 3 = draw
        this.round = 0;            // Current turn, increments
        this.winningLine = [];     // [[x, y], [x, y]]
        this.lastMoves = [];       // [[x, y], ...]
        this.board = [];           // 2D array of 0, 1 or 2 (empty, black or white)
    }

    onRoomCreate() {
        this.turn = Turn.BLACK;
        this.winner = Winner.NONE;
        this.round = 0;
        this.winningLine = [];
        this.lastMoves = [];

        this.board = [];
        for (let row = 0; row < BOARD_SIZE; row++) {
            this.board.push([]);
            for (let col = 0; col < BOARD_SIZE; col++)
                this.board[row].push(0);
        }
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
            lastMoves: this.lastMoves
        };
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
                return;
            }
        // Draw, if entire board is filled and previous win check
        // hasn't passed
        if (!this.board.some(x => x.some(y => y))) {
            this.winner = Winner.DRAW;
            return;
        }

        // Post changes
        this.round++;
        this.turn = (this.turn + 1) % 2;
    }
}

export default BattlecruiserGame;
