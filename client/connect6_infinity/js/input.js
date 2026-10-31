/* global canvas:false, gameState:false, snapToGrid:false, canPlaceAt:false, moveAt:false, panBy:false,
   zoomAt:false, recenter:false, setHover:false, drawBoard:false, updateHTML:false, jumpTo:false,
   getOpponentLastMoves:false */

/**
 * Mouse, touch and wheel handling for panning, zooming and placing pieces
 */

const DRAG_THRESHOLD = 5; // Pixels a pointer must travel before a press becomes a pan
const WHEEL_ZOOM_SPEED = 0.002;
const PINCH_WHEEL_ZOOM_SPEED = 0.01; // Trackpad pinch gestures arrive as ctrl + wheel
const BUTTON_ZOOM_FACTOR = 1.25;

const pointers = new Map(); // Pointer id to canvas pixel
let gesture = { startX: 0, startY: 0, moved: false };
let pinch = null; // { dist, x, y } of the previous two-finger state

/**
 * Canvas pixel of a pointer event
 * @param {PointerEvent | MouseEvent} e
 * @return {{x: number, y: number}}
 */
function eventToCanvas(e) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: (e.clientX - rect.left - canvas.clientLeft) * canvas.width / canvas.clientWidth,
        y: (e.clientY - rect.top - canvas.clientTop) * canvas.height / canvas.clientHeight
    };
}

/** @return {{dist: number, x: number, y: number}} Distance and midpoint of the first two pointers */
function pinchState() {
    const [a, b] = [...pointers.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Place a tentative piece at a pixel, or cancel the one that is there
 * @param {number} px
 * @param {number} py
 */
function clickAt(px, py) {
    if (!gameState.placing) return;
    let [gx, gy] = snapToGrid(px, py);

    if (canPlaceAt(gx, gy)) {
        gameState.moves.push([gx, gy]);
        drawBoard();
    } else if (moveAt(gx, gy)) { // Cancel existing move
        gameState.moves = gameState.moves.filter(m => m[0] !== gx || m[1] !== gy);
        drawBoard();
    }
    updateHTML();
}

canvas.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);

    const point = eventToCanvas(e);
    pointers.set(e.pointerId, point);

    if (pointers.size === 1)
        gesture = { startX: point.x, startY: point.y, moved: false };
    else if (pointers.size === 2) {
        gesture.moved = true; // Never place a piece after a multi-finger gesture
        pinch = pinchState();
    }
});

canvas.addEventListener('pointermove', e => {
    const point = eventToCanvas(e);

    if (!pointers.has(e.pointerId)) {
        if (e.pointerType === 'mouse') setHover(snapToGrid(point.x, point.y));
        return;
    }

    const prev = pointers.get(e.pointerId);
    pointers.set(e.pointerId, point);

    if (pointers.size === 1) {
        if (!gesture.moved) {
            if (Math.hypot(point.x - gesture.startX, point.y - gesture.startY) <= DRAG_THRESHOLD) return;
            gesture.moved = true;
            panBy(point.x - gesture.startX, point.y - gesture.startY);
        } else
            panBy(point.x - prev.x, point.y - prev.y);
        if (e.pointerType === 'mouse') setHover(snapToGrid(point.x, point.y));
    } else if (pointers.size === 2 && pinch) {
        const now = pinchState();
        panBy(now.x - pinch.x, now.y - pinch.y);
        if (pinch.dist > 0 && now.dist > 0)
            zoomAt(now.x, now.y, now.dist / pinch.dist);
        pinch = now;
    }
});

canvas.addEventListener('pointerup', e => {
    if (!pointers.has(e.pointerId)) return;
    const point = eventToCanvas(e);
    pointers.delete(e.pointerId);
    pinch = null;

    if (pointers.size === 0 && !gesture.moved)
        clickAt(point.x, point.y);
    if (pointers.size === 1)
        gesture.moved = true; // Remaining finger keeps panning, it doesn't place on lift
});

canvas.addEventListener('pointercancel', e => {
    pointers.delete(e.pointerId);
    pinch = null;
    gesture.moved = true;
});

canvas.addEventListener('pointerleave', e => {
    if (e.pointerType === 'mouse') setHover(null);
});

canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const point = eventToCanvas(e);
    let delta = e.deltaY;
    if (e.deltaMode === 1) delta *= 16; // Lines
    else if (e.deltaMode === 2) delta *= 400; // Pages

    zoomAt(point.x, point.y, Math.exp(-delta * (e.ctrlKey ? PINCH_WHEEL_ZOOM_SPEED : WHEEL_ZOOM_SPEED)));
}, { passive: false });

/**
 * Run an action when a board control button is pressed
 * @param {string} id Button id
 * @param {Function} action
 */
function onControl(id, action) {
    const button = document.getElementById(id);
    button.addEventListener('click', () => {
        action();
        button.blur(); // So Enter keeps submitting moves instead of pressing the button
    });
}

onControl('zoom-in', () => zoomAt(canvas.width / 2, canvas.height / 2, BUTTON_ZOOM_FACTOR));
onControl('zoom-out', () => zoomAt(canvas.width / 2, canvas.height / 2, 1 / BUTTON_ZOOM_FACTOR));
onControl('recenter', recenter);

for (const i of [0, 1])
    onControl(`jump${i + 1}`, () => {
        const move = getOpponentLastMoves()[i];
        if (move) jumpTo(move[0], move[1]);
    });

/** Enable the jump buttons for the stones the other player last placed */
// eslint-disable-next-line no-unused-vars
function updateJumpButtons() {
    const moves = getOpponentLastMoves();
    for (const i of [0, 1])
        document.getElementById(`jump${i + 1}`).disabled = !moves[i];
}
