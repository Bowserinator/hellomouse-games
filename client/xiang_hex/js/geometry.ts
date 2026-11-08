/**
 * Board geometry for Xiang Hex.
 *
 * Cells are named by column letter and a bottom-up zero-based index (A0..I6).
 * Every cell also has a vertical coordinate in half cell steps (positive is
 * towards Black) so that neighbouring columns line up on a common axis.
 */

/** 0 = Red (bottom of the board), 1 = Black (top of the board) */
export type Side = 0 | 1;

export const RED: Side = 0;
export const BLACK: Side = 1;

export const COLUMN_LETTERS = 'ABCDEFGHI';
export const COLUMN_HEIGHTS = [7, 8, 9, 10, 11, 10, 9, 8, 7];
export const CELL_COUNT = 79;

/** Offsets [column, half steps up] to the six edge sharing neighbours, counter-clockwise from 30° */
export const ORTHOGONAL: ReadonlyArray<readonly [number, number]> = [
    [1, 1], [0, 2], [-1, 1], [-1, -1], [0, -2], [1, -1]
];

/** Offsets [column, half steps up] to the six cells across a vertex, counter-clockwise from 0° */
export const DIAGONAL: ReadonlyArray<readonly [number, number]> = [
    [2, 0], [1, 3], [-1, 3], [-2, 0], [-1, -3], [1, -3]
];

/** Index into ORTHOGONAL of the neighbour straight up the board */
export const UP = 1;
/** Index into ORTHOGONAL of the neighbour straight down the board */
export const DOWN = 4;

/** Palace cells, taken from the original diagram */
const PALACE_LABELS: ReadonlyArray<ReadonlyArray<string>> = [
    ['E0', 'E1', 'E2', 'D0', 'D1', 'F0', 'F1'],
    ['E10', 'E9', 'E8', 'D9', 'D8', 'F9', 'F8']
];

/** River cells, taken from the original diagram */
const RIVER_LABELS: ReadonlyArray<string> = ['A3', 'C4', 'E5', 'G4', 'I3'];

export interface Cell {
    id: number;
    label: string;
    column: number;
    index: number;
    /** Half steps above the middle of the board */
    height: number;
    /** Center in board units, where one unit is the distance from a cell center to a corner */
    x: number;
    y: number;
    /** Cell ids across each edge or vertex, -1 where the board ends */
    neighbors: Array<number>;
    diagonals: Array<number>;
    /** The side whose palace holds this cell */
    palace: Side | null;
    river: boolean;
    /** The side whose half of the board holds this cell, null on the river */
    home: Side | null;
}

const SQRT3_HALF = Math.sqrt(3) / 2;

export const CELLS: Array<Cell> = [];
const idByPosition = new Map<number, number>();
const idByLabel = new Map<string, number>();

/**
 * @param {number} column
 * @param {number} height Half steps above the middle of the board
 * @return {number} Key identifying a position on the board lattice
 */
function positionKey(column: number, height: number) {
    return column * 64 + height + 32;
}

for (let column = 0; column < COLUMN_HEIGHTS.length; column++)
    for (let index = 0; index < COLUMN_HEIGHTS[column]; index++) {
        const height = 2 * index - (COLUMN_HEIGHTS[column] - 1);
        const id = CELLS.length;
        const label = COLUMN_LETTERS[column] + index;

        CELLS.push({
            id, label, column, index, height,
            x: 1.5 * (column - 4),
            y: -SQRT3_HALF * height,
            neighbors: [], diagonals: [],
            palace: null,
            river: false,
            home: height < 0 ? RED : height > 0 ? BLACK : null
        });
        idByPosition.set(positionKey(column, height), id);
        idByLabel.set(label, id);
    }

/**
 * @param {number} column
 * @param {number} height Half steps above the middle of the board
 * @return {number} Cell id, or -1 if there is no cell there
 */
export function cellAt(column: number, height: number) {
    return idByPosition.get(positionKey(column, height)) ?? -1;
}

/**
 * @param {string} label ie E0
 * @return {number} Cell id, or -1 if the label is not a cell
 */
export function cellByLabel(label: string) {
    return idByLabel.get(label) ?? -1;
}

for (const cell of CELLS) {
    cell.neighbors = ORTHOGONAL.map(([dc, dh]) => cellAt(cell.column + dc, cell.height + dh));
    cell.diagonals = DIAGONAL.map(([dc, dh]) => cellAt(cell.column + dc, cell.height + dh));
}
for (const side of [RED, BLACK])
    for (const label of PALACE_LABELS[side])
        CELLS[cellByLabel(label)].palace = side;
for (const label of RIVER_LABELS)
    CELLS[cellByLabel(label)].river = true;

/**
 * Pixel corners of a cell, the flat sides facing up and down
 * @param {Cell} cell
 * @return {Array<Array<number>>} Six [x, y] corners in board units, corner `k` is at 60k degrees
 */
export function cellCorners(cell: Cell) {
    return [0, 1, 2, 3, 4, 5].map(k => [
        cell.x + Math.cos(k * Math.PI / 3),
        cell.y - Math.sin(k * Math.PI / 3)
    ]);
}

/** Width and height of the playable area in board units */
export const BOARD_WIDTH = 14;
export const BOARD_HEIGHT = 11 * 2 * SQRT3_HALF;
