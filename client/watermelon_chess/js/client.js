/* global gameState:false, drawBoard:false, clearSelection:false, createConnection:false, beep:false, copyToClipboard:false */

/**
 * All UI / server communication stuff
 * goes here. Game state is shared between
 * this and game.js
 */

const connection = createConnection();

// url?<GAME UUID>=
const uuid = window.location.search.substr(1).split('=')[0];


/**
 * Update a player div, setting color class
 * @param {string} id ID of div
 * @param {number} index 0 = red, 1 = yellow
 */
function setPlayer(id, index) {
    let div = document.getElementById(id);

    div.innerText = idToName(index).toUpperCase();
    div.classList.remove('red');
    div.classList.remove('yellow');
    div.classList.add(index === 0 ? 'red' : 'yellow');
}


/**
 * Convert turn number to name
 * @param {number} i 0 = red, 1 = yellow, else spectator
 * @return {string}
 */
function idToName(i) {
    if (i === 0) return 'Red';
    else if (i === 1) return 'Yellow';
    return 'Spectator';
}

/**
 * Update the hint below the board
 * @param {number|null} selected Point holding the piece being moved
 */
function updateMoveReason(selected) {
    let reason = document.getElementById('disabled-reason');
    reason.style.visibility = 'visible';

    if (gameState.winner)
        reason.innerText = 'Game is over';
    else if (!gameState.started)
        reason.innerText = '⚠️Waiting for players';
    else if (gameState.pendingCapture.length)
        reason.innerText = '⚠️Click a trapped piece to capture it';
    else if (gameState.turn !== gameState.youAre)
        reason.innerText = '⚠️It\'s not your turn';
    else if (selected === null)
        reason.innerText = '⚠️Pick a piece, then pick where it moves';
    else
        reason.style.visibility = 'hidden';
}

/** Update html on state change */
function updateHTML() {
    setPlayer('youare', gameState.youAre);
    updateMoveReason(selected);

    // Update turn label
    setPlayer('turn', gameState.turn);
    let turn = document.getElementById('turn');
    let turnPiece = document.getElementById('turn-piece');

    turnPiece.classList.remove('red');
    turnPiece.classList.remove('yellow');
    turnPiece.classList.add(gameState.turn === 0 ? 'red' : 'yellow');

    if (gameState.turn === gameState.youAre)
        turn.innerText = 'IT IS YOUR TURN';
    else
        turn.innerText = `IT'S ${idToName(gameState.turn).toUpperCase()}'S TURN`;
}

/** Send the chosen capture to the server */
// eslint-disable-next-line no-unused-vars
function selectCapture(node) {
    connection.send(JSON.stringify({ type: 'MOVE', capture: node }));
}

/**
 * Send a move to the server
 * @param {number} from Point holding the piece
 * @param {number} to Point the piece moves to
 */
// eslint-disable-next-line no-unused-vars
function submitMove(from, to) {
    if (!canMove()) return;
    connection.send(JSON.stringify({ type: 'MOVE', from, to }));
}

/** Send restart signal, used in restart modal */
// eslint-disable-next-line no-unused-vars
function restart() {
    connection.send(JSON.stringify({ type: 'MOVE', restart: true }));
}

// Connection handling
connection.onopen = () => {
    if (uuid.length === 0) // Create a new game
        connection.send(JSON.stringify({ type: 'CREATE', gameType: 'watermelon_chess' }));
    else // Join existing game
        connection.send((JSON.stringify({ type: 'JOIN', gameID: uuid })));
};

connection.onerror = error => console.error(error);

connection.onmessage = message => {
    message = JSON.parse(message.data);
    console.log(message);

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
        gameState.winner = message.winner;
        gameState.lastMove = message.lastMove;
        gameState.pendingCapture = message.pendingCapture;
        gameState.youAre = message.youAre;

        clearSelection();

        // Highlight active players
        let player0 = document.getElementById('player0');
        let player1 = document.getElementById('player1');

        if (!message.players[0]) player0.classList.add('missing');
        else player0.classList.remove('missing');
        if (!message.players[1]) player1.classList.add('missing');
        else player1.classList.remove('missing');

        document.title = 'Watermelon Chess | ' + idToName(gameState.turn) + '\'s turn';

        // Update winner modal
        let modal = document.getElementById('modals');
        if (gameState.winner) {
            modal.style.display = 'block';

            let winnerTitle = document.getElementById('winner');
            if (gameState.winner < 3)
                winnerTitle.innerText = `${['Red', 'Yellow'][gameState.winner - 1]} wins!`;
            else
                winnerTitle.innerText = 'Draw! No one wins :(';
        } else
            modal.style.display = 'none';

        beep();
        drawBoard();
        updateHTML();
    }
};

updateHTML();

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
