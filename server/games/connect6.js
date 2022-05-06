const Game = require('../game.js');

const BOARD_SIZE = 19;

class Connect6Game extends Game {
    constructor() {
        super();
    }

    onRoomCreate() {
        this.turn = 0; // 0 = player 1, 1 = player 2
        this.win = 0; // 1 = player 1, 2 = player 2
        this.round = 0;

        this.board = [];
        for (let row = 0; row < BOARD_SIZE; row++) {
            this.board.push([]);
            for (let col = 0; col < BOARD_SIZE; col++)
                this.board[row].push(0);
        }
    }

    globalStateSync() {
        return {
            players: this.players.filter(x => x).map(x => {
                return {
                    username: x.username,
                    ready: x.ready
                };
            }),
            board: this.board
        };
    }

    onMove(client, message) {
        // Message format:
        // { type: 'MOVE', moves: [[x, y], [x, y]] }

        // TODO: ACCEPT RESTART GAME FORMAT

        console.log(this.players[this.turn] === client, this.playerCount)

        // Not enough players
        if (this.playerCount < 2) return;
        // Not your turn
        if (client !== this.players[this.turn]) return;
        // Missing move
        if (!message.moves) return;
        // Invalid move
            // Occupied

            // Incorrect format
            // Out of bounds
            // Not enough moves


        // Make move
        let moveCount = this.round === 0 ? 1 : 2; // First player only places 1 piece
        for (let i = 0; i < moveCount; i++) {
            let move = message.moves[i];
            this.board[move[1]][move[0]] = this.turn + 1;
        }

        // Check for wins

        this.round++;
        this.turn = (this.turn + 1) % 2;

        console.log('MOVE MADE')
    }
}

module.exports = Connect6Game;
