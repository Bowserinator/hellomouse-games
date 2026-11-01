/* global BOARD_SIZE:false, MARGIN:false, renderBoard:false, findForcedWin:false */

/**
 * Saved replays of finished games, and the read-only viewer for them.
 * Replays are kept in the browser, newest first.
 */

const REPLAY_STORAGE_KEY = 'connect6_replays';
const MAX_REPLAYS = 100;
const MIN_REPLAY_MOVES = 6; // Games need more than 5 moves to be saved
const ANALYSIS_MAX_TURNS = 10;
const MAX_ANALYSIS_GAMES = 100;

const replayWinnerNames = { 1: 'Black won', 2: 'White won', 3: 'Draw' };

const replayView = {
    replay: null,
    position: 0,
    analyzing: false,
    analysisToken: 0,
    analysisStart: 0,
    // Forced win found by analysis, false if none was found, null if not run.
    // The win has a list of games and the index of the one shown
    result: null
};

/**
 * @return {Array<object>} Saved replays, newest first
 */
function loadReplays() {
    try {
        let replays = JSON.parse(localStorage.getItem(REPLAY_STORAGE_KEY));
        return Array.isArray(replays) ? replays : [];
    } catch (e) {
        return [];
    }
}

function storeReplays(replays) {
    try {
        localStorage.setItem(REPLAY_STORAGE_KEY, JSON.stringify(replays));
    } catch (e) {
        console.error('Could not save replays', e);
    }
}

/**
 * Short id derived from the contents of a game
 * @param {Array<Array<Array<number>>>} history
 * @param {number} winner
 * @return {string}
 */
function replayId(history, winner) {
    let text = JSON.stringify([history, winner]);
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash.toString(36).padStart(7, '0');
}

/**
 * Save a finished game. Saving the same game again does nothing.
 * @param {Array<Array<Array<number>>>} history Stones placed on each turn
 * @param {number} winner 1 = black, 2 = white, 3 = draw
 * @return {string|null} Id of the replay, or null if the game was too short
 */
// eslint-disable-next-line no-unused-vars
function saveReplay(history, winner) {
    if (!history || history.length < MIN_REPLAY_MOVES) return null;

    let id = replayId(history, winner);
    let replays = loadReplays();
    if (replays.some(r => r.id === id)) return id;

    replays.unshift({ id, time: Date.now(), winner, moves: history });
    storeReplays(replays.slice(0, MAX_REPLAYS));
    return id;
}

/**
 * Board after the first `count` turns of a game
 * @param {Array<Array<Array<number>>>} history
 * @param {number} count
 * @return {Array<Array<number>>}
 */
function boardAfter(history, count) {
    let board = [];
    for (let y = 0; y < BOARD_SIZE; y++) board.push(new Array(BOARD_SIZE).fill(0));

    for (let i = 0; i < count; i++)
        for (let [x, y] of history[i]) board[y][x] = (i % 2) + 1;
    return board;
}

function playerName(turn) {
    return turn === 0 ? 'Black' : 'White';
}


// Rendering

const replayCanvas = document.getElementById('replay-board');
const replayCtx = replayCanvas.getContext('2d');

function replayEl(id) {
    return document.getElementById(id);
}

function renderReplayList() {
    let list = replayEl('replay-list');
    let replays = loadReplays();
    list.innerHTML = '';

    if (replays.length === 0) {
        let empty = document.createElement('div');
        empty.className = 'replay-list-empty';
        empty.innerText = 'No replays saved yet';
        list.appendChild(empty);
        return;
    }

    for (let replay of replays) {
        let item = document.createElement('div');
        item.className = 'replay-item';
        if (replayView.replay && replayView.replay.id === replay.id)
            item.classList.add('active');

        let title = document.createElement('div');
        title.className = 'replay-item-title';
        title.innerText = new Date(replay.time).toLocaleString();

        let subtitle = document.createElement('div');
        subtitle.className = 'replay-item-subtitle';
        subtitle.innerText =
            `${replay.moves.length} moves · ${replayWinnerNames[replay.winner] || 'Unknown'}`;

        item.appendChild(title);
        item.appendChild(subtitle);
        item.onclick = () => selectReplay(replay);
        list.appendChild(item);
    }
}

function drawReplayBoard() {
    let { replay, position, result } = replayView;
    if (!replay) return;

    let size = replayCanvas.width / (BOARD_SIZE + 2 * MARGIN);
    let ghosts = [];
    if (result && result.position === position)
        result.games[result.game].forEach((turn, i) => {
            for (let [x, y] of turn)
                ghosts.push({ x, y, color: (position + i) % 2, label: i + 1 });
        });

    renderBoard(replayCtx, size, {
        board: boardAfter(replay.moves, position),
        lastMoves: position > 0 ? replay.moves[position - 1] : [],
        ghosts,
        winningLine: []
    });
}

function updateReplayControls() {
    let { replay, position } = replayView;
    let total = replay.moves.length;

    replayEl('replay-slider').value = position;
    replayEl('replay-prev').disabled = position <= 0;
    replayEl('replay-next').disabled = position >= total;

    let percent = Math.round(100 * position / total);
    let text = `Move ${position} / ${total} (${percent}%)`;
    if (position > 0)
        text += ` — ${playerName((position - 1) % 2)} played`;
    if (position === total)
        text += ` — ${replayWinnerNames[replay.winner] || ''}`;
    replayEl('replay-position').innerText = text;
}

function turnsText(turns) {
    return `${turns} ${turns === 1 ? 'turn' : 'turns'}`;
}

function updateAnalysisPanel() {
    let { analyzing, result } = replayView;
    let status = replayEl('replay-analysis-status');
    let games = replayEl('replay-games');

    replayEl('replay-analysis').innerText = analyzing ? 'Stop analysis' : 'Analysis';
    games.style.display = result ? 'flex' : 'none';

    if (analyzing)
        status.innerText = 'Analyzing…';
    else if (result === null)
        status.innerText = '';
    else if (result === false)
        status.innerText = 'No forced win found ' +
            `from move ${replayView.analysisStart} on.`;
    else {
        status.innerText = `After move ${result.position}: ` +
            `${playerName(result.position % 2)} wins in ${turnsText(result.turns)}. ` +
            'Numbered stones show one possible game.';

        let shown = result.games.length;
        let of = result.total > shown ? `${shown} of ${result.total}` : `${shown}`;
        replayEl('replay-game-label').innerText = `Game ${result.game + 1} / ${of}`;
        replayEl('replay-game-prev').disabled = result.game <= 0;
        replayEl('replay-game-next').disabled = result.game >= shown - 1;
    }
}

function renderReplay() {
    updateReplayControls();
    drawReplayBoard();
    updateAnalysisPanel();
}

function resizeReplayCanvas() {
    let area = replayEl('replay-board-area');
    let size = Math.floor(Math.min(area.clientWidth, area.clientHeight)) - 2;
    if (size <= 0 || size === replayCanvas.width) return;

    replayCanvas.width = size;
    replayCanvas.height = size;
    replayCanvas.style.width = size + 'px';
    replayCanvas.style.height = size + 'px';
    drawReplayBoard();
}


// Analysis

function stopAnalysis() {
    replayView.analysisToken++;
    replayView.analyzing = false;
}

/**
 * Look for a forced win from the open position through the rest of the game,
 * stopping at the first one found. Does not block the page.
 */
function startAnalysis() {
    let { replay, position } = replayView;
    let token = ++replayView.analysisToken;
    let total = replay.moves.length;

    // Positions with a move still to play, from the current one on
    let first = Math.max(position, 1);
    let order = [];
    for (let p = first; p < total; p++) order.push(p);

    replayView.analyzing = true;
    replayView.analysisStart = first;
    replayView.result = null;

    let analyzeNext = i => {
        if (token !== replayView.analysisToken) return;

        if (i >= order.length) {
            replayView.analyzing = false;
            replayView.result = false;
            renderReplay();
            return;
        }

        let p = order[i];
        let win = findForcedWin(
            boardAfter(replay.moves, p), p % 2, ANALYSIS_MAX_TURNS, MAX_ANALYSIS_GAMES);
        if (win) {
            replayView.analyzing = false;
            replayView.result = { position: p, game: 0, ...win };
            setReplayPosition(p);
            return;
        }
        setTimeout(() => analyzeNext(i + 1), 0);
    };
    renderReplay();
    setTimeout(() => analyzeNext(0), 0);
}

/** Previous / next game buttons handler */
// eslint-disable-next-line no-unused-vars
function stepGame(delta) {
    let { result } = replayView;
    if (!result) return;

    result.game = Math.max(0, Math.min(result.games.length - 1, result.game + delta));
    renderReplay();
}

/** Analysis / stop button handler */
// eslint-disable-next-line no-unused-vars
function toggleAnalysis() {
    if (!replayView.replay) return;

    if (replayView.analyzing)
        stopAnalysis();
    else
        startAnalysis();
    renderReplay();
}


// Navigation

function setReplayPosition(position) {
    let total = replayView.replay.moves.length;
    replayView.position = Math.max(0, Math.min(total, position));
    renderReplay();
}

/** Step button handler */
// eslint-disable-next-line no-unused-vars
function stepReplay(delta) {
    if (replayView.replay) setReplayPosition(replayView.position + delta);
}

/** Slider handler */
// eslint-disable-next-line no-unused-vars
function onReplaySlider() {
    setReplayPosition(parseInt(replayEl('replay-slider').value, 10));
}

function selectReplay(replay) {
    stopAnalysis();
    replayView.replay = replay;
    replayView.position = replay.moves.length;
    replayView.result = null;

    replayEl('replay-empty').style.display = 'none';
    replayEl('replay-content').style.display = 'flex';
    replayEl('replay-slider').max = replay.moves.length;

    renderReplayList();
    resizeReplayCanvas();
    renderReplay();
}

function resetReplayView() {
    stopAnalysis();
    replayView.replay = null;
    replayView.result = null;
    replayEl('replay-empty').style.display = 'block';
    replayEl('replay-content').style.display = 'none';
}


// Modal

function replaysOpen() {
    return document.body.classList.contains('replays-open');
}

// eslint-disable-next-line no-unused-vars
function openReplays() {
    document.body.classList.add('replays-open');
    replayEl('replay-modal').style.display = 'block';
    resetReplayView();
    renderReplayList();
}

function closeReplays() {
    stopAnalysis();
    document.body.classList.remove('replays-open');
    replayEl('replay-modal').style.display = 'none';
}

// eslint-disable-next-line no-unused-vars
function clearReplays() {
    if (!confirm('Delete all saved replays? This cannot be undone.')) return;
    storeReplays([]);
    resetReplayView();
    renderReplayList();
}

document.addEventListener('keydown', event => {
    if (!replaysOpen()) return;
    if (event.key === 'Escape') closeReplays();
    else if (event.key === 'ArrowLeft') stepReplay(-1);
    else if (event.key === 'ArrowRight') stepReplay(1);
    else return;
    event.preventDefault();
});

if (window.ResizeObserver)
    new ResizeObserver(resizeReplayCanvas).observe(replayEl('replay-board-area'));
window.addEventListener('resize', resizeReplayCanvas);
