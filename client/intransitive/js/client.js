/* global gameState:false, drawBoard:false, clearSelection:false, createConnection:false, beep:false, copyToClipboard:false */

/**
 * All UI / server communication stuff
 * goes here. Game state is shared between
 * this and games.js
 */

const connection = createConnection();

// url?<GAME UUID>=
const uuid = window.location.search.substr(1).split('=')[0];

const BLITZ_TIME_OPTIONS = [60, 180, 300, 600];


/**
 * Update a player div, setting color class
 * @param {string} id ID of div
 * @param {number} index 0 = blue, 1 = red, else spectator
 */
function setPlayer(id, index) {
    let div = document.getElementById(id);

    div.innerText = idToName(index).toUpperCase();
    div.classList.remove('blue');
    div.classList.remove('red');

    if (index === 0) div.classList.add('blue');
    else if (index === 1) div.classList.add('red');
}

/**
 * Convert turn number to name
 * @param {number} i 0 = blue, 1 = red, else spectator
 * @return {string}
 */
function idToName(i) {
    if (i === 0) return 'Blue';
    else if (i === 1) return 'Red';
    return 'Spectator';
}

/** Update html on state change */
function updateHTML() {
    setPlayer('youare', gameState.youAre);

    // Update turn label
    setPlayer('turn', gameState.turn);
    let turn = document.getElementById('turn');
    let turnPiece = document.getElementById('turn-piece');

    turnPiece.classList.remove('blue');
    turnPiece.classList.remove('red');
    turnPiece.classList.add(gameState.turn === 0 ? 'blue' : 'red');

    if (gameState.turn === gameState.youAre)
        turn.innerText = 'IT IS YOUR TURN';
    else
        turn.innerText = `IT'S ${idToName(gameState.turn).toUpperCase()}'S TURN`;

    // Update the reason the player cannot move
    let reason = document.getElementById('disabled-reason');
    reason.style.visibility = 'visible';

    if (gameState.winner)
        reason.innerText = 'Game is over';
    else if (!gameState.started)
        reason.innerText = '⚠️Waiting for players';
    else if (gameState.turn !== gameState.youAre)
        reason.innerText = '⚠️It\'s not your turn';
    else if (gameState.selected >= 0)
        reason.innerText = 'Click a dotted square to move there';
    else
        reason.style.visibility = 'hidden';
}

let clockSync = { clocks: [300000, 300000], turn: 0, at: 0 };

/** Show or hide the settings the host can change before the game starts */
function updateLobbySettings() {
    let isHost = gameState.youAre === 0;
    let canChange = isHost && gameState.round === 0;
    let show = gameState.youAre >= 0;

    document.getElementById('lobby-settings').style.display = show ? 'flex' : 'none';
    document.getElementById('blitz-time-setting').style.display =
        (show && gameState.mode === 'blitz') ? 'flex' : 'none';

    document.getElementById('setting-mode').disabled = !canChange;
    document.getElementById('setting-blitz-time').disabled = !canChange;
}

/** Show or hide the two clocks */
function setTimersVisibility() {
    document.getElementById('timers').style.display =
        gameState.mode === 'blitz' ? 'inline-flex' : 'none';
}

/**
 * Apply the settings the server reported
 * @param {Object} message SETTINGS or SYNC message
 */
function applySettings(message) {
    gameState.mode = message.mode === 'blitz' ? 'blitz' : 'normal';
    if (BLITZ_TIME_OPTIONS.includes(message.blitzTime))
        gameState.blitzTime = message.blitzTime;

    document.getElementById('setting-mode').value = gameState.mode;
    document.getElementById('setting-blitz-time').value = String(gameState.blitzTime);

    setTimersVisibility();
    updateLobbySettings();
    drawBoard();
}

/** Send the settings the host picked to the server */
function onSettingChange() {
    let mode = document.getElementById('setting-mode').value;
    let blitzTime = parseInt(document.getElementById('setting-blitz-time').value, 10);

    applySettings({ mode: mode, blitzTime: blitzTime });
    connection.send(JSON.stringify({
        type: 'SETTINGS',
        mode: mode,
        blitzTime: blitzTime
    }));
}

/**
 * Format a clock as m:ss
 * @param {number} ms Milliseconds left
 * @return {string}
 */
function clockText(ms) {
    if (ms < 0) ms = 0;
    let seconds = Math.floor(ms / 1000);
    let m = Math.floor(seconds / 60);
    let s = seconds % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
}

/** Draw the clocks, taking the time since the last sync into account */
function renderClocks() {
    let seats = gameState.players;
    let running = gameState.mode === 'blitz' && gameState.started &&
        gameState.round > 0 && !gameState.winner && seats[0] && seats[1];
    let now = performance.now();

    for (let i = 0; i < 2; i++) {
        let ms = clockSync.clocks[i];
        if (running && clockSync.turn === i) ms -= now - clockSync.at;

        document.getElementById(`timer${i}-time`).innerText = clockText(ms);
        document.getElementById(`timer${i}`)
            .classList.toggle('running', running && clockSync.turn === i);
    }
}

/**
 * Take the clocks the server reported
 * @param {Array<number>} clocks Milliseconds left for each player
 * @param {number} turn Player whose clock is running
 */
function syncClock(clocks, turn) {
    clockSync = {
        clocks: clocks && clocks.length === 2 ? clocks.slice() : clockSync.clocks,
        turn: turn,
        at: performance.now()
    };
    renderClocks();
}

function clockLoop() {
    if (gameState.mode === 'blitz') renderClocks();
    requestAnimationFrame(clockLoop);
}

/**
 * Send a move to the server, used by game.js
 * @param {number} from Square to move from
 * @param {number} to Square to move to
 */
function sendMove(from, to) {
    connection.send(JSON.stringify({ type: 'MOVE', from: from, to: to }));
}

/** Send restart signal, used in restart modal */
// eslint-disable-next-line no-unused-vars
function restart() {
    connection.send(JSON.stringify({ type: 'MOVE', restart: true }));
}

// Connection handling
connection.onopen = () => {
    if (uuid.length === 0) // Create a new game
        connection.send(JSON.stringify({ type: 'CREATE', gameType: 'intransitive' }));
    else // Join existing game
        connection.send((JSON.stringify({ type: 'JOIN', gameID: uuid })));
};

connection.onerror = error => console.error(error);

connection.onmessage = message => {
    message = JSON.parse(message.data);

    if (message.type === 'ERROR') {
        if (message.code === 'NO_GAME')
            window.location.href = window.location.href.split('?')[0];
        alert(message.error);
    } else if (message.type === 'UUID') {
        // Game UUID recieved
        let url = window.location.href.split('?')[0] + '?' + message.uuid;
        history.pushState({}, '', url);
        document.getElementById('link').innerText = url;
    } else if (message.type === 'SYNC') {
        // Game state sync
        gameState.started = message.players[0] && message.players[1];
        gameState.players = message.players;
        gameState.board = message.board;
        gameState.turn = message.turn;
        gameState.round = message.round;
        gameState.youAre = message.youAre;
        gameState.winner = message.winner;
        gameState.lastMove = message.lastMove;
        gameState.movesSinceCapture = message.movesSinceCapture;

        // The board changed, any selection is stale
        clearSelection();

        applySettings(message);
        syncClock(message.clocks, message.turn);

        // Highlight active players
        let player0 = document.getElementById('player0');
        let player1 = document.getElementById('player1');

        if (!message.players[0]) player0.classList.add('missing');
        else player0.classList.remove('missing');
        if (!message.players[1]) player1.classList.add('missing');
        else player1.classList.remove('missing');

        document.title = 'Intransitive | ' + idToName(gameState.turn) + '\'s turn';

        // Update winner modal
        let modal = document.getElementById('modals');
        if (gameState.winner) {
            modal.style.display = 'block';

            let winnerTitle = document.getElementById('winner');
            if (gameState.winner < 3)
                winnerTitle.innerText = `${['Blue', 'Red'][gameState.winner - 1]} wins!`;
            else
                winnerTitle.innerText = 'Draw! No one wins :(';
        } else
            modal.style.display = 'none';

        beep();
        drawBoard();
        updateHTML();
    } else if (message.type === 'SETTINGS') {
        applySettings(message);
    } else if (message.type === 'CLOCK') {
        syncClock(message.clocks, message.turn);
    }
};

updateHTML();
clockLoop();

/**
 * Used in the copy link to clipboard
 * @param {string} text Text to copy
 */
// eslint-disable-next-line no-unused-vars
function copyLinkToClipboard(text) {
    let link = document.getElementsByClassName('game-link')[0];
    link.classList.add('flash');
    setTimeout(() => link.classList.remove('flash'), 500);
    copyToClipboard(text);
}

/** Spawn new game */
// eslint-disable-next-line no-unused-vars
function newGame() {
    if (confirm('Start a new game?'))
        window.location.href = window.location.href.split('?')[0];
}
