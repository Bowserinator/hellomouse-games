/* global gameState:false, drawBoard:false, createConnection:false, beep:false, copyToClipboard:false */

/**
 * All UI / server communication stuff
 * goes here. Game state is shared between
 * this and games.js
 */

const connection = createConnection();

// url?<GAME UUID>=
const uuid = window.location.search.substr(1).split('=')[0];


/**
 * Update a player div, setting color class
 * @param {string} id ID of div
 * @param {number} index 0 = black, 1 = white
 */
function setPlayer(id, index) {
    let div = document.getElementById(id);

    div.innerText = idToName(index).toUpperCase();
    div.classList.remove('black');
    div.classList.remove('white');
    div.classList.add(index === 0 ? 'black' : 'white');
}


/**
 * Convert turn number to name
 * @param {number} i 0 = black, 1 = white, else spectator
 * @return {string}
 */
function idToName(i) {
    if (i === 0) return 'Black';
    else if (i === 1) return 'White';
    return 'Spectator';
}

/** Update the disabled state of the submit button */
function updateSubmitButtonDisabled() {
    // Not allowed to submit if either:
    // 1. Game hasn't started
    // 2. It's not your turn
    // 3. You haven't made enough moves
    document.getElementById('submit').disabled =
        (!gameState.started || (gameState.turn !== gameState.currentTurn) ||
        gameState.maxMoves !== gameState.moves.length);

    let reason = document.getElementById('disabled-reason');
    reason.style.visibility = 'visible';

    if (gameState.winner)
        reason.innerText = 'Game is over';
    else if (!gameState.started)
        reason.innerText = '⚠️Waiting for players';
    else if (gameState.turn !== gameState.currentTurn)
        reason.innerText = '⚠️It\'s not your turn';
    else if (gameState.maxMoves !== gameState.moves.length) {
        let movesRemaining = gameState.maxMoves - gameState.moves.length;
        let movesPlural = movesRemaining === 1 ? 'move' : 'moves';
        reason.innerText = `⚠️You still need to make ${movesRemaining} ${movesPlural}!`;
    } else
        reason.style.visibility = 'hidden';
}

/** Update html on state change */
function updateHTML() {
    setPlayer('youare', gameState.turn);
    updateSubmitButtonDisabled();

    // Update turn label
    setPlayer('turn', gameState.currentTurn);
    let turn = document.getElementById('turn');
    let turnPiece = document.getElementById('turn-piece');

    turnPiece.classList.remove('black');
    turnPiece.classList.remove('white');
    turnPiece.classList.add(gameState.currentTurn === 0 ? 'black' : 'white');

    if (gameState.currentTurn === gameState.turn) {
        let moves = `${gameState.moves.length} / ${gameState.maxMoves}`;
        turn.innerText = `IT IS YOUR TURN — (Move ${moves})`;
    } else
        turn.innerText = `IT'S ${idToName(gameState.currentTurn).toUpperCase()}'S TURN`;
}

/** Finalize moves to server */
function submitMoves() {
    if (gameState.moves.length !== gameState.maxMoves) return;
    connection.send(JSON.stringify({ type: 'MOVE', moves: gameState.moves }));
}

/** Send restart signal, used in restart modal */
// eslint-disable-next-line no-unused-vars
function restart() {
    connection.send(JSON.stringify({ type: 'MOVE', restart: true }));
}

// Connection handling
connection.onopen = () => {
    if (uuid.length === 0) // Create a new game
        connection.send(JSON.stringify({ type: 'CREATE', gameType: 'connect6' }));
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
        gameState.board = message.board;
        gameState.turn = message.youAre;
        gameState.currentTurn = message.turn;
        gameState.currentRound = message.round;

        gameState.placing = !message.winner && message.turn === message.youAre && message.players[1];
        gameState.maxMoves = message.round === 0 ? 1 : 2;
        gameState.moves = [];
        gameState.lastMoves = message.lastMoves;
        gameState.winner = message.winner;
        gameState.winningLine = message.winningLine;

        // Highlight active players
        let player0 = document.getElementById('player0');
        let player1 = document.getElementById('player1');

        if (!message.players[0]) player0.classList.add('missing');
        else player0.classList.remove('missing');
        if (!message.players[1]) player1.classList.add('missing');
        else player1.classList.remove('missing');

        document.title = 'Connect6 | ' + idToName(gameState.currentTurn) + '\'s turn';

        // Update winner modal
        let modal = document.getElementById('modals');
        if (gameState.winner) {
            modal.style.display = 'block';

            let winnerTitle = document.getElementById('winner');
            if (gameState.winner < 3)
                winnerTitle.innerText = `${['Black', 'White'][gameState.winner - 1]} wins!`;
            else
                winnerTitle.innerText = `Draw! No one wins :(`;
        } else
            modal.style.display = 'none';

        beep();
        drawBoard();
        updateHTML();
    }
};

updateHTML();

// Submit moves on ENTER
document.addEventListener('keyup', event => {
    if (event.key === 'Enter')
        submitMoves();
});


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
