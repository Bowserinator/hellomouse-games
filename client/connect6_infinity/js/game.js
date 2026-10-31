const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const coordsLabel = document.getElementById('coords');

// Furthest a stone can be from the origin along either axis (consistent with server)
const MAX_COORD = 1000000;
const KEY_SPAN = 2 * MAX_COORD + 1;

// Drawing variables
const DEFAULT_VISIBLE_CELLS = 20; // Across the canvas at the initial zoom
const MIN_CELL_SIZE = 8;  // In pixels
const MAX_CELL_SIZE = 100;
const CIRCLE_SIZE = 0.4;  // Piece size, in percentage of cell size
const MARKER_SIZE = 0.08;
const MARKER_SPACING = 6; // Grid spaces between the small circles
const RECT_MARKER_SIZE = 0.3; // In percentage of cell size, width

const RECT_MARKER_COLOR = '#F44336';
const BOARD_COLOR = '#ffead1';
const LINE_COLOR = '#111';
const BLACK_COLOR = 'black';
const WHITE_COLOR = 'white';
const BLACK_TENTATIVE_COLOR = 'rgba(0, 0, 0, 0.5)';
const WHITE_TENTATIVE_COLOR = 'rgba(255, 255, 255, 0.5)'; // For "ghost" placement preview
const PIECE_BORDER = 'black';
const PIECE_PLACE_BORDER = '#00ff5d'; // When placing, not finalized
const PIECE_TENTATIVE_THICKNESS = 3;
const BLACK_HIGHLIGHT_COLOR = '#8B0000';
const WHITE_HIGHLIGHT_COLOR = '#FF6666';

const DIRECTIONS = [[1, 0], [0, 1], [1, 1], [1, -1]];

// Game state, shared with client.js
const gameState = {
    started: false,
    stones: new Map(), // Occupied spaces, key from stoneKey() to 1 (black) or 2 (white)
    turn: 0,       // Your turn
    placing: true, // Is currently placing pieces?
    maxMoves: 2,   // Depends on turn
    moves: [],     // Array of [x,y]
    lastMoves: [], // Array of [x,y]

    currentTurn: 0, // Whose turn is it
    currentRound: 0, // Round number, increments by 1 each turn
    youAre: -1,
    players: [null, null],
    mode: 'normal',
    highlight: false,
    blitzTime: 300,
    winner: 0,
    winningLine: []
};

// Board coordinate shown at the center of the canvas, and pixels per grid space
const view = { x: 0, y: 0, cellSize: 30 };

// Grid space under the mouse, or null
let hover = null;

let highlighted = null; // Cache of getHighlightedPositions()
let drawQueued = false;
let sized = false; // Has the canvas been fit to the window yet?


/**
 * Unique number for a grid space
 * @param {number} x
 * @param {number} y
 * @return {number}
 */
function stoneKey(x, y) {
    return (x + MAX_COORD) * KEY_SPAN + (y + MAX_COORD);
}

/**
 * @param {number} x
 * @param {number} y
 * @return {boolean} Is this a grid space that can hold a stone?
 */
function inRange(x, y) {
    return Math.abs(x) <= MAX_COORD && Math.abs(y) <= MAX_COORD;
}

/**
 * @param {number} x
 * @param {number} y
 * @return {number} 0 if empty, 1 = black, 2 = white
 */
function stoneAt(x, y) {
    if (!inRange(x, y)) return 0;
    return gameState.stones.get(stoneKey(x, y)) || 0;
}

/**
 * Replace every stone on the board
 * @param {Array<number>} flat Flat list of x, y, color
 */
function setStones(flat) {
    gameState.stones.clear();
    for (let i = 0; i + 2 < flat.length; i += 3)
        gameState.stones.set(stoneKey(flat[i], flat[i + 1]), flat[i + 2]);
    highlighted = null;
}

/**
 * Add stones of a single color to the board
 * @param {number} color 1 = black, 2 = white
 * @param {Array<Array<number>>} moves Array of [x, y]
 */
function addStones(color, moves) {
    for (let [x, y] of moves)
        gameState.stones.set(stoneKey(x, y), color);
    highlighted = null;
}

/**
 * In gameState.moves, is there a move at this location?
 * @param {number} x
 * @param {number} y
 * @return {boolean}
 */
function moveAt(x, y) {
    return gameState.moves.some(m => m[0] === x && m[1] === y);
}

/**
 * In gameState.lastMoves, is there a move at this location?
 * @param {number} x
 * @param {number} y
 * @return {boolean}
 */
function lastMoveAt(x, y) {
    return gameState.lastMoves.some(m => m[0] === x && m[1] === y);
}

/**
 * Can a new piece be placed here this turn?
 * @param {number} x
 * @param {number} y
 * @return {boolean}
 */
function canPlaceAt(x, y) {
    return gameState.started && !gameState.winner && gameState.moves.length < gameState.maxMoves &&
        inRange(x, y) && stoneAt(x, y) === 0 && !moveAt(x, y);
}


/**
 * Convert a board coordinate to a canvas pixel
 * @param {number} bx
 * @param {number} by
 * @return {Array<number>} [px, py]
 */
function boardToCanvas(bx, by) {
    return [
        canvas.width / 2 + (bx - view.x) * view.cellSize,
        canvas.height / 2 + (by - view.y) * view.cellSize
    ];
}

/**
 * Convert a canvas pixel to a (fractional) board coordinate
 * @param {number} px
 * @param {number} py
 * @return {Array<number>} [bx, by]
 */
function canvasToBoard(px, py) {
    return [
        view.x + (px - canvas.width / 2) / view.cellSize,
        view.y + (py - canvas.height / 2) / view.cellSize
    ];
}

/**
 * Snap a canvas pixel to nearest grid point on the board
 * @param {number} px
 * @param {number} py
 * @return {Array<number>} [board x, board y]
 */
function snapToGrid(px, py) {
    let [bx, by] = canvasToBoard(px, py);
    return [Math.round(bx), Math.round(by)];
}

/**
 * Pan the view
 * @param {number} dx Pixels to move the board by
 * @param {number} dy
 */
function panBy(dx, dy) {
    view.x = Math.max(-MAX_COORD, Math.min(MAX_COORD, view.x - dx / view.cellSize));
    view.y = Math.max(-MAX_COORD, Math.min(MAX_COORD, view.y - dy / view.cellSize));
    requestDraw();
}

/**
 * Zoom, keeping the board point under a canvas pixel in place
 * @param {number} px
 * @param {number} py
 * @param {number} factor Multiplier for the cell size
 */
function zoomAt(px, py, factor) {
    let size = Math.max(MIN_CELL_SIZE, Math.min(MAX_CELL_SIZE, view.cellSize * factor));
    let [bx, by] = canvasToBoard(px, py);

    view.cellSize = size;
    view.x = bx - (px - canvas.width / 2) / size;
    view.y = by - (py - canvas.height / 2) / size;
    requestDraw();
}

/**
 * Move the view to a grid space, keeping the zoom
 * @param {number} x
 * @param {number} y
 */
function jumpTo(x, y) {
    view.x = x;
    view.y = y;
    requestDraw();
}

/**
 * The stones the other player placed on their last turn
 * @return {Array<Array<number>>} Array of [x, y], empty if there are none
 */
function getOpponentLastMoves() {
    let lastMover = gameState.winner ? gameState.winner - 1 : (gameState.currentTurn + 1) % 2;
    return lastMover === gameState.youAre ? [] : gameState.lastMoves;
}

/** Move the view back to the center of the board */
function recenter() {
    view.x = 0;
    view.y = 0;
    requestDraw();
}

/**
 * Set which grid space the mouse is over
 * @param {Array<number> | null} cell [x, y] or null if mouse is not over the board
 */
function setHover(cell) {
    hover = cell;
    requestDraw();
}


/**
 * Find every stone that is part of a window of 6 spaces which
 * holds at least 4 stones of one color and none of the other
 * @return {Set<number>} Keys of the stones
 */
function getHighlightedPositions() {
    if (highlighted) return highlighted;
    highlighted = new Set();
    if (!gameState.highlight) return highlighted;

    for (let [key, color] of gameState.stones) {
        let x = Math.floor(key / KEY_SPAN) - MAX_COORD;
        let y = (key % KEY_SPAN) - MAX_COORD;

        for (let [dx, dy] of DIRECTIONS)
            // Windows where this is the first stone, so each is only visited once
            for (let before = 0; before < 6; before++) {
                if (before > 0 && stoneAt(x - before * dx, y - before * dy) !== 0) break;
                let sx = x - before * dx;
                let sy = y - before * dy;

                let count = 0;
                let blocked = false;
                for (let i = 0; i < 6 && !blocked; i++) {
                    let state = stoneAt(sx + i * dx, sy + i * dy);
                    if (state === color) count++;
                    else if (state !== 0) blocked = true;
                }
                if (blocked || count < 4) continue;

                for (let i = 0; i < 6; i++)
                    if (stoneAt(sx + i * dx, sy + i * dy) === color)
                        highlighted.add(stoneKey(sx + i * dx, sy + i * dy));
            }
    }
    return highlighted;
}


/**
 * Draw a line from (x1, y1) to (x2, y2)
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 * @param {number} thickness
 * @param {string} color
 */
function drawLine(x1, y1, x2, y2, thickness, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = thickness;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
}

/**
 * Draw a circle centered at (x, y)
 * @param {number} x
 * @param {number} y
 * @param {number} radius
 * @param {string} fill
 * @param {string} stroke
 * @param {number} strokeWidth
 */
function drawCircle(x, y, radius, fill, stroke, strokeWidth) {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2 * Math.PI, false);
    if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
    }
    if (stroke) {
        ctx.lineWidth = strokeWidth;
        ctx.strokeStyle = stroke;
        ctx.stroke();
    }
}

/**
 * Fill square centered on (x, y)
 * @param {number} x
 * @param {number} y
 * @param {number} width
 * @param {string} color
 */
function drawCenteredSquare(x, y, width, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x - width / 2, y - width / 2, width, width);
}

/**
 * Draw a single piece on the board
 * @param {number} cx
 * @param {number} cy
 * @param {string} color
 * @param {string} strokeColor
 * @param {number} thick Thickness
 */
function drawPiece(cx, cy, color, strokeColor, thick = 1) {
    drawCircle(cx, cy, CIRCLE_SIZE * view.cellSize, color, strokeColor, thick);
}

/** Show where the view is, and which grid space the mouse is over */
function updateCoordsLabel() {
    let text = `View (${Math.round(view.x)}, ${Math.round(view.y)})`;
    if (hover) text += ` · Cursor (${hover[0]}, ${hover[1]})`;
    coordsLabel.textContent = text;
}

/** Redraw the board from game state and view */
function drawBoard() {
    drawQueued = false;

    let w = canvas.width;
    let h = canvas.height;
    let cell = view.cellSize;
    let pad = cell; // Draw pieces that are partly off screen

    // Background color
    ctx.fillStyle = BOARD_COLOR;
    ctx.fillRect(0, 0, w, h);

    // Visible range of grid spaces
    let [minX, minY] = canvasToBoard(0, 0);
    let [maxX, maxY] = canvasToBoard(w, h);
    let firstX = Math.ceil(minX);
    let lastX = Math.floor(maxX);
    let firstY = Math.ceil(minY);
    let lastY = Math.floor(maxY);

    // Grid lines
    ctx.strokeStyle = LINE_COLOR;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let gx = firstX; gx <= lastX; gx++) {
        let x = boardToCanvas(gx, 0)[0];
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
    }
    for (let gy = firstY; gy <= lastY; gy++) {
        let y = boardToCanvas(0, gy)[1];
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
    }
    ctx.stroke();

    // Little circles every few grid spaces, including the center
    let markerX = Math.ceil(firstX / MARKER_SPACING) * MARKER_SPACING;
    let markerY = Math.ceil(firstY / MARKER_SPACING) * MARKER_SPACING;
    for (let gx = markerX; gx <= lastX; gx += MARKER_SPACING)
        for (let gy = markerY; gy <= lastY; gy += MARKER_SPACING) {
            let [cx, cy] = boardToCanvas(gx, gy);
            drawCircle(cx, cy, cell * MARKER_SIZE, LINE_COLOR, null, 0);
        }

    // Pieces
    let marked = getHighlightedPositions();
    for (let [key, state] of gameState.stones) {
        let x = Math.floor(key / KEY_SPAN) - MAX_COORD;
        let y = (key % KEY_SPAN) - MAX_COORD;
        let [cx, cy] = boardToCanvas(x, y);
        if (cx < -pad || cx > w + pad || cy < -pad || cy > h + pad) continue;

        let color = state === 1 ? BLACK_COLOR : WHITE_COLOR;
        if (marked.has(key))
            color = state === 1 ? BLACK_HIGHLIGHT_COLOR : WHITE_HIGHLIGHT_COLOR;

        drawPiece(cx, cy, color, PIECE_BORDER);

        // It was a last move, mark
        if (lastMoveAt(x, y))
            drawCenteredSquare(cx, cy, RECT_MARKER_SIZE * cell, RECT_MARKER_COLOR);
    }

    // Current turn moves
    for (let move of gameState.moves) {
        let [cx, cy] = boardToCanvas(move[0], move[1]);
        drawPiece(cx, cy,
            gameState.turn === 0 ? BLACK_COLOR : WHITE_COLOR,
            PIECE_PLACE_BORDER, PIECE_TENTATIVE_THICKNESS);
    }

    // Winning line
    if (gameState.winningLine && gameState.winningLine.length === 2) {
        let [[x1, y1], [x2, y2]] = gameState.winningLine;
        [x1, y1] = boardToCanvas(x1, y1);
        [x2, y2] = boardToCanvas(x2, y2);
        drawLine(x1, y1, x2, y2, 8, 'red');
    }

    // Ghost placement
    if (gameState.placing && hover && canPlaceAt(hover[0], hover[1])) {
        let [cx, cy] = boardToCanvas(hover[0], hover[1]);
        let ghost = gameState.turn === 0 ? BLACK_TENTATIVE_COLOR : WHITE_TENTATIVE_COLOR;
        drawPiece(cx, cy, ghost, PIECE_BORDER);
    }

    updateCoordsLabel();
}

/** Redraw before the next frame, once no matter how many times called */
function requestDraw() {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(drawBoard);
}

/** Fit the canvas to the window */
function resizeCanvas() {
    let size = Math.min(window.innerWidth, window.innerHeight);
    if (window.innerWidth > 992)
        size -= 144; // Shrink on large screens, leaving room for the coordinates label

    canvas.width = size;
    canvas.style.width = size + 'px';
    canvas.height = size;
    canvas.style.height = size + 'px';
    if (!sized) view.cellSize = size / DEFAULT_VISIBLE_CELLS;
    sized = true;
    drawBoard();
}

window.onresize = resizeCanvas;
resizeCanvas();
