import Game from '../game.js';
import Client from '../client.js';
import { BLACK, RED } from '../../client/xiang_hex/js/geometry.js';
import type { Side } from '../../client/xiang_hex/js/geometry.js';
import {
    applyMove, createBoard, encodeBoard, isGeneralThreatened, legalMoves,
    noPieceCanCross, pieceToLetter, positionKey
} from '../../client/xiang_hex/js/rules.js';
import type { Board, EndReason, Move } from '../../client/xiang_hex/js/rules.js';

enum Winner {
    NONE, RED, BLACK, DRAW
}

interface XiangHexMessage {
    type?: string;
    restart?: boolean;
    resign?: boolean;
    from?: number;
    to?: number;
}

interface LastMove extends Move {
    captured: string;
}

class XiangHexGame extends Game {
    turn: Side;
    winner: Winner;
    reason: EndReason | '';
    round: number;
    board: Board;
    lastMove: LastMove | null;
    check: boolean;
    moves: Map<number, Array<number>>;
    positions: Map<string, number>;

    constructor() {
        super();
        this.turn = RED;
        this.winner = Winner.NONE;
        this.reason = '';
        this.round = 0;
        this.board = [];
        this.lastMove = null;
        this.check = false;
        this.moves = new Map();
        this.positions = new Map();
    }

    onRoomCreate() {
        this.turn = RED;
        this.winner = Winner.NONE;
        this.reason = '';
        this.round = 0;
        this.board = createBoard();
        this.lastMove = null;
        this.check = false;
        this.moves = legalMoves(this.board, this.turn);
        this.positions = new Map([[positionKey(this.board, this.turn), 1]]);
    }

    /**
     * End the game
     * @param {Winner} winner
     * @param {EndReason} reason
     */
    finish(winner: Winner, reason: EndReason) {
        this.winner = winner;
        this.reason = reason;
        this.moves = new Map();
    }

    /**
     * Hand the turn to the other side, then see if the game is over
     * @param {Side} mover The side that just moved
     */
    advanceTurn(mover: Side) {
        const mine = mover === RED ? Winner.RED : Winner.BLACK;
        const theirs = mover === RED ? Winner.BLACK : Winner.RED;

        this.round++;
        this.turn = mover === RED ? BLACK : RED;
        this.check = isGeneralThreatened(this.board, this.turn);
        this.moves = legalMoves(this.board, this.turn);

        // A side with no legal move loses, whether or not it is in check
        if (this.moves.size === 0) {
            this.finish(mine, this.check ? 'checkmate' : 'stalemate');
            return;
        }

        const key = positionKey(this.board, this.turn);
        const seen = (this.positions.get(key) ?? 0) + 1;
        this.positions.set(key, seen);

        // Recreating an earlier position loses for the side that did it
        if (seen > 1)
            this.finish(theirs, 'repetition');
        else if (noPieceCanCross(this.board))
            this.finish(Winner.DRAW, 'material');
    }

    globalStateSync(player: Client) {
        const you = this.players.indexOf(player);
        const moves: Record<number, Array<number>> = {};

        if (you === this.turn && !this.winner)
            this.moves.forEach((to, from) => moves[from] = to);

        return {
            type: 'SYNC',
            players: this.players.slice(0, 2).map(x => {
                if (!x) return null;
                return {
                    username: x.username,
                    ready: x.ready
                };
            }),
            board: encodeBoard(this.board),
            turn: this.turn,
            round: this.round,
            youAre: you,
            winner: this.winner,
            reason: this.reason,
            check: this.check,
            lastMove: this.lastMove,
            moves
        };
    }

    onMove(client: Client, message: XiangHexMessage) {
        // Message format:
        // { type: 'MOVE', from: <cell id>, to: <cell id> }
        // { type: 'MOVE', resign: true }
        // { type: 'MOVE', restart: true }
        const seat = this.players.indexOf(client);

        // Restart (Only if game is over)
        if (message.restart && this.winner) {
            if (seat === RED || seat === BLACK) this.onRoomCreate();
            return;
        }

        if (this.playerCount < 2 || this.winner) return;

        if (message.resign) {
            if (seat !== RED && seat !== BLACK) return;
            this.finish(seat === RED ? Winner.BLACK : Winner.RED, 'resignation');
            return;
        }

        if (client !== this.players[this.turn]) return;

        const { from, to } = message;
        if (from === undefined || to === undefined) return;
        if (!this.moves.get(from)?.includes(to)) return;

        const { board, captured } = applyMove(this.board, { from, to });
        this.board = board;
        this.lastMove = { from, to, captured: captured ? pieceToLetter(captured) : '' };
        this.advanceTurn(this.turn);
    }
}

export default XiangHexGame;
