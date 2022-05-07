const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');

// Drawing variables
const BOARD_SIZE = 19; // Make sure is consistent with server
const MARGIN = 0.4; // In percentage of cell size
const CIRCLE_SIZE = 0.4; // In percentage of cell size
const MARKER_SIZE = 0.08;

const BOARD_COLOR = '#ffead1';
const LINE_COLOR = '#111';
const BLACK_COLOR = 'black';
const WHITE_COLOR = 'white';
const BLACK_TENTATIVE_COLOR = 'rgba(0, 0, 0, 0.5)';
const WHITE_TENTATIVE_COLOR = 'rgba(255, 255, 255, 0.5)';
const PIECE_BORDER = 'black';
const PIECE_PLACE_BORDER = '#00ff5d'; // When placing, not finalized
const PIECE_TENTATIVE_THICKNESS = 3;

let cellSize = 2;   // Placeholder, will be overwritten on resize


// Game state, shared with client.js
const gameState = {
    started: false,
    board: [],
    turn: 0,
    placing: true, // Is currently placing pieces?
    maxMoves: 2,   // Depends on turn
    moves: [],     // Array of [x,y]

    currentTurn: 0,
    currentRound: 0
}


function mouseToBoardCoordinate(e) {
    const rect = canvas.getBoundingClientRect();
    let x = e.clientX - rect.left;
    let y = e.clientY - rect.top;
    // Snap to nearest grid point
    let gx = Math.round(x / cellSize - 2 * MARGIN);
    let gy = Math.round(y / cellSize - 2 * MARGIN);
    return [gx, gy];
}

function moveAt(x, y) {
    return gameState.moves.some(m => m[0] === x && m[1] === y);
}

window.onmousemove = e => {
    if (gameState.placing) {
        let color1 = gameState.turn === 0 ? BLACK_TENTATIVE_COLOR : WHITE_TENTATIVE_COLOR;
        let [gx, gy] = mouseToBoardCoordinate(e);

        drawBoard();
        if (gameState.moves.length < gameState.maxMoves 
                && gameState.board[gy] && gameState.board[gy][gx] === 0 && !moveAt(gx, gy))
            drawPiece((gx + 2 * MARGIN) * cellSize, (gy + 2 * MARGIN) * cellSize, color1, PIECE_BORDER);
    }
}

window.onmousedown = e => {
    if (!gameState.placing) return;
    let [gx, gy] = mouseToBoardCoordinate(e);
    // Place tentative piece there
    if (gameState.moves.length < gameState.maxMoves &&
            gameState.board[gy] && gameState.board[gy][gx] === 0
            && !moveAt(gx, gy)) {
        gameState.moves.push([gx, gy]);
        drawBoard();
    }
    // Cancel existing move
    else if (moveAt(gx, gy)) {
        gameState.moves = gameState.moves.filter(m => m[0] !== gx || m[1] !== gy);
        drawBoard();
    }
    updateButtonDisabled();
}

window.onresize = () => {
    let size = Math.min(window.innerWidth, window.innerHeight);

    canvas.width = size;
    canvas.style.width = size;
    canvas.height = size;
    canvas.style.height = size;
    cellSize = canvas.width / (BOARD_SIZE + 2 * MARGIN);
    drawBoard();
}
window.onresize();


function drawLine(x1, y1, x2, y2, thickness, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = thickness;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
}

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

function drawPiece(cx, cy, color, strokeColor, thick=1) {
    drawCircle(cx, cy, CIRCLE_SIZE * cellSize, color, strokeColor, thick);
}


/**
 * Redraw the board from board state
 * @param {array} 2D array of board, 1 = black, 2 = white
 */
function drawBoard() {
    let board = gameState.board;

    // Background color
    ctx.rect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = BOARD_COLOR;
    ctx.fill();

    // Grid lines
    let M = 2 * MARGIN * cellSize;
    for (let i = 0; i < BOARD_SIZE; i++) {
        let x = i * cellSize + M;
        drawLine(x, M, x, M + (BOARD_SIZE - 1) * cellSize, 1, LINE_COLOR);
    }
    for (let i = 0; i < BOARD_SIZE; i++) {
        let y = i * cellSize + M;
        drawLine(M, y, M + (BOARD_SIZE - 1) * cellSize, y, 1, LINE_COLOR);
    }

    // Little circles
    for (let x = 3; x <= BOARD_SIZE; x += 6) {
        for (let y = 3; y <= BOARD_SIZE; y += 6) {
            let [cx, cy] = [M + x * cellSize, M + y * cellSize];
            drawCircle(cx, cy, cellSize * MARKER_SIZE, LINE_COLOR, null, 0);
        }
    }

    if (!board || !board.length) return;

    // Pieces
    for (let x = 0; x < BOARD_SIZE; x++)
        for (let y = 0; y < BOARD_SIZE; y++) {
            let state = board[y][x];
            if (!state) continue;
            let color = state === 1 ? BLACK_COLOR : WHITE_COLOR;
            let [cx, cy] = [M + x * cellSize, M + y * cellSize];
            drawPiece(cx, cy, color, PIECE_BORDER);
        }
    
    // Current turn moves
    for (let move of gameState.moves)
        drawPiece(
            (move[0] + 2 * MARGIN) * cellSize,
            (move[1] + 2 * MARGIN) * cellSize,
            gameState.turn === 0 ? BLACK_COLOR : WHITE_COLOR,
            PIECE_PLACE_BORDER, PIECE_TENTATIVE_THICKNESS);

    // Winning line
    if (gameState.winningLine) {
        let [x1, y1, x2, y2] = gameState.winningLine.flat();
        x1 = M + x1 * cellSize;
        y1 = M + y1 * cellSize;
        x2 = M + x2 * cellSize;
        y2 = M + y2 * cellSize;
        drawLine(x1, y1, x2, y2, 8, 'red');
    }
}
