/**
 * Page logic for Xiang Hex: server communication, the side panel and
 * turning clicks on the board into moves.
 */
import { connectToGame } from '../../shared/ts/game-connection.js';
import { copyInviteLink } from '../../shared/ts/copy-invite-link.js';
import { BLACK, RED } from './geometry.js';
import type { Side } from './geometry.js';
import { decodeBoard, letterToPiece } from './rules.js';
import type { Board, EndReason, Move } from './rules.js';
import { ASPECT, BoardView, PIECE_FONT } from './render.js';

declare function beep(rate?: number): void;

interface SyncMessage {
    players: Array<{ username: string; ready: boolean } | null>;
    board: string;
    turn: Side;
    round: number;
    youAre: number;
    winner: number;
    reason: EndReason | '';
    check: boolean;
    lastMove: (Move & { captured: string }) | null;
    moves: Record<string, Array<number>>;
}

const NAMES = ['Red', 'Black'];

const REASON_TEXT: Record<EndReason, string> = {
    checkmate: 'Checkmate',
    stalemate: 'Stalemate, a player with no legal move loses',
    repetition: 'A position was repeated',
    resignation: 'Resignation',
    material: 'Neither side has a piece that can cross the river'
};

const state = {
    started: false,
    board: [] as Board,
    turn: RED as Side,
    round: -1,
    youAre: -1,
    winner: 0,
    reason: '' as EndReason | '',
    check: false,
    moves: new Map<number, Array<number>>(),
    connected: true
};

let selected: number | null = null;

/**
 * @param {string} id
 * @return {HTMLElement}
 */
function el(id: string) {
    return document.getElementById(id) as HTMLElement;
}

const canvas = el('board') as HTMLCanvasElement;
const view = new BoardView(canvas);

/**
 * @param {number} index 0 = red, 1 = black, else spectator
 * @return {string}
 */
function idToName(index: number) {
    return NAMES[index] ?? 'Spectator';
}

/**
 * Update a player label, setting its color class
 * @param {string} id
 * @param {number} index 0 = red, 1 = black
 */
function setPlayer(id: string, index: number) {
    const label = el(id);
    label.innerText = (NAMES[index] ? `${NAMES[index]} player` : 'Spectator').toUpperCase();
    label.classList.remove('red', 'black', 'spectator');
    label.classList.add(NAMES[index]?.toLowerCase() ?? 'spectator');
}

/** @return {boolean} Is the player allowed to pick up a piece right now */
function canMove() {
    return state.started && !state.winner && state.turn === state.youAre;
}

/** Update the hint below the players */
function updateMoveReason() {
    const reason = el('disabled-reason');
    reason.style.visibility = 'visible';

    if (!state.connected)
        reason.innerText = '⚠️Disconnected from the server';
    else if (state.winner)
        reason.innerText = 'Game is over';
    else if (!state.started)
        reason.innerText = '⚠️Waiting for players';
    else if (state.youAre !== RED && state.youAre !== BLACK)
        reason.innerText = `${idToName(state.turn)}${state.check ? ' is in check' : ' to move'}`;
    else if (state.turn !== state.youAre)
        reason.innerText = '⚠️It\'s not your turn';
    else if (state.check)
        reason.innerText = '⚠️Your General is in check';
    else if (selected === null)
        reason.innerText = '⚠️Pick a piece, then pick where it moves';
    else
        reason.style.visibility = 'hidden';
}

/** Update the pieces and highlights on the board */
function updateView() {
    view.state.board = state.board;
    view.state.selected = selected;
    view.state.destinations = selected === null ? [] : state.moves.get(selected) ?? [];
    view.state.checked = state.check && !state.winner ? state.turn : null;
    view.render();
}

/** Update html on state change */
function updateHTML() {
    const playing = state.youAre === RED || state.youAre === BLACK;
    const turn = el('turn');
    const turnPiece = el('turn-piece');

    setPlayer('youare', playing ? state.youAre : 2);
    turn.classList.remove('red', 'black');
    turn.classList.add(state.turn === BLACK ? 'black' : 'red');

    turnPiece.classList.remove('red', 'black');
    turnPiece.classList.add(state.turn === BLACK ? 'black' : 'red');

    if (state.turn === state.youAre)
        turn.innerText = 'IT IS YOUR TURN';
    else
        turn.innerText = `IT'S ${idToName(state.turn).toUpperCase()}'S TURN`;

    (el('resign') as HTMLButtonElement).disabled = !(playing && state.started && !state.winner);
    updateMoveReason();
}

/** Size the canvas to fit the window */
function resize() {
    let height: number;
    let width: number;

    if (window.innerWidth >= 992) {
        height = Math.max(420, window.innerHeight - 150);
        width = height * ASPECT;
        if (width > window.innerWidth * 0.55) {
            width = window.innerWidth * 0.55;
            height = width / ASPECT;
        }
    } else {
        width = Math.min(window.innerWidth - 24, 640);
        height = width / ASPECT;
    }
    view.resize(Math.floor(width), Math.floor(height));
}

/**
 * Show the result in the end of game dialog
 * @param {number} winner 1 = red, 2 = black, 3 = draw
 */
function showWinner(winner: number) {
    const modal = el('modals');
    if (!winner) {
        modal.style.display = 'none';
        return;
    }

    modal.style.display = 'block';
    el('winner').innerText = winner < 3 ? `${NAMES[winner - 1]} wins!` : 'Draw! No one wins :(';
    el('winner-reason').innerText = state.reason ? REASON_TEXT[state.reason] : '';
}

/**
 * @param {SyncMessage} message
 */
function onSync(message: SyncMessage) {
    state.connected = true;
    const lastMove = message.lastMove;
    const moved = state.round >= 0 && message.round === state.round + 1 && lastMove !== null;
    const previous = state.board;

    state.started = Boolean(message.players[0] && message.players[1]);
    state.board = decodeBoard(message.board);
    state.turn = message.turn;
    state.youAre = message.youAre;
    state.winner = message.winner;
    state.reason = message.reason;
    state.check = message.check;
    state.moves = new Map(Object.entries(message.moves).map(([from, to]) => [Number(from), to]));

    // Keep the selection unless the position changed under it
    if (message.round !== state.round || selected === null || !state.moves.has(selected))
        selected = null;

    view.state.lastMove = lastMove ? { from: lastMove.from, to: lastMove.to } : null;
    view.setFlipped(state.youAre === BLACK);
    el('player0').classList.toggle('missing', !message.players[0]);
    el('player1').classList.toggle('missing', !message.players[1]);
    document.title = `Xiang Hex | ${idToName(state.turn)}'s turn`;

    const mover = lastMove ? previous[lastMove.from] : null;
    if (moved && lastMove && mover) {
        view.animateMove({ from: lastMove.from, to: lastMove.to }, mover, letterToPiece(lastMove.captured));
        beep();
    }
    state.round = message.round;

    showWinner(state.winner);
    updateView();
    updateHTML();
}

/**
 * Send a move to the server
 * @param {number} from Cell holding the piece
 * @param {number} to Cell the piece moves to
 */
function submitMove(from: number, to: number) {
    connection.send({ type: 'MOVE', from, to });
}

const connection = connectToGame({
    gameType: 'xiang_hex',
    pingIntervalInMilliseconds: 10000,
    onMessage: message => {
        if (message.type === 'ERROR')
            alert(String(message.error));
        else if (message.type === 'UUID')
            el('link').innerText = window.location.href;
        else if (message.type === 'SYNC')
            onSync(message as unknown as SyncMessage);
    },
    onClose: () => {
        state.connected = false;
        updateMoveReason();
    }
});

// Pick up, move or cancel a piece
canvas.addEventListener('pointerdown', event => {
    if (!canMove()) return;

    const cell = view.cellAtPoint(event.clientX, event.clientY);
    const destinations = selected === null ? [] : state.moves.get(selected) ?? [];

    if (cell !== null && selected !== null && destinations.includes(cell)) {
        // Send the move as soon as the destination is picked
        submitMove(selected, cell);
        selected = null;
    } else if (cell !== null && cell !== selected && state.board[cell]?.side === state.youAre)
        selected = cell;
    else
        selected = null;

    updateView();
    updateMoveReason();
});

// Hint at what a click would do
canvas.addEventListener('pointermove', event => {
    if (event.pointerType !== 'mouse') return;

    const cell = view.cellAtPoint(event.clientX, event.clientY);
    if (cell === view.state.hovered) return;

    view.state.hovered = cell;
    const clickable = cell !== null && canMove() && (state.board[cell]?.side === state.youAre ||
        (selected !== null && state.moves.get(selected)?.includes(cell)));
    canvas.style.cursor = clickable ? 'pointer' : 'default';
    view.render();
});

canvas.addEventListener('pointerleave', () => {
    view.state.hovered = null;
    view.render();
});

// Cancel the move with Escape
document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || selected === null) return;

    selected = null;
    updateView();
    updateMoveReason();
});

el('game-link').onclick = () => copyInviteLink(el('game-link'), el('link').textContent ?? '');

el('resign').onclick = () => {
    if (confirm('Resign this game?'))
        connection.send({ type: 'MOVE', resign: true });
};

el('play-again').onclick = () => connection.send({ type: 'MOVE', restart: true });

el('new-game').onclick = () => {
    if (confirm('Start a new game?'))
        window.location.href = window.location.href.split('?')[0];
};

window.addEventListener('resize', resize);
resize();
updateHTML();

// Draw again once the piece font is available
document.fonts?.load(`900 40px ${PIECE_FONT}`, '帥仕相傌俥炮兵將士象馬車砲卒楚河漢界').then(() => {
    view.invalidate();
    view.render();
});
