/**
 * Piece movement and game rules of Xiang Hex.
 */
import { BLACK, CELLS, CELL_COUNT, DOWN, RED, UP, cellByLabel } from './geometry.js';
import type { Side } from './geometry.js';

export type PieceType = 'general' | 'mandarin' | 'elephant' | 'horse' | 'chariot' | 'cannon' | 'soldier';

export interface Piece {
    side: Side;
    type: PieceType;
}

/** The piece on each cell, or null where it is empty */
export type Board = Array<Piece | null>;

export interface Move {
    from: number;
    to: number;
}

/** Why a game ended */
export type EndReason = 'checkmate' | 'stalemate' | 'repetition' | 'resignation' | 'material';

/** Letter of each piece, uppercase for Red and lowercase for Black */
const LETTERS: Record<PieceType, string> = {
    general: 'G', mandarin: 'M', elephant: 'E', horse: 'H', chariot: 'C', cannon: 'A', soldier: 'S'
};

/** Traditional characters of each piece, Red then Black */
export const GLYPHS: Record<PieceType, [string, string]> = {
    general: ['帥', '將'],
    mandarin: ['仕', '士'],
    elephant: ['相', '象'],
    horse: ['傌', '馬'],
    chariot: ['俥', '車'],
    cannon: ['炮', '砲'],
    soldier: ['兵', '卒']
};

export const PIECE_TYPES = Object.keys(LETTERS) as Array<PieceType>;

const EMPTY_LETTER = '.';

export interface StartingPiece {
    side: Side;
    type: PieceType;
    cell: string;
}

/** Initial position, transcribed from the original diagram */
export const STARTING_POSITION: ReadonlyArray<StartingPiece> = [
    { side: RED, type: 'general', cell: 'E0' },
    { side: RED, type: 'mandarin', cell: 'D0' },
    { side: RED, type: 'mandarin', cell: 'F0' },
    { side: RED, type: 'elephant', cell: 'C0' },
    { side: RED, type: 'elephant', cell: 'G0' },
    { side: RED, type: 'horse', cell: 'B0' },
    { side: RED, type: 'horse', cell: 'H0' },
    { side: RED, type: 'chariot', cell: 'A0' },
    { side: RED, type: 'chariot', cell: 'I0' },
    { side: RED, type: 'cannon', cell: 'B1' },
    { side: RED, type: 'cannon', cell: 'H1' },
    { side: RED, type: 'soldier', cell: 'A1' },
    { side: RED, type: 'soldier', cell: 'C2' },
    { side: RED, type: 'soldier', cell: 'E3' },
    { side: RED, type: 'soldier', cell: 'G2' },
    { side: RED, type: 'soldier', cell: 'I1' },

    { side: BLACK, type: 'general', cell: 'E10' },
    { side: BLACK, type: 'mandarin', cell: 'D9' },
    { side: BLACK, type: 'mandarin', cell: 'F9' },
    { side: BLACK, type: 'elephant', cell: 'C8' },
    { side: BLACK, type: 'elephant', cell: 'G8' },
    { side: BLACK, type: 'horse', cell: 'B7' },
    { side: BLACK, type: 'horse', cell: 'H7' },
    { side: BLACK, type: 'chariot', cell: 'A6' },
    { side: BLACK, type: 'chariot', cell: 'I6' },
    { side: BLACK, type: 'cannon', cell: 'B6' },
    { side: BLACK, type: 'cannon', cell: 'H6' },
    { side: BLACK, type: 'soldier', cell: 'A5' },
    { side: BLACK, type: 'soldier', cell: 'C6' },
    { side: BLACK, type: 'soldier', cell: 'E7' },
    { side: BLACK, type: 'soldier', cell: 'G6' },
    { side: BLACK, type: 'soldier', cell: 'I5' }
];

/**
 * @param {ReadonlyArray<StartingPiece>} setup
 * @return {Board} A board holding the given pieces
 */
export function createBoard(setup: ReadonlyArray<StartingPiece> = STARTING_POSITION): Board {
    const board: Board = new Array(CELL_COUNT).fill(null);
    for (const { side, type, cell } of setup)
        board[cellByLabel(cell)] = { side, type };
    return board;
}

/**
 * @param {Piece} piece
 * @return {string} Letter of the piece, uppercase for Red and lowercase for Black
 */
export function pieceToLetter(piece: Piece) {
    const letter = LETTERS[piece.type];
    return piece.side === RED ? letter : letter.toLowerCase();
}

/**
 * @param {string} letter Output of pieceToLetter
 * @return {Piece | null}
 */
export function letterToPiece(letter: string): Piece | null {
    const type = PIECE_TYPES.find(x => LETTERS[x] === letter.toUpperCase());
    if (!type) return null;
    return { side: letter === letter.toUpperCase() ? RED : BLACK, type };
}

/**
 * @param {Board} board
 * @return {string} One letter per cell, a dot for an empty cell
 */
export function encodeBoard(board: Board) {
    return board.map(piece => piece ? pieceToLetter(piece) : EMPTY_LETTER).join('');
}

/**
 * @param {string} encoded Output of encodeBoard
 * @return {Board}
 */
export function decodeBoard(encoded: string): Board {
    return [...encoded].map(letterToPiece);
}

/**
 * @param {Board} board
 * @param {Side} side
 * @return {number} Cell holding the general of the side, or -1
 */
export function findGeneral(board: Board, side: Side) {
    return board.findIndex(piece => piece?.type === 'general' && piece.side === side);
}

/**
 * Is a cell free for the piece of a side to land on?
 * @param {Board} board
 * @param {number} cell
 * @param {Side} side
 * @return {boolean} Empty or holding an enemy piece
 */
function canLandOn(board: Board, cell: number, side: Side) {
    return cell >= 0 && board[cell]?.side !== side;
}

/**
 * Cells reached by repeatedly stepping in one orthogonal direction
 * until the board ends or a piece is hit
 * @param {Board} board
 * @param {number} from
 * @param {number} direction Index into ORTHOGONAL
 * @return {{ empty: Array<number>, blocker: number }} Empty cells passed and the first occupied cell, or -1
 */
function ray(board: Board, from: number, direction: number) {
    const empty: Array<number> = [];
    let cell = CELLS[from].neighbors[direction];

    while (cell >= 0 && !board[cell]) {
        empty.push(cell);
        cell = CELLS[cell].neighbors[direction];
    }
    return { empty, blocker: cell };
}

/**
 * The first enemy piece beyond exactly one screen on each ray
 * @param {Board} board
 * @param {number} from Cell of a cannon
 * @return {Array<number>} Cells the cannon captures on
 */
function cannonCaptures(board: Board, from: number) {
    const side = (board[from] as Piece).side;
    const captures: Array<number> = [];

    for (let direction = 0; direction < 6; direction++) {
        const { blocker: screen } = ray(board, from, direction);
        if (screen < 0) continue;

        const { blocker: target } = ray(board, screen, direction);
        if (target >= 0 && board[target]?.side !== side)
            captures.push(target);
    }
    return captures;
}

/**
 * Cells a piece may move to, ignoring whether its own general is left in danger
 * @param {Board} board
 * @param {number} from
 * @return {Array<number>}
 */
export function pseudoLegalDestinations(board: Board, from: number): Array<number> {
    const piece = board[from];
    if (!piece) return [];

    const { side, type } = piece;
    const cell = CELLS[from];
    const out: Array<number> = [];

    switch (type) {
        case 'general':
            for (const target of cell.neighbors)
                if (target >= 0 && CELLS[target].palace === side && canLandOn(board, target, side))
                    out.push(target);
            break;
        case 'mandarin':
            for (const target of cell.diagonals)
                if (target >= 0 && CELLS[target].palace === side && canLandOn(board, target, side))
                    out.push(target);
            break;
        case 'elephant':
            for (let direction = 0; direction < 6; direction++) {
                const middle = cell.diagonals[direction];
                if (middle < 0 || board[middle]) continue; // Blocked elephant eye

                const target = CELLS[middle].diagonals[direction];
                if (target >= 0 && CELLS[target].home === side && canLandOn(board, target, side))
                    out.push(target);
            }
            break;
        case 'horse':
            for (let leg = 0; leg < 6; leg++) {
                const first = cell.neighbors[leg];
                if (first < 0 || board[first]) continue; // Blocked horse leg

                // The two diagonals either side of the direction of the leg
                for (const diagonal of [leg, (leg + 1) % 6]) {
                    const target = CELLS[first].diagonals[diagonal];
                    if (canLandOn(board, target, side)) out.push(target);
                }
            }
            break;
        case 'chariot':
            for (let direction = 0; direction < 6; direction++) {
                const { empty, blocker } = ray(board, from, direction);
                out.push(...empty);
                if (canLandOn(board, blocker, side)) out.push(blocker);
            }
            break;
        case 'cannon':
            for (let direction = 0; direction < 6; direction++)
                out.push(...ray(board, from, direction).empty);
            out.push(...cannonCaptures(board, from));
            break;
        case 'soldier': {
            const forward = side === RED ? UP : DOWN;
            const directions = [forward];

            // On the river or past it a soldier may also step to the two forward edge neighbours
            if (cell.home !== side)
                directions.push((forward + 1) % 6, (forward + 5) % 6);
            for (const direction of directions) {
                const target = cell.neighbors[direction];
                if (canLandOn(board, target, side)) out.push(target);
            }
            break;
        }
    }
    return out;
}

/**
 * Does the piece on a cell threaten to capture whatever stands on a target cell?
 * @param {Board} board
 * @param {number} from
 * @param {number} target
 * @return {boolean}
 */
function attacks(board: Board, from: number, target: number) {
    if (board[from]?.type === 'cannon')
        return cannonCaptures(board, from).includes(target);
    return pseudoLegalDestinations(board, from).includes(target);
}

/**
 * @param {Board} board
 * @return {boolean} Do the generals face each other along a column with nothing between them
 */
export function generalsFacing(board: Board) {
    const red = findGeneral(board, RED);
    const black = findGeneral(board, BLACK);
    if (red < 0 || black < 0 || CELLS[red].column !== CELLS[black].column) return false;

    let cell = CELLS[red].neighbors[UP];
    while (cell >= 0 && cell !== black) {
        if (board[cell]) return false;
        cell = CELLS[cell].neighbors[UP];
    }
    return cell === black;
}

/**
 * @param {Board} board
 * @param {Side} side
 * @return {boolean} Can an enemy piece capture the general of the side right now
 */
export function isGeneralThreatened(board: Board, side: Side) {
    const general = findGeneral(board, side);
    if (general < 0) return false;

    for (let cell = 0; cell < board.length; cell++)
        if (board[cell] && board[cell]?.side !== side && attacks(board, cell, general))
            return true;
    return false;
}

/**
 * @param {Board} board
 * @param {Move} move
 * @return {{ board: Board, captured: Piece | null }} A copy of the board after the move
 */
export function applyMove(board: Board, move: Move) {
    const next = board.slice();
    const captured = next[move.to];

    next[move.to] = next[move.from];
    next[move.from] = null;
    return { board: next, captured };
}

/**
 * @param {Board} board
 * @param {number} from
 * @return {Array<number>} Destinations of the piece that do not endanger its general
 */
export function legalDestinations(board: Board, from: number) {
    const piece = board[from];
    if (!piece) return [];

    return pseudoLegalDestinations(board, from).filter(to => {
        const { board: after } = applyMove(board, { from, to });
        return !isGeneralThreatened(after, piece.side) && !generalsFacing(after);
    });
}

/**
 * @param {Board} board
 * @param {Side} side
 * @return {Map<number, Array<number>>} Legal destinations of every piece of the side that can move
 */
export function legalMoves(board: Board, side: Side) {
    const moves = new Map<number, Array<number>>();

    for (let from = 0; from < board.length; from++) {
        if (board[from]?.side !== side) continue;

        const destinations = legalDestinations(board, from);
        if (destinations.length) moves.set(from, destinations);
    }
    return moves;
}

/**
 * Can neither side ever get a piece across the river?
 * Generals, mandarins and elephants are confined to their own half.
 * @param {Board} board
 * @return {boolean}
 */
export function noPieceCanCross(board: Board) {
    return board.every(piece => !piece ||
        piece.type === 'general' || piece.type === 'mandarin' || piece.type === 'elephant');
}

/**
 * @param {Board} board
 * @param {Side} turn Side to move
 * @return {string} Identifies the position for repetition checks
 */
export function positionKey(board: Board, turn: Side) {
    return `${turn}${encodeBoard(board)}`;
}
