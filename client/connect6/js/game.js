/* global updateHTML:false */
const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');

// Drawing variables
const BOARD_SIZE = 19; // Make sure is consistent with server
const MARGIN = 0.4; // In percentage of cell size
const CIRCLE_SIZE = 0.4; // Piece size, in percentage of cell size
const MARKER_SIZE = 0.08;
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

let cellSize = 2; // Placeholder, will be overwritten on resize

// Game state, shared with client.js
const gameState = {
    started: false,
    board: [],
    turn: 0,       // Your turn
    placing: true, // Is currently placing pieces?
    maxMoves: 2,   // Depends on turn
    moves: [],     // Array of [x,y]
    lastMoves: [], // Array of [x,y]
    history: [],   // Array of turns, each an array of [x,y]

    currentTurn: 0, // Whose turn is it
    currentRound: 0, // Round number, increments by 1 each turn
    youAre: -1,
    players: [null, null],
    mode: 'normal',
    highlight: false,
    blitzTime: 300
};


/**
 * Snap a mouse event to nearest grid point on the board
 * @param {Event} e Mouse event
 * @return {Array} [board x, board y] (0 indexed)
 */
function mouseToBoardCoordinate(e) {
    const rect = canvas.getBoundingClientRect();
    let x = e.clientX - rect.left;
    let y = e.clientY - rect.top;

    // Snap to nearest grid point
    let gx = Math.round(x / cellSize - 2 * MARGIN);
    let gy = Math.round(y / cellSize - 2 * MARGIN);

    return [gx, gy];
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
 * Positions of stones that are part of a six-window with
 * four of one color and none of the other
 * @param {Array<Array<number>>} board
 * @return {Set<string>} Set of "x,y"
 */
function getHighlightedPositions(board) {
    let highlighted = new Set();

    if (!board || !board.length) return highlighted;

    const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];

    for (let y = 0; y < BOARD_SIZE; y++)
        for (let x = 0; x < BOARD_SIZE; x++)
            for (let [dx, dy] of directions) {
                let xEnd = x + 5 * dx;
                let yEnd = y + 5 * dy;
                if (xEnd < 0 || xEnd >= BOARD_SIZE || yEnd < 0 || yEnd >= BOARD_SIZE)
                    continue;

                let counts = [0, 0, 0];
                for (let i = 0; i < 6; i++)
                    counts[board[y + i * dy][x + i * dx]]++;

                for (let state = 1; state <= 2; state++) {
                    if (counts[state] < 4 || counts[3 - state] > 0) continue;

                    for (let i = 0; i < 6; i++) {
                        let cx = x + i * dx;
                        let cy = y + i * dy;
                        if (board[cy][cx] === state)
                            highlighted.add(`${cx},${cy}`);
                    }
                }
            }

    return highlighted;
}


/**
 * Draw a line from (x1, y1) to (x2, y2)
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 * @param {number} thickness
 * @param {string} color
 */
function drawLine(ctx, x1, y1, x2, y2, thickness, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = thickness;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
}

/**
 * Draw a circle centered at (x, y)
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} radius
 * @param {string} fill
 * @param {string} stroke
 * @param {number} strokeWidth
 */
function drawCircle(ctx, x, y, radius, fill, stroke, strokeWidth) {
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
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} width
 * @param {string} color
 */
function drawCenteredSquare(ctx, x, y, width, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x - width / 2, y - width / 2, width, width);
}

/**
 * Draw a single piece on the board
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} size Cell size in pixels
 * @param {number} cx
 * @param {number} cy
 * @param {string} color
 * @param {string} strokeColor
 * @param {number} thick Thickness
 */
function drawPiece(ctx, size, cx, cy, color, strokeColor, thick = 1) {
    drawCircle(ctx, cx, cy, CIRCLE_SIZE * size, color, strokeColor, thick);
}

/**
 * Render a board onto a canvas context
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} size Cell size in pixels
 * @param {object} state
 * @param {Array<Array<number>>} state.board 2D array of 0, 1 or 2
 * @param {Array<Array<number>>} state.lastMoves Stones to mark as just played
 * @param {Set<string>} [state.highlighted] "x,y" of stones to tint
 * @param {Array<Array<number>>} [state.moves] Unconfirmed stones to outline
 * @param {number} [state.movesTurn] 0 = black, 1 = white, color of state.moves
 * @param {Array<{x: number, y: number, color: number, label: number}>} [state.ghosts]
 *     Hypothetical stones (color 0 = black, 1 = white) drawn translucent with a number
 * @param {Array<Array<number>>} [state.winningLine] [[x, y], [x, y]]
 */
function renderBoard(ctx, size, state) {
    let { board, lastMoves } = state;
    let highlighted = state.highlighted || new Set();

    // Background color
    ctx.beginPath();
    ctx.rect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.fillStyle = BOARD_COLOR;
    ctx.fill();

    // Grid lines
    let M = 2 * MARGIN * size;

    for (let i = 0; i < BOARD_SIZE; i++) {
        let x = i * size + M;
        drawLine(ctx, x, M, x, M + (BOARD_SIZE - 1) * size, 1, LINE_COLOR);
    }
    for (let i = 0; i < BOARD_SIZE; i++) {
        let y = i * size + M;
        drawLine(ctx, M, y, M + (BOARD_SIZE - 1) * size, y, 1, LINE_COLOR);
    }

    // Little circles every 6 grid spaces, starting at (2,2) (0 indexed)
    for (let x = 3; x <= BOARD_SIZE; x += 6)
        for (let y = 3; y <= BOARD_SIZE; y += 6) {
            let [cx, cy] = [M + x * size, M + y * size];
            drawCircle(ctx, cx, cy, size * MARKER_SIZE, LINE_COLOR, null, 0);
        }

    // Board not loaded yet
    if (!board || !board.length) return;

    // Pieces
    for (let x = 0; x < BOARD_SIZE; x++)
        for (let y = 0; y < BOARD_SIZE; y++) {
            let state = board[y][x];

            if (!state) continue; // Empty
            let color = state === 1 ? BLACK_COLOR : WHITE_COLOR;
            if (highlighted.has(`${x},${y}`))
                color = state === 1 ? BLACK_HIGHLIGHT_COLOR : WHITE_HIGHLIGHT_COLOR;
            let [cx, cy] = [M + x * size, M + y * size];

            drawPiece(ctx, size, cx, cy, color, PIECE_BORDER);

            // It was a last move, mark
            if (lastMoves.some(m => m[0] === x && m[1] === y))
                drawCenteredSquare(ctx, cx, cy, RECT_MARKER_SIZE * size, RECT_MARKER_COLOR);
        }

    // Unconfirmed moves
    for (let move of state.moves || [])
        drawPiece(ctx, size,
            (move[0] + 2 * MARGIN) * size,
            (move[1] + 2 * MARGIN) * size,
            state.movesTurn === 0 ? BLACK_COLOR : WHITE_COLOR,
            PIECE_PLACE_BORDER, PIECE_TENTATIVE_THICKNESS);

    // Hypothetical stones
    for (let ghost of state.ghosts || []) {
        let cx = (ghost.x + 2 * MARGIN) * size;
        let cy = (ghost.y + 2 * MARGIN) * size;
        drawPiece(ctx, size, cx, cy,
            ghost.color === 0 ? BLACK_TENTATIVE_COLOR : WHITE_TENTATIVE_COLOR, PIECE_BORDER);

        ctx.fillStyle = ghost.color === 0 ? WHITE_COLOR : BLACK_COLOR;
        ctx.font = `${Math.round(size * 0.5)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(ghost.label), cx, cy);
    }

    // Winning line
    if (state.winningLine && state.winningLine.length) {
        let [x1, y1, x2, y2] = state.winningLine.flat();

        x1 = M + x1 * size;
        y1 = M + y1 * size;
        x2 = M + x2 * size;
        y2 = M + y2 * size;
        drawLine(ctx, x1, y1, x2, y2, 8, 'red');
    }
}

/**
 * Redraw the board from gameState board state
 */
function drawBoard() {
    renderBoard(ctx, cellSize, {
        board: gameState.board,
        lastMoves: gameState.lastMoves,
        highlighted: gameState.highlight ?
            getHighlightedPositions(gameState.board) : new Set(),
        moves: gameState.moves,
        movesTurn: gameState.turn,
        winningLine: gameState.winningLine
    });
}

/**
 * Is a modal overlay capturing input over the board?
 * @return {boolean}
 */
function boardInputBlocked() {
    return document.body.classList.contains('replays-open');
}

// Update ghost placements
window.onmousemove = e => {
    if (gameState.placing && !boardInputBlocked()) {
        let color1 = gameState.turn === 0 ? BLACK_TENTATIVE_COLOR : WHITE_TENTATIVE_COLOR;
        let [gx, gy] = mouseToBoardCoordinate(e);

        drawBoard();
        // Empty space, no tentative move there either, and is placing
        if (gameState.moves.length < gameState.maxMoves &&
                gameState.board[gy] && gameState.board[gy][gx] === 0 && !moveAt(gx, gy))
            drawPiece(ctx, cellSize, (gx + 2 * MARGIN) * cellSize,
                (gy + 2 * MARGIN) * cellSize, color1, PIECE_BORDER);
    }
};

// Attempt ghost placement
window.onpointerdown = e => {
    if (!gameState.placing || boardInputBlocked()) return;
    let [gx, gy] = mouseToBoardCoordinate(e);

    // Place tentative piece there
    if (gameState.moves.length < gameState.maxMoves &&
            gameState.board[gy] && gameState.board[gy][gx] === 0 &&
            !moveAt(gx, gy)) {
        gameState.moves.push([gx, gy]);
        drawBoard();
    } else if (moveAt(gx, gy)) { // Cancel existing move
        gameState.moves = gameState.moves.filter(m => m[0] !== gx || m[1] !== gy);
        drawBoard();
    }
    updateHTML();
};

window.onresize = () => {
    let size = Math.min(window.innerWidth, window.innerHeight);
    if (window.innerWidth > 992)
        size -= 120; // Shrink on large screens

    canvas.width = size;
    canvas.style.width = size + 'px';
    canvas.height = size;
    canvas.style.height = size + 'px';
    cellSize = canvas.width / (BOARD_SIZE + 2 * MARGIN);
    drawBoard();
};
window.onresize();
