/* global updateHTML:false, updateMoveReason:false, submitMove:false */
const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');

// Drawing variables
const INNER_RADIUS = 0.45; // Inner ring, in percentage of board radius
const HUB_RADIUS = 0.65; // Arc centers, in percentage of board radius
const ARC_CENTER = 1.337; // Distance of an arc center from the board center
const ARC_RADIUS = 0.687; // Radius of an arc
const ARC_SPAN = 46.7 * Math.PI / 180; // Angle between an arc end and its center
const PIECE_SIZE = 0.09; // Piece size, in percentage of board radius
const HINT_SIZE = 0.05;
const MARKER_SIZE = 0.07;
const CLICK_SIZE = 0.2; // Click tolerance, in percentage of board radius
const BORDER_SIZE = 0.012; // Line thickness, in percentage of board radius

const INK_COLOR = '#241c16';
const RED_COLOR = '#a8322d';
const YELLOW_COLOR = '#e8b73a';
const RED_GHOST_COLOR = 'rgba(168, 50, 45, 0.55)';
const YELLOW_GHOST_COLOR = 'rgba(232, 183, 58, 0.55)';
const RED_HIGHLIGHT_COLOR = '#d8544b';
const YELLOW_HIGHLIGHT_COLOR = '#f5d67a';

// Game state, shared with client.js
const gameState = {
    started: false,
    board: [],       // 21 points, 0 = empty, 1 = red, 2 = yellow
    turn: 0,         // Whose turn is it
    round: 0,        // Round number, increments by 1 each turn
    youAre: -1,
    players: [null, null],
    winner: 0,
    lastMove: null,  // [from, to]
    pendingCapture: [] // Points the mover may capture from
};

// Selection state, not shared with client.js
let selected = null;   // Point holding the piece being moved
let hovered = null;    // Point under the mouse

let captureFrame = null; // Pending animation frame for the capture markers
let boardRadius = 1; // Placeholder, will be overwritten on resize

// Lines between the points, mirrors the server
const ADJACENCY = [
    [1, 2, 3, 4],          // 0
    [0, 2, 4, 5],          // 1
    [0, 1, 3, 6],          // 2
    [0, 2, 4, 7],          // 3
    [0, 1, 3, 8],          // 4
    [1, 9, 10, 20],        // 5
    [2, 11, 12, 13],       // 6
    [3, 14, 15, 16],       // 7
    [4, 17, 18, 19],       // 8
    [5, 10, 20],           // 9
    [5, 9, 11],            // 10
    [6, 10, 12],           // 11
    [6, 11, 13],           // 12
    [6, 12, 14],           // 13
    [7, 13, 15],           // 14
    [7, 14, 16],           // 15
    [7, 15, 17],           // 16
    [8, 16, 18],           // 17
    [8, 17, 19],           // 18
    [8, 18, 20],           // 19
    [5, 19, 9]             // 20
];

/**
 * Snap a mouse event to the nearest board point
 * @param {Event} e Mouse event
 * @return {number} Point, or null if not close to any point
 */
function mouseToBoardCoordinate(e) {
    const rect = canvas.getBoundingClientRect();
    let x = e.clientX - rect.left;
    let y = e.clientY - rect.top;

    let best = null;
    let bestDistance = Math.pow(boardRadius * CLICK_SIZE, 2);

    for (let point = 0; point < ADJACENCY.length; point++) {
        let [px, py] = pointToScreen(point);
        let distance = Math.pow(px - x, 2) + Math.pow(py - y, 2);

        if (distance < bestDistance) {
            bestDistance = distance;
            best = point;
        }
    }
    return best;
}

/**
 * Polar position of a board point
 * @param {number} point
 * @return {Array} [radius, angle in degrees]
 */
function pointPolar(point) {
    if (point === 0) return [0, 0]; // Center
    if (point <= 4) return [INNER_RADIUS, 180 - (point - 1) * 90]; // Inner ring
    if (point <= 8) return [HUB_RADIUS, 180 - (point - 5) * 90]; // Arc centers
    return [1, 180 - (point - 9) * 30]; // Outer ring
}

/**
 * Screen position of a board point
 * @param {number} point
 * @return {Array} [x, y]
 */
function pointToScreen(point) {
    let [radius, angle] = pointPolar(point);
    let radians = angle * Math.PI / 180;
    let center = canvas.width / 2;

    return [
        center + radius * boardRadius * Math.cos(radians),
        center - radius * boardRadius * Math.sin(radians)
    ];
}

/**
 * Can a piece of the given player move from one point to another?
 * @param {number} from
 * @param {number} to
 * @return {boolean}
 */
function isLegalMove(from, to) {
    if (!ADJACENCY[from]) return false;
    if (gameState.board[from] !== gameState.youAre + 1) return false;
    if (gameState.board[to] !== 0) return false;
    return ADJACENCY[from].includes(to);
}

/**
 * @param {number} from
 * @return {Array} Points a piece at `from` can move to
 */
function getLegalMoves(from) {
    return ADJACENCY[from].filter(to => isLegalMove(from, to));
}

/**
 * Forget the current selection
 */
function clearSelection() {
    selected = null;
}

/**
 * Is the player allowed to pick up a piece right now?
 * @return {boolean}
 */
function canMove() {
    if (!gameState.started) return false;
    if (gameState.winner) return false;
    if (gameState.pendingCapture.length) return false;
    return gameState.turn === gameState.youAre;
}

/** Is this player picking which trapped piece to capture? */
function pickingCapture() {
    return gameState.pendingCapture.length > 0 && gameState.turn === gameState.youAre;
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
 * Fill a square centered on (x, y)
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
 * Draw a piece on the board
 * @param {number} cx
 * @param {number} cy
 * @param {string} color
 * @param {string} strokeColor
 * @param {number} thick Thickness
 */
function drawPiece(cx, cy, color, strokeColor, thick = 1) {
    drawCircle(cx, cy, PIECE_SIZE * boardRadius, color, strokeColor, thick);
}

/**
 * Draw the lines of the board, the two circles, the two
 * diameters and the four arcs
 */
function drawLines() {
    let thickness = BORDER_SIZE * boardRadius;
    let center = canvas.width / 2;

    drawCircle(center, center, boardRadius, null, INK_COLOR, thickness);
    drawCircle(center, center, INNER_RADIUS * boardRadius, null, INK_COLOR, thickness);

    // Diameters, from an outer point to the opposite one
    for (let axis of [[9, 15], [12, 18]]) {
        let [x1, y1] = pointToScreen(axis[0]);
        let [x2, y2] = pointToScreen(axis[1]);
        drawLine(x1, y1, x2, y2, thickness, INK_COLOR);
    }

    // Arcs, each drawn as the north arc of a rotated board
    for (let angle of [180, 90, 0, -90]) {
        ctx.save();
        ctx.translate(center, center);
        ctx.rotate((90 - angle) * Math.PI / 180);
        ctx.beginPath();
        ctx.arc(0, -ARC_CENTER * boardRadius, ARC_RADIUS * boardRadius,
            Math.PI / 2 - ARC_SPAN, Math.PI / 2 + ARC_SPAN);
        ctx.lineWidth = thickness;
        ctx.strokeStyle = INK_COLOR;
        ctx.stroke();
        ctx.restore();
    }
}

/**
 * Redraw the board from gameState board state
 */
/** Redraw while the capture markers pulse */
function scheduleCapturePulse() {
    if (captureFrame !== null) return;

    captureFrame = window.requestAnimationFrame(() => {
        captureFrame = null;
        drawBoard();
    });
}

function drawBoard() {
    let board = gameState.board;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawLines();

    // Board not loaded yet
    if (!board || !board.length) return;

    // Legal destinations for the selected piece
    if (selected !== null) {
        for (let to of getLegalMoves(selected))
            drawCircle(...pointToScreen(to), HINT_SIZE * boardRadius, null, INK_COLOR, 2);
    }

    // Pieces
    for (let point = 0; point < ADJACENCY.length; point++) {
        let state = board[point];
        if (!state) continue;

        let color = state === 1 ? RED_COLOR : YELLOW_COLOR;
        if (selected === point)
            color = state === 1 ? RED_HIGHLIGHT_COLOR : YELLOW_HIGHLIGHT_COLOR;

        let thick = selected === point ? 3 : 1;
        drawPiece(...pointToScreen(point), color, INK_COLOR, thick);
    }

    // Pieces the mover may capture, marked with a pulsing ring
    if (pickingCapture()) {
        let beat = Math.abs(Math.sin(performance.now() / 400));

        for (let point of gameState.pendingCapture) {
            let [px, py] = pointToScreen(point);
            drawCircle(px, py, (PIECE_SIZE * 1.5 + beat * PIECE_SIZE * 0.6) * boardRadius, null, RED_COLOR, 3);
        }
        scheduleCapturePulse();
    }

    // Last move, mark where the piece came from and where it went
    if (gameState.lastMove) {
        let [from, to] = gameState.lastMove;
        let [fx, fy] = pointToScreen(from);
        let [tx, ty] = pointToScreen(to);
        drawCenteredSquare(fx, fy, 2 * MARKER_SIZE * boardRadius, 'transparent');
        drawCircle(fx, fy, MARKER_SIZE * boardRadius, null, INK_COLOR, 1);
        drawCenteredSquare(tx, ty, MARKER_SIZE * boardRadius, RED_COLOR);
    }

    // Ghost of the hovered destination
    let ghost = hovered;
    if (selected !== null && ghost !== null && isLegalMove(selected, ghost)) {
        let color = gameState.youAre === 0 ? RED_GHOST_COLOR : YELLOW_GHOST_COLOR;
        drawPiece(...pointToScreen(ghost), color, INK_COLOR);
    }
}

// Update the ghost destination
window.onmousemove = e => {
    let point = mouseToBoardCoordinate(e);
    if (point === hovered) return;

    hovered = point;
    drawBoard();
};

// Pick up, move or cancel a piece
window.onpointerdown = e => {
    // Ignore clicks outside the board, the move would be forgotten
    if (e.target !== canvas) return;

    // While a capture is pending, the only useful click picks the piece
    if (pickingCapture()) {
        let capture = mouseToBoardCoordinate(e);
        if (capture !== null && gameState.pendingCapture.includes(capture))
            selectCapture(capture);
        return;
    }

    if (!canMove()) return;

    let point = mouseToBoardCoordinate(e);
    if (point === null) {
        clearSelection();
        drawBoard();
        updateMoveReason(selected);
        return;
    }

    if (gameState.board[point] === gameState.youAre + 1 && point !== selected) {
        // Pick up a piece
        selected = point;
    } else if (selected !== null && isLegalMove(selected, point)) {
        // Send the move as soon as the destination is picked
        submitMove(selected, point);
        clearSelection();
    } else {
        clearSelection();
    }

    drawBoard();
    updateMoveReason(selected);
};

// Cancel the move with Escape
document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || selected === null) return;

    clearSelection();
    drawBoard();
    updateMoveReason(selected);
});

window.onresize = () => {
    let size = Math.min(window.innerWidth, window.innerHeight);
    if (window.innerWidth > 992)
        size -= 120; // Shrink on large screens

    canvas.width = size;
    canvas.style.width = size + 'px';
    canvas.height = size;
    canvas.style.height = size + 'px';
    boardRadius = 0.42 * canvas.width;
    drawBoard();
};
window.onresize();
