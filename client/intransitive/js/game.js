/* global updateHTML:false, sendMove:false */
const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');

// Drawing variables
const BOARD_SIZE = 9; // Make sure is consistent with server
const PADDING = 0.85; // In percentage of cell size, room for the labels
const PIECE_SIZE = 0.92; // Piece size, in percentage of cell size
const HINT_SIZE = 0.11; // Legal move dot, in percentage of cell size
const HINT_RING_SIZE = 0.42; // Legal move ring, in percentage of cell size
const SELECT_RADIUS = 0.47; // Selection ring, in percentage of cell size
const MARKER_RADIUS = 0.44; // Last move ring, in percentage of cell size
const GRID_STROKE = 1.5;

const PAPER_COLOR = '#fdfbf4';
const LINE_COLOR = '#33302c';
const LABEL_COLOR = '#8a8272';
const HINT_COLOR = 'rgba(51, 48, 44, 0.5)';
const MARKER_COLOR = '#8a8272';
const PLAYER_COLORS = ['#2b4c9b', '#b5342c']; // Blue, red
const PIECE_NAMES = ['rock', 'paper', 'scissors'];
const PIECE_COUNT = PIECE_NAMES.length;
/** Type of piece each piece captures, indexed by type */
const BEATS = [2, 0, 1]; // Rock beats scissors, paper beats rock, scissors beat paper
const COLUMN_LABELS = 'ABCDEFGHI';

/** Square each player starts on */
const BASES = [0, BOARD_SIZE * BOARD_SIZE - 1];

let cellSize = 2; // Placeholder, will be overwritten on resize
let originX = 0; // Canvas x of the left edge of the grid
let originY = 0; // Canvas y of the top edge of the grid
let pieceImages = {}; // Square value -> tinted piece image

// Game state, shared with client.js
const gameState = {
    started: false,
    board: [],
    turn: 0,        // Whose turn it is
    round: 0,
    youAre: -1,     // Your seat
    players: [null, null],
    winner: 0,
    lastMove: null, // [from, to] of the last move
    selected: -1,   // Square you have selected
    mode: 'normal',
    blitzTime: 300,
    movesSinceCapture: 0
};


/**
 * Player owning a square value
 * @param {number} value Square value
 * @return {number} Player, or -1 when the square is empty
 */
function ownerOf(value) {
    if (!value) return -1;
    return Math.floor((value - 1) / PIECE_COUNT);
}

/**
 * Type of a square value
 * @param {number} value Square value
 * @return {number} Piece type
 */
function typeOf(value) {
    return (value - 1) % PIECE_COUNT;
}

/** Are you allowed to move a piece right now? */
function canMove() {
    if (!gameState.started || gameState.winner) return false;
    return gameState.turn === gameState.youAre;
}

/** Drop the current selection */
function clearSelection() {
    gameState.selected = -1;
}

/**
 * Centre of a square, in canvas pixels. Square 0 is A1,
 * which is drawn in the bottom left corner
 * @param {number} square
 * @return {Array<number>} [x, y]
 */
function squareToCanvas(square) {
    let x = square % BOARD_SIZE;
    let y = Math.floor(square / BOARD_SIZE);
    return [
        originX + (x + 0.5) * cellSize,
        originY + (BOARD_SIZE - 0.5 - y) * cellSize
    ];
}

/**
 * Square under a canvas point
 * @param {number} px
 * @param {number} py
 * @return {number} Square, or -1 when outside the grid
 */
function canvasToSquare(px, py) {
    let x = Math.floor((px - originX) / cellSize);
    let row = Math.floor((py - originY) / cellSize);
    if (x < 0 || x >= BOARD_SIZE) return -1;
    if (row < 0 || row >= BOARD_SIZE) return -1;
    return (BOARD_SIZE - 1 - row) * BOARD_SIZE + x;
}

/**
 * Square under a mouse event
 * @param {Event} e Mouse event
 * @return {number} Square, or -1 when outside the grid
 */
function mouseToSquare(e) {
    const rect = canvas.getBoundingClientRect();
    let scale = rect.width ? canvas.width / rect.width : 1;
    return canvasToSquare((e.clientX - rect.left) * scale,
        (e.clientY - rect.top) * scale);
}

/**
 * Squares a piece can move to, empty or capturable
 * @param {number} square Square holding the piece
 * @return {Array<number>} Squares the piece can move to
 */
function movesFrom(square) {
    let moves = [];
    let value = gameState.board[square];
    if (!value) return moves;

    let owner = ownerOf(value);
    let type = typeOf(value);
    let x = square % BOARD_SIZE;
    let y = Math.floor(square / BOARD_SIZE);

    for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            let nx = x + dx;
            let ny = y + dy;
            if (nx < 0 || nx >= BOARD_SIZE) continue;
            if (ny < 0 || ny >= BOARD_SIZE) continue;

            let target = ny * BOARD_SIZE + nx;
            let other = gameState.board[target];
            // An empty square, or an enemy piece this one beats
            if (!other) moves.push(target);
            else if (ownerOf(other) !== owner && BEATS[type] === typeOf(other))
                moves.push(target);
        }
    return moves;
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

/** Draw both corner squares in the colour of the side that owns them */
function drawCorners() {
    // Each corner is a player's base, so both are always filled
    drawTint(BASES[0], PLAYER_COLORS[0], 0.35);
    drawTint(BASES[1], PLAYER_COLORS[1], 0.35);
}

/**
 * Tint a single square
 * @param {number} square
 * @param {string} color
 * @param {number} alpha
 */
function drawTint(square, color, alpha) {
    let [x, y] = squareToCanvas(square);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fillRect(x - cellSize / 2, y - cellSize / 2, cellSize, cellSize);
    ctx.globalAlpha = 1;
}

/** Draw the grid lines */
function drawGrid() {
    let far = BOARD_SIZE * cellSize;

    for (let i = 0; i <= BOARD_SIZE; i++) {
        let x = originX + i * cellSize;
        let y = originY + i * cellSize;
        drawLine(x, originY, x, originY + far, GRID_STROKE, LINE_COLOR);
        drawLine(originX, y, originX + far, y, GRID_STROKE, LINE_COLOR);
    }

    ctx.lineWidth = GRID_STROKE * 2;
    ctx.strokeStyle = LINE_COLOR;
    ctx.strokeRect(originX, originY, far, far);
}

/** Draw the column and row labels */
function drawLabels() {
    ctx.fillStyle = LABEL_COLOR;
    ctx.font = `${Math.round(cellSize * 0.3)}px ${getComputedStyle(document.documentElement).getPropertyValue('--title')}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let x = 0; x < BOARD_SIZE; x++)
        ctx.fillText(COLUMN_LABELS[x], originX + (x + 0.5) * cellSize,
            originY + BOARD_SIZE * cellSize + PADDING * cellSize * 0.5);

    for (let y = 0; y < BOARD_SIZE; y++)
        ctx.fillText(String(y + 1), originX - PADDING * cellSize * 0.5,
            originY + (BOARD_SIZE - 0.5 - y) * cellSize);
}

/** Draw the pieces, the selection and the legal move hints */
function drawPieces() {
    let board = gameState.board;
    if (!board || !board.length) return;

    for (let square = 0; square < board.length; square++) {
        let value = board[square];
        if (!value) continue;

        let [x, y] = squareToCanvas(square);
        let size = PIECE_SIZE * cellSize;
        let image = pieceImages[value];

        if (image) {
            ctx.drawImage(image, x - size / 2, y - size / 2, size, size);
        } else {
            // Placeholder until the piece images load
            drawCircle(x, y, size * 0.32, PLAYER_COLORS[ownerOf(value)], LINE_COLOR, 2);
        }
    }

    if (gameState.selected < 0) return;

    for (let target of movesFrom(gameState.selected)) {
        let [x, y] = squareToCanvas(target);
        if (board[target])
            drawCircle(x, y, HINT_RING_SIZE * cellSize, null, HINT_COLOR, 3);
        else
            drawCircle(x, y, HINT_SIZE * cellSize, HINT_COLOR, null, 0);
    }

    let [sx, sy] = squareToCanvas(gameState.selected);
    drawCircle(sx, sy, SELECT_RADIUS * cellSize, null,
        PLAYER_COLORS[gameState.youAre], 3);
}

/** Mark where the last move ended */
function drawLastMove() {
    if (!gameState.lastMove) return;

    let [x, y] = squareToCanvas(gameState.lastMove[1]);
    ctx.setLineDash([cellSize * 0.15, cellSize * 0.1]);
    drawCircle(x, y, MARKER_RADIUS * cellSize, null, MARKER_COLOR, 2.5);
    ctx.setLineDash([]);
}

/**
 * Redraw the board from gameState board state
 */
function drawBoard() {
    // Background color
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = PAPER_COLOR;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    drawCorners();
    drawGrid();
    drawLabels();
    drawPieces();
    drawLastMove();
}

/**
 * Recolor a piece image, keeping the shape of its outline
 * @param {HTMLImageElement} image
 * @param {string} color
 * @return {HTMLCanvasElement}
 */
function tintPiece(image, color) {
    let tinted = document.createElement('canvas');
    tinted.width = image.width;
    tinted.height = image.height;

    let g = tinted.getContext('2d');
    g.drawImage(image, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = color;
    g.fillRect(0, 0, tinted.width, tinted.height);

    return tinted;
}

/** Load the piece images and prepare one tinted copy per player */
function loadPieces() {
    let pending = PIECE_NAMES.length;

    PIECE_NAMES.forEach((name, type) => {
        let image = new Image();
        image.onload = () => {
            for (let player = 0; player < 2; player++)
                pieceImages[player * PIECE_COUNT + type + 1] =
                    tintPiece(image, PLAYER_COLORS[player]);

            if (--pending === 0) drawBoard();
        };
        image.src = `/intransitive/img/${name}.png`;
    });
}

// Click your own piece, then click a square to move onto it
window.onpointerdown = e => {
    let square = mouseToSquare(e);

    // Clicked outside the grid, drop the selection
    if (square < 0) {
        clearSelection();
        drawBoard();
        return;
    }

    // Finish the move
    if (gameState.selected >= 0 && movesFrom(gameState.selected).includes(square)) {
        let from = gameState.selected;
        clearSelection();
        drawBoard();
        sendMove(from, square);
        return;
    }

    // Select one of your pieces, or click it again to cancel
    if (canMove() && ownerOf(gameState.board[square]) === gameState.youAre)
        gameState.selected = gameState.selected === square ? -1 : square;
    else
        clearSelection();

    drawBoard();
    updateHTML();
};

// Cancel the selection
document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    clearSelection();
    drawBoard();
});

window.onresize = () => {
    let size = Math.min(window.innerWidth, window.innerHeight);
    if (window.innerWidth > 992)
        size -= 120; // Shrink on large screens

    canvas.width = size;
    canvas.style.width = size + 'px';
    canvas.height = size;
    canvas.style.height = size + 'px';
    cellSize = canvas.width / (BOARD_SIZE + 2 * PADDING);
    originX = PADDING * cellSize;
    originY = PADDING * cellSize;
    drawBoard();
};
window.onresize();
loadPieces();
document.fonts.ready.then(drawBoard);
